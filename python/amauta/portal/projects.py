"""Projects the portal knows: `--repo` flags, `portal.json` in the state dir and (optionally) git roots of session working directories.

Only existing directories under $HOME count. Paths are resolved first, so a symlink that leaves $HOME is never followed, and $HOME itself is never
a project. Discovery is bounded (sessions read, repositories kept) and cached for a few seconds.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path

from . import wikifeature, wikisess
from .api import has_table

CONFIG_NAME = "portal.json"
MAX_CONFIG_REPOS = 50
MAX_DISCOVERED = 50
MAX_SESSIONS = 300
MAX_EVENT_CWDS = 200
MAX_PATH = 1024
TTL = 15.0
GRAPH_HOWTO = ("Graph memory is mirrored from graphify. Run `amauta graphify hook install --cwd <path>` once (every commit then runs `graphify update .` and syncs), "
               "or sync by hand with `graphify update .` and `python3 -P -m amauta.graph sync --repo .`.")


class ConfigError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message, self.status = message, status


def home_dir(cfg_home=None):
    return Path(os.path.realpath(cfg_home or os.path.expanduser("~")))


def check_repo(raw, home):
    """The normalized (resolved) directory for a configured path; ConfigError says which rule failed."""
    if not isinstance(raw, str):
        raise ConfigError("every path must be a string")
    if not raw or len(raw) > MAX_PATH or "\x00" in raw:
        raise ConfigError("path is empty, too long or contains a NUL byte")
    if not os.path.isabs(raw):
        raise ConfigError(f"path must be absolute: {raw[:80]}")
    real = Path(os.path.realpath(raw))
    if not real.is_dir():
        raise ConfigError(f"not an existing directory: {raw[:80]}")
    if real == home or home not in real.parents:
        raise ConfigError(f"path must be a directory inside your home directory: {raw[:80]}")
    return real


def _clean(repos, home):
    out, seen = [], set()
    for raw in repos if isinstance(repos, list) else []:
        try:
            real = check_repo(raw, home)
        except ConfigError:
            continue
        if str(real) not in seen:
            seen.add(str(real))
            out.append(str(real))
        if len(out) >= MAX_CONFIG_REPOS:
            break
    return out


def read_config(state_dir, home=None):
    """{"repos": [...], "auto_discover": bool}; a missing, unreadable or malformed file gives the defaults, bad entries are dropped."""
    out = {"repos": [], "auto_discover": True}
    try:
        data = json.loads((Path(state_dir) / CONFIG_NAME).read_text())
    except (OSError, ValueError):
        return out
    if not isinstance(data, dict):
        return out
    out["repos"] = _clean(data.get("repos"), home_dir(home))
    if isinstance(data.get("auto_discover"), bool):
        out["auto_discover"] = data["auto_discover"]
    return out


def write_config(state_dir, body, home=None):
    """Validate a closed-schema body {repos?, auto_discover?} and replace portal.json atomically. Missing keys keep their current value."""
    if not isinstance(body, dict) or not body or set(body) - {"repos", "auto_discover"}:
        raise ConfigError("body must be an object with repos and/or auto_discover")
    base = home_dir(home)
    current = read_config(state_dir, home)
    if "repos" in body:
        if not isinstance(body["repos"], list):
            raise ConfigError("repos must be a list of paths")
        if len(body["repos"]) > MAX_CONFIG_REPOS:
            raise ConfigError(f"at most {MAX_CONFIG_REPOS} paths")
        seen = []
        for raw in body["repos"]:
            real = str(check_repo(raw, base))
            if real not in seen:
                seen.append(real)
        current["repos"] = seen
    if "auto_discover" in body:
        if not isinstance(body["auto_discover"], bool):
            raise ConfigError("auto_discover must be true or false")
        current["auto_discover"] = body["auto_discover"]
    state = Path(state_dir)
    state.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".portal-", suffix=".tmp", dir=state)
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(current, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, state / CONFIG_NAME)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise ConfigError("could not write portal.json", 500) from None
    return current


# ---- discovery ----------------------------------------------------------------------------------------------
def git_root(cwd, home):
    """Nearest ancestor of `cwd` (inside home, never home itself) that has a .git entry; None when there is none."""
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or "\x00" in cwd:
        return None
    here = Path(os.path.realpath(cwd))
    try:
        if not here.is_dir() or home not in here.parents:
            return None
        for d in [here, *here.parents][:24]:
            if d == home or home not in d.parents:
                return None
            if (d / ".git").exists():
                return d
    except OSError:
        return None
    return None


def session_roots(portal, home):
    """{session_id: git root} for the most recent sessions, newest first; cwd comes from the transcript's first bytes (read-only)."""
    conn = portal._usage_conn()
    if conn is None:
        return {}
    try:
        ids = [r[0] for r in conn.execute("SELECT u.session_id, max(u.ts) t FROM usage_messages u WHERE u.session_id IS NOT NULL GROUP BY u.session_id ORDER BY t DESC LIMIT ?", (MAX_SESSIONS,))]
    finally:
        conn.close()
    out = {}
    for sid in ids:
        root = git_root(wikisess.session_info(portal, sid).get("cwd"), home)
        if root is not None:
            out[sid] = root
    return out


