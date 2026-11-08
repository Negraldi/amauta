"""The portal side of pipelines (plan S1b, ADR 0010), reached through the extension registry.

`list_pipelines(portal)`: per known project, its pipelines, the last run of each and whether the project is trusted.
`run(portal, body)`: body {"project", "id"} (a closed schema): the project must be one the portal knows and one the user
trusted (`amauta check trust`), since a run executes project code; one run per pipeline at a time. The runner starts
as a separate process (it outlives a closed window) and writes the events file whose name is returned.
`events(portal, q)`: events of one run after the first `after`; `done` once it ended. `cancel(portal, body)`: stop it.
"""

import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from ...portal import security
from . import check as preflight
from . import config, graph, lock, schedule, store

PYTHON_DIR = Path(__file__).resolve().parents[3]
WINDOWS = sys.platform == "win32"
_children = []  # started runners, kept so they can be reaped (no zombies, no warnings)
_started = {}  # run name -> its runner process, to tell a run that never started from one still starting


def _known(portal, path):
    real = os.path.realpath(path) if isinstance(path, str) and path else None
    return next((r for r in portal.repos() if os.path.realpath(r) == real), None) if real else None


def _trust(portal, repo):
    """(trusted, why not): the project was trusted with `amauta check trust` and its pipelines.json is the file it saw."""
    projects = security.read_json(Path(portal.cfg.state_dir) / "checks" / "trust.json", {}).get("projects", [])
    rec = next((p for p in projects if isinstance(p, dict) and p.get("path") == os.path.realpath(repo)), None)
    if rec is None:
        return False, "this project is not trusted: run `amauta check trust` in it to allow its pipelines here"
    f = Path(repo) / config.FILE
    current = hashlib.sha256(f.read_bytes()).hexdigest() if f.is_file() else None
    if rec.get("pipelines_sha256") != current:
        return False, "pipelines.json changed since this project was trusted: review it, then run `amauta check trust` again"
    return True, None


def _trusted(portal, repo):
    return _trust(portal, repo)[0]


def _schedules(p, h):
    now = datetime.now()
    return [{**sc, "state": schedule.state(sc, h["scheduled"].get(sc.get("mode") or ""), now)} for sc in p["schedules"]]


def _card(p, last, h):
    """What the Pipelines tab shows for one pipeline: definition and graph, last run, recent history, schedules' state."""
    keep = ("status", "started", "seconds", "trigger")
    run = {**{k: last.get(k) for k in keep}, "run": Path(last["events"]).name} if last else None
    h = h or {"runs": [], "scheduled": {}, "typical": None}
    steps = p["steps"]
    return {"id": p["id"], "name": p["name"], "description": p["description"], "category": p["category"],
            "steps": [s["name"] for s in steps], "ids": [s["id"] for s in steps], "types": [s["type"] for s in steps],
            "needs": [s["needs"] for s in steps], "step_modes": [s["modes"] for s in steps], "levels": graph.levels(steps),
            "modes": p["modes"], "default_mode": p["default_mode"], "last": run, "history": h["runs"], "typical": h["typical"],
            "schedules": _schedules(p, h)}


def list_pipelines(portal):
    out = []
    for repo in portal.repos():
        try:
            pipelines, error = config.load(repo), None
        except config.ConfigError as e:
            pipelines, error = [], str(e)
        if not pipelines and not error:
            continue
        last, hist = store.last_runs(portal.cfg.state_dir, repo), store.history(portal.cfg.state_dir, repo)
        out.append({"name": Path(repo).name, "path": str(Path(repo).resolve()), "trusted": _trusted(portal, repo), "error": error,
                    "pipelines": [_card(p, last.get(p["id"]), hist.get(p["id"])) for p in pipelines]})
    return {"available": True, "projects": out}


