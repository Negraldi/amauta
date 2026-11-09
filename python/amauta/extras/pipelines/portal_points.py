"""The portal side of pipelines (ADR 0010, 0011), reached through the extension registry. The browser names a project,
a pipeline and at most a step or a mode; never a command.

- `list_pipelines(portal)`: per known project, its pipelines as cards (graph, last run, history, schedules' state)
  and whether the project is trusted.
- `run(portal, body)`: body {project, id, step?, mode?} (a closed schema). The project must be known and trusted with
  its current pipelines.json (`amauta check trust` records its hash); the pipeline's lock is taken here, then the
  runner starts as a detached process (it outlives a closed window) with `--expect-sha256`.
- `events(portal, q)`: one run's events after the byte offset `after`; `done` once it ended, was abandoned or never
  started. `cancel(portal, body)`: ask a running run to stop. `check(portal, q)`: the preflight, read only.
"""

import os
import subprocess
import sys
import threading
from datetime import datetime
from pathlib import Path

from ...portal import security
from . import check as preflight
from . import config, graph, lock, proc, schedule, store

PYTHON_DIR = Path(proc.AMAUTA_PYTHON)  # the runner imports amauta from here
_children = []  # started runners, kept so they can be reaped (no zombies, no warnings)
_mutex = threading.Lock()
_started = {}  # run name -> its runner process, to tell a run that never started from one still starting


def _known(portal, path):
    real = os.path.realpath(path) if isinstance(path, str) and path else None
    return next((r for r in portal.repos() if os.path.realpath(r) == real), None) if real else None


def _trust(portal, repo):
    """(trusted, why not, sha256): the project was trusted with `amauta check trust` and its pipelines.json is the file
    it saw; the runner gets that hash and refuses a file changed in between."""
    projects = security.read_json(Path(portal.cfg.state_dir) / "checks" / "trust.json", {}).get("projects", [])
    rec = next((p for p in projects if isinstance(p, dict) and p.get("path") == os.path.realpath(repo)), None)
    if rec is None:
        return False, "this project is not trusted: run `amauta check trust` in it to allow its pipelines here", None
    current = config.file_sha256(repo)
    if rec.get("pipelines_sha256") != current:
        return False, "pipelines.json changed since this project was trusted: review it, then run `amauta check trust` again", None
    return True, None, current


def _schedules(p, h):
    now = datetime.now()
    key = lambda sc: sc.get("mode") or p["default_mode"] or ""  # noqa: E731 - a schedule without mode runs the default
    return [{**sc, "state": schedule.state(sc, h["scheduled"].get(key(sc)), now)} for sc in p["schedules"]]


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
        except Exception as e:  # noqa: BLE001 - one project's broken file must not empty the tab for the others
            pipelines, error = [], str(e)
        if not pipelines and not error:
            continue
        last, hist = store.last_runs(portal.cfg.state_dir, repo), store.history(portal.cfg.state_dir, repo)
        out.append({"name": Path(repo).name, "path": str(Path(repo).resolve()), "trusted": _trust(portal, repo)[0], "error": error,
                    "pipelines": [_card(p, last.get(p["id"]), hist.get(p["id"])) for p in pipelines]})
    return {"available": True, "projects": out}


def _validate(portal, body):
    """(error, request): an HTTP error (status, body), or what a valid run request names."""
    if not isinstance(body, dict) or set(body) - {"project", "id", "step", "mode"}:
        return (400, {"error": "body must be {project, id, step?, mode?}"}), None
    repo = _known(portal, body.get("project"))
    if repo is None:
        return (404, {"error": "not a project the portal knows"}), None
    trusted, why, sha = _trust(portal, repo)
    if not trusted:
        return (403, {"error": why}), None
    try:
        pipeline = next((p for p in config.load(repo) if p["id"] == body.get("id")), None)
    except config.ConfigError as e:
        return (400, {"error": str(e)}), None
    if pipeline is None:
        return (404, {"error": "no such pipeline"}), None
    step, mode = body.get("step"), body.get("mode")
    if step is not None and (type(step) is not int or not 1 <= step <= len(pipeline["steps"])):
        return (400, {"error": f"step must be a number from 1 to {len(pipeline['steps'])}"}), None
    if mode is not None and mode not in pipeline["modes"]:
        return (400, {"error": f"mode must be one of: {', '.join(pipeline['modes']) or 'none (this pipeline has no modes)'}"}), None
    return None, {"repo": repo, "id": pipeline["id"], "sha": sha, "step": step, "mode": mode}


