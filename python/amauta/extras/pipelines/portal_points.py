"""The portal side of pipelines (plan S1b, ADR 0010), reached through the extension registry.

`list_pipelines(portal)`: per known project, its pipelines, the last run of each and whether the project is trusted.
`run(portal, body)`: body {"project", "id"} (a closed schema): the project must be one the portal knows and one the user
trusted (`amauta check trust`), since a run executes project code; one run per pipeline at a time. The runner starts
as a separate process (it outlives a closed window) and writes the events file whose name is returned.
`events(portal, q)`: events of one run after the first `after`; `done` once it ended. `cancel(portal, body)`: stop it.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from ...portal import security
from . import config, store

PYTHON_DIR = Path(__file__).resolve().parents[3]
WINDOWS = sys.platform == "win32"
_children = []  # started runners, kept so they can be reaped (no zombies, no warnings)


def _known(portal, path):
    real = os.path.realpath(path) if isinstance(path, str) and path else None
    return next((r for r in portal.repos() if os.path.realpath(r) == real), None) if real else None


def _trusted(portal, repo):
    projects = security.read_json(Path(portal.cfg.state_dir) / "checks" / "trust.json", {}).get("projects", [])
    return any(isinstance(p, dict) and p.get("path") == os.path.realpath(repo) for p in projects)


def _card(p, last):
    keep = ("status", "started", "seconds", "trigger")
    run = {**{k: last.get(k) for k in keep}, "run": Path(last["events"]).name} if last else None
    return {"id": p["id"], "name": p["name"], "description": p["description"], "category": p["category"],
            "steps": [s["name"] for s in p["steps"]], "last": run}


def list_pipelines(portal):
    out = []
    for repo in portal.repos():
        try:
            pipelines, error = config.load(repo), None
        except config.ConfigError as e:
            pipelines, error = [], str(e)
        if not pipelines and not error:
            continue
        last = store.last_runs(portal.cfg.state_dir, repo)
        out.append({"name": Path(repo).name, "path": str(Path(repo).resolve()), "trusted": _trusted(portal, repo), "error": error,
                    "pipelines": [_card(p, last.get(p["id"])) for p in pipelines]})
    return {"available": True, "projects": out}


def run(portal, body):
    if not isinstance(body, dict) or set(body) - {"project", "id", "step"}:
        return 400, {"error": "body must be {project, id, step?}"}
    repo = _known(portal, body.get("project"))
    if repo is None:
        return 404, {"error": "not a project the portal knows"}
    if not _trusted(portal, repo):
        return 403, {"error": "this project is not trusted: run `amauta check trust` in it to allow its pipelines here"}
    try:
        pipeline = next((p for p in config.load(repo) if p["id"] == body.get("id")), None)
    except config.ConfigError as e:
        return 400, {"error": str(e)}
    if pipeline is None:
        return 404, {"error": "no such pipeline"}
    step = body.get("step")
    if step is not None and (type(step) is not int or not 1 <= step <= len(pipeline["steps"])):
        return 400, {"error": f"step must be a number from 1 to {len(pipeline['steps'])}"}
    if store.last_runs(portal.cfg.state_dir, repo).get(body["id"], {}).get("status") == "running":
        return 409, {"error": "this pipeline is already running"}
    events = store.new_run(portal.cfg.state_dir, repo, body["id"])
    events.parent.mkdir(parents=True, exist_ok=True)
    events.touch()
    argv = [sys.executable, "-P", "-m", "amauta.extras.pipelines", "run", body["id"], "--cwd", str(repo),
            "--state-dir", str(portal.cfg.state_dir), "--events", str(events), "--trigger", "portal"]
    argv += ["--step", str(step)] if step is not None else []
    env = {**os.environ, "PYTHONPATH": str(PYTHON_DIR)}
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS if WINDOWS else 0
    detach = {"creationflags": flags} if WINDOWS else {"start_new_session": True}
    _children[:] = [c for c in _children if c.poll() is None]
    quiet = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    _children.append(subprocess.Popen(argv, env=env, **quiet, **detach))
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
    got = store.read_events(f, after)
    return {"events": got, "done": any(e.get("kind") == "run-end" for e in store.read_events(f, max(after - 1, 0)) + got)}


def cancel(portal, body):
    f = _run_file(portal, (body or {}).get("project"), (body or {}).get("run"))
    if f is None:
        return 404, {"error": "unknown run"}
    Path(f"{f}.cancel").write_text("")
    return 200, {"ok": True}