def run(portal, body):
    if not isinstance(body, dict) or set(body) - {"project", "id", "step", "mode"}:
        return 400, {"error": "body must be {project, id, step?, mode?}"}
    repo = _known(portal, body.get("project"))
    if repo is None:
        return 404, {"error": "not a project the portal knows"}
    trusted, why = _trust(portal, repo)
    if not trusted:
        return 403, {"error": why}
    try:
        pipeline = next((p for p in config.load(repo) if p["id"] == body.get("id")), None)
    except config.ConfigError as e:
        return 400, {"error": str(e)}
    if pipeline is None:
        return 404, {"error": "no such pipeline"}
    step = body.get("step")
    if step is not None and (type(step) is not int or not 1 <= step <= len(pipeline["steps"])):
        return 400, {"error": f"step must be a number from 1 to {len(pipeline['steps'])}"}
    mode = body.get("mode")
    if mode is not None and mode not in pipeline["modes"]:
        return 400, {"error": f"mode must be one of: {', '.join(pipeline['modes']) or 'none (this pipeline has no modes)'}"}
    events = store.new_run(portal.cfg.state_dir, repo, body["id"])
    if not lock.acquire(portal.cfg.state_dir, repo, body["id"], events.name, starting=True):  # atomic: one run at a time
        return 409, {"error": "this pipeline is already running"}
    events.touch()
    argv = [sys.executable, "-P", "-m", "amauta.extras.pipelines", "run", body["id"], "--cwd", str(repo),
            "--state-dir", str(portal.cfg.state_dir), "--events", str(events), "--trigger", "portal"]
    argv += (["--step", str(step)] if step is not None else []) + (["--mode", mode] if mode else [])
    user_pp = os.environ.get("AMAUTA_USER_PYTHONPATH", os.environ.get("PYTHONPATH", ""))
    env = {**os.environ, "PYTHONPATH": str(PYTHON_DIR), "AMAUTA_USER_PYTHONPATH": user_pp}
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS if WINDOWS else 0
    detach = {"creationflags": flags} if WINDOWS else {"start_new_session": True}
    _children[:] = [c for c in _children if c.poll() is None]
    with open(f"{events}.log", "wb") as log:  # the runner's own errors (one that cannot start says why here)
        child = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=log, **detach)
    _children.append(child)
    _started[events.name] = child
    return 202, {"run": events.name}


def _run_file(portal, project, name):
    repo = _known(portal, project)
    if repo is None or not isinstance(name, str) or Path(name).name != name or not name.endswith(".jsonl"):
        return None
    f = store.runs_dir(portal.cfg.state_dir, repo) / name
    return f if f.is_file() else None


def events(portal, q):
    first = lambda k: str(q.get(k) or "")  # noqa: E731 - the server's query is a dict of strings
    f = _run_file(portal, first("project"), first("run"))
    if f is None:
        return {"events": [], "done": True, "error": "unknown run"}
    after = int(first("after")) if first("after").isdigit() else 0
    got, nxt = store.read_from(f, after)
    if nxt == 0 and _never_started(f):
        log = Path(f"{f}.log").read_text(encoding="utf-8", errors="replace") if Path(f"{f}.log").is_file() else ""
        tail = " ".join(log.strip().splitlines()[-3:])[:400]
        return {"events": [], "next": 0, "done": True, "error": f"the run did not start: {tail or 'no message'}"}
    return {"events": got, "next": nxt, "done": any(e.get("kind") == "run-end" for e in got) or _ended(f, nxt)}


def _never_started(f):
    """An events file still empty whose runner process has already exited."""
    child = _started.get(f.name)
    return child is not None and child.poll() is not None and f.stat().st_size == 0


def _ended(f, offset):
    """True when the run already ended before `offset` (the page asks again after it has the last event)."""
    tail = store.read_from(f, max(0, offset - 4096))[0] if offset else []
    return any(e.get("kind") == "run-end" for e in tail)


def cancel(portal, body):
    f = _run_file(portal, (body or {}).get("project"), (body or {}).get("run"))
    if f is None:
        return 404, {"error": "unknown run"}
    pid = f.name.rsplit("-", 2)[0]
    if not lock.held_by(f.parent / f"{pid}.lock", f.name):
        return 409, {"error": "this run is not running"}
    Path(f"{f}.cancel").write_text("")
    return 200, {"ok": True}


def check(portal, q):
    """What would stop a run (read only, so no trust needed): {findings: [...]} or {error}."""
    repo = _known(portal, str(q.get("project") or ""))
    if repo is None:
        return {"error": "not a project the portal knows"}
    try:
        return {"findings": preflight.check(repo, str(q.get("id") or ""))}
    except config.ConfigError as e:
        return {"error": "no such pipeline" if str(e).startswith("no pipeline") else str(e)}