def _command(portal, req, events):
    """The runner's argv and environment: amauta's modules for the runner, the user's own PYTHONPATH for the steps."""
    argv = [sys.executable, "-P", "-m", "amauta.extras.pipelines", "run", req["id"], "--cwd", str(req["repo"]),
            "--state-dir", str(portal.cfg.state_dir), "--events", str(events), "--trigger", "portal",
            "--expect-sha256", req["sha"]]
    argv += (["--step", str(req["step"])] if req["step"] is not None else []) + (["--mode", req["mode"]] if req["mode"] else [])
    user = proc.without_amauta(os.environ.get("AMAUTA_USER_PYTHONPATH", os.environ.get("PYTHONPATH", "")))
    return argv, {**os.environ, "PYTHONPATH": str(PYTHON_DIR), "AMAUTA_USER_PYTHONPATH": user}


def _remember(events, child):
    with _mutex:  # the portal serves requests in threads
        _children[:] = [c for c in _children if c.poll() is None] + [child]
        for name in [n for n, c in _started.items() if c.poll() is not None and n != events.name][:-50]:
            del _started[name]  # keep the newest finished launches, enough for their followers
        _started[events.name] = child


def run(portal, body):
    error, req = _validate(portal, body)
    if error:
        return error
    with _mutex:
        _children[:] = [c for c in _children if c.poll() is None]  # reap ended runners first
    state, repo, pid = portal.cfg.state_dir, req["repo"], req["id"]
    events = store.new_run(state, repo, pid)
    if not lock.acquire(state, repo, pid, events.name, starting=True):  # atomic: one run at a time
        events.unlink(missing_ok=True)  # the name new_run reserved: no run will use it
        return 409, {"error": "this pipeline is already running"}
    argv, env = _command(portal, req, events)
    detach = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS} if proc.WINDOWS \
        else {"start_new_session": True}
    try:
        child = _spawn(argv, env, Path(f"{events}.log"), detach)
    except OSError as e:  # nothing will adopt the lock: release it now rather than in a minute
        lock.release(state, repo, pid, events.name)
        events.unlink(missing_ok=True)
        return 500, {"error": f"the runner could not start: {e}"}
    _remember(events, child)
    return 202, {"run": events.name}


def _spawn(argv, env, log, detach):
    """Start the runner, detached; its own errors (one that cannot start says why) go to `log`."""
    with open(log, "wb") as out:
        return subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=out, **detach)


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
    if nxt == 0 and (_never_started(f) or not _held(f)):
        log = Path(f"{f}.log").read_text(encoding="utf-8", errors="replace") if Path(f"{f}.log").is_file() else ""
        tail = " ".join(log.strip().splitlines()[-3:])[:400]
        return {"events": [], "next": 0, "done": True, "error": f"the run did not start: {tail or 'no message'}"}
    done = any(e.get("kind") == "run-end" for e in got) or _ended(f, nxt)
    if not done and not _held(f):  # no live runner: the file is final once read again (its end may have just landed)
        more, nxt = store.read_from(f, nxt)
        got += more
        if not any(e.get("kind") == "run-end" for e in more):
            return {"events": got, "next": nxt, "done": True, "error": "the run stopped without its end (abandoned)"}
        done = True
    return {"events": got, "next": nxt, "done": done}


def _held(f):
    """A live runner holds this run's pipeline lock."""
    return lock.held_by(lock.for_run(f, store.pipeline_of(f.name)), f.name)


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
    if not _held(f):
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
