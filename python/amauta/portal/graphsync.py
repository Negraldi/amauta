"""Graph sync for every project, from the project page: how stale the mirror is, a guarded background refresh and the hook install.

The portal never runs graphify itself: "Sync graph now" starts `python3 -P -m amauta.graph.refresh --repo DIR` as a detached child (lock,
`graphify update .`, `check-update`, mirror; see graph/refresh.py) and answers 202 at once. "Connect" runs the CLI
(`amauta graphify hook install --cwd DIR --state-dir STATE`) so the hook block stays defined in one place (src/graphify/hook.js).
A client only ever names a project; the directory comes from the projects the portal already knows (`Portal.repos()`).
"""
from __future__ import annotations

import calendar
import os
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from ..graph import lock as graph_lock
from ..graph.refresh import PLAIN_LOCK

PYTHON_DIR = Path(__file__).resolve().parents[2]
CLI = PYTHON_DIR.parent / "bin" / "amauta.js"
BEGIN = "# >>> amauta graphify >>>"
EVENTS = ("post-commit", "post-merge", "post-rewrite", "post-checkout")
OPT_OUT_KEY = "amauta.graphifyHook"
GIT_TIMEOUT = 5
CONNECT_TIMEOUT = 30
MAX_NAME = 200
CHILD_ENV = ("PATH", "HOME", "LANG", "LC_ALL", "USER", "LOGNAME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "PIPX_HOME", "PIPX_BIN_DIR")


class SyncError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message, self.status = message, status

    def body(self):
        return {"error": self.message}


# ---- facts ----------------------------------------------------------------------------------------------------
def _git(repo, *args):
    try:
        done = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=GIT_TIMEOUT, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout if done.returncode == 0 else None


def _epoch(stamp):
    try:
        return calendar.timegm(time.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ"))
    except (TypeError, ValueError):
        return None


def is_stale(synced_at, last_commit):
    """True when the mirrored graph is older than the last commit (epoch seconds); None when either is unknown."""
    synced = _epoch(synced_at)
    if synced is None or not isinstance(last_commit, int):
        return None
    return synced < last_commit


def info(repo, synced_at):
    """Graph-sync facts for one project directory: git or not, last commit, staleness, hook state, whether a refresh is running."""
    repo = Path(repo)
    out = {"is_git": False, "last_commit": None, "stale": None, "hooks_installed": False, "opted_out": False, "running": False}
    lock = repo.joinpath(*PLAIN_LOCK)
    layout = _git(repo, "rev-parse", "--show-toplevel", "--git-path", "hooks", "--git-path", graph_lock.LOCK_NAME)
    lines = layout.splitlines() if layout else []
    if len(lines) == 3 and Path(os.path.realpath(lines[0])) == Path(os.path.realpath(repo)):
        out["is_git"] = True
        lock = (repo / lines[2]).resolve()
        hooks = (repo / lines[1]).resolve()
        for event in EVENTS:
            try:
                if BEGIN in (hooks / event).read_text(errors="replace"):
                    out["hooks_installed"] = True
            except OSError:
                pass
        out["opted_out"] = (_git(repo, "config", "--local", "--get", OPT_OUT_KEY) or "").strip() == "false"
        stamp = (_git(repo, "log", "-1", "--format=%ct") or "").strip()
        if stamp.isdigit():
            out["last_commit"] = datetime.fromtimestamp(int(stamp), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            out["stale"] = is_stale(synced_at, int(stamp))
    out["running"] = lock.exists()
    return out


# ---- actions --------------------------------------------------------------------------------------------------
def spawn_detached(argv, env):
    child = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
    threading.Thread(target=child.wait, daemon=True).start()  # reap it; the portal does not wait for the refresh


def run_cli(argv, timeout):
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)


class GraphSync:
    """The two guarded actions. `spawner`, `runner` and `which` are injectable so tests start nothing."""

    def __init__(self, portal, spawner=spawn_detached, runner=run_cli, which=shutil.which):
        self.portal, self.spawner, self.runner, self.which = portal, spawner, runner, which

    def _project(self, body):
        name = body.get("project") if isinstance(body, dict) and set(body) == {"project"} else None
        if not isinstance(name, str) or not name or len(name) > MAX_NAME:
            raise SyncError('body must be {"project": "<name>"}')
        found = [r for r in self.portal.repos() if r.name == name]
        if not found:
            raise SyncError("unknown project")
        if len({os.path.realpath(r) for r in found}) > 1:
            raise SyncError("several projects share this name; rename or remove one in Settings > Projects")
        real = Path(os.path.realpath(found[0]))
        if not real.is_dir():
            raise SyncError("the project directory no longer exists")
        return name, real

    def start(self, body):
        name, directory = self._project(body)
        if self.which("graphify") is None:
            raise SyncError("graphify is not installed or not on the portal's PATH (install it with: pipx install graphifyy)", 409)
        env = {k: os.environ[k] for k in CHILD_ENV if k in os.environ}
        env.update({"PYTHONPATH": str(PYTHON_DIR), "AMAUTA_STATE_DIR": str(self.portal.cfg.state_dir)})
        try:
            self.spawner([sys.executable, "-P", "-m", "amauta.graph.refresh", "--repo", str(directory)], env)
        except OSError as err:
            raise SyncError(f"could not start the refresh: {err.strerror or err}", 500) from None
        return {"started": True, "project": name}

    def connect(self, body):
        name, directory = self._project(body)
        facts = info(directory, None)
        if not facts["is_git"]:
            raise SyncError("not the root of a git repository: only git projects have hooks to connect")
        node = self.which("node")
        if node is None:
            raise SyncError("node is not on the portal's PATH, so the hooks cannot be installed from here (run: amauta graphify hook install --cwd <dir>)", 409)
        argv = [node, str(CLI), "graphify", "hook", "install", "--cwd", str(directory), "--state-dir", str(self.portal.cfg.state_dir)]
        try:
            done = self.runner(argv, CONNECT_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired) as err:
            raise SyncError(f"could not install the hooks: {type(err).__name__}", 500) from None
        if done.returncode != 0:
            raise SyncError((done.stderr or done.stdout or "hook install failed").strip()[:300], 500)
        return {"ok": True, "project": name}