def event_roots(portal, home):
    conn = portal._usage_conn()
    if conn is None:
        return []
    try:
        if not has_table(conn, "events"):
            return []
        cwds = [r[0] for r in conn.execute("SELECT e.cwd FROM events e WHERE e.cwd IS NOT NULL GROUP BY e.cwd ORDER BY max(e.ts) DESC LIMIT ?", (MAX_EVENT_CWDS,))]
    finally:
        conn.close()
    return [r for r in (git_root(c, home) for c in cwds) if r is not None]


def collect(portal):
    """{"repos": [Path], "origin": {resolved: [flag|config|discovered]}, "config": {...}, "session_roots": {...}}, cached for a few seconds."""
    cached = getattr(portal, "_projects_cache", None)
    if cached and time.monotonic() - cached[0] < TTL:
        return cached[1]
    home = home_dir(portal.cfg.home)
    config = read_config(portal.cfg.state_dir, portal.cfg.home)
    roots = session_roots(portal, home)
    repos, origin = [], {}

    def add(path, why):
        key = str(Path(os.path.realpath(path)))
        if key not in origin:
            origin[key] = []
            repos.append(Path(path))
        if why not in origin[key]:
            origin[key].append(why)

    for r in portal.cfg.repos:
        add(r, "flag")
    for r in config["repos"]:
        add(r, "config")
    if config["auto_discover"]:
        found = []
        for root in [*roots.values(), *event_roots(portal, home)]:
            if root not in found:
                found.append(root)
        for root in found[:MAX_DISCOVERED]:
            add(root, "discovered")
    value = {"repos": repos, "origin": origin, "config": config, "session_roots": roots}
    portal._projects_cache = (time.monotonic(), value)
    return value


def forget(portal):
    portal._projects_cache = None


# ---- the answers ----------------------------------------------------------------------------------------------
def odd_summary(repo):
    folder = Path(repo) / "odd" / "tasks"
    done = total = features = 0
    for f in sorted(folder.glob("*.md")) if folder.is_dir() else []:
        if f.is_file() and not f.is_symlink():
            try:
                tasks = wikifeature.parse_tasks(f.read_text(errors="replace")[:200_000])
            except OSError:
                continue
            features += 1
            done += sum(t["done"] for t in tasks)
            total += len(tasks)
    return {"features": features, "done": done, "total": total, "percent": round(100 * done / total) if total else 0}


def session_ids(portal, repo):
    """Session ids of a repository: transcripts whose cwd is inside it, plus sessions whose usage project name equals its name."""
    key = Path(os.path.realpath(repo))
    ids = [sid for sid, root in collect(portal)["session_roots"].items() if root == key]
    conn = portal._usage_conn()
    if conn is not None:
        try:
            ids += [r[0] for r in conn.execute("SELECT DISTINCT u.session_id FROM usage_messages u WHERE u.project = ?", (Path(repo).name,))]
        finally:
            conn.close()
    return list(dict.fromkeys(ids))


def memory_count(portal, name):
    source, conn = portal._memory_conn({})
    if conn is None:
        return 0
    try:
        if not has_table(conn, "observations"):
            return 0
        live = "o.deleted_at IS NULL" if "deleted_at" in [r[1] for r in conn.execute("PRAGMA table_info(observations)")] else "1=1"
        return conn.execute(f"SELECT count(*) FROM observations o WHERE o.project = ? AND {live}", (name,)).fetchone()[0]
    finally:
        conn.close()


def graph_status(portal, repo):
    conn = portal._graph_conn()
    row = None
    if conn is not None:
        try:
            row = conn.execute("SELECT nodes, edges, synced_at FROM graph_sync WHERE repo = ?", (str(Path(repo).resolve()),)).fetchone()
        finally:
            conn.close()
    if row is None:
        return {"mirrored": False, "nodes": 0, "edges": 0, "synced_at": None, "howto": GRAPH_HOWTO}
    return {"mirrored": True, "nodes": row["nodes"], "edges": row["edges"], "synced_at": row["synced_at"]}


def summary(portal, q=None):
    info = collect(portal)
    out = []
    for repo in info["repos"]:
        out.append({"name": repo.name, "path": str(repo.resolve()), "origin": info["origin"][str(Path(os.path.realpath(repo)))], "odd": odd_summary(repo),
                    "sessions": len(session_ids(portal, repo)), "memories": memory_count(portal, repo.name), "graph": graph_status(portal, repo)})
    return {"auto_discover": info["config"]["auto_discover"], "config_repos": info["config"]["repos"], "projects": out}
