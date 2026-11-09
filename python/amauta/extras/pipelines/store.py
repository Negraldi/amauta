"""Where runs live and what they say (ADR 0010, 0011).

`<state dir>/pipelines/runs/<project key>/<pipeline>-<UTC time with microseconds>-<pid>.jsonl`: one events file per
run, reserved with O_EXCL; beside it `<pipeline>.lock` (lock.py), `<run>.cancel` and `<run>.log`. The project key is
the folder name plus a short hash of its real path, so two projects with one name never mix. The newest KEEP runs of
a pipeline are kept. Events are read whole lines at a time from a byte offset; run summaries (status, steps in
pipeline order, first failure, outputs, trigger, mode) are cached by file size and time.
"""

import hashlib
import json
import os
import re
import statistics
import time
from pathlib import Path

from . import lock

KEEP = 50  # runs kept per pipeline; older events files are removed when a new run starts
SHOWN = 10  # runs in a card's history


def project_key(repo):
    real = os.path.realpath(repo)
    return f"{Path(real).name}-{hashlib.sha256(real.encode('utf-8')).hexdigest()[:8]}"


def pipeline_of(run_name):
    """The pipeline id in a run's file name `<id>-<time>-<pid>.jsonl` (an id may itself hold '-')."""
    return run_name.rsplit("-", 2)[0]


def runs_dir(state_dir, repo):
    return Path(state_dir) / "pipelines" / "runs" / project_key(repo)


def _own(pipeline_id):
    return re.compile(rf"{re.escape(pipeline_id)}-\d{{8}}T\d{{6}}(\d{{6}})?Z-\d+\.jsonl")


def new_run(state_dir, repo, pipeline_id):
    """A new events file, created empty (O_EXCL reserves its name across threads and processes); old runs beyond KEEP
    are removed with their cancel and log files."""
    d = runs_dir(state_dir, repo)
    d.mkdir(parents=True, exist_ok=True)
    mine = sorted(f for f in d.glob("*.jsonl") if _own(pipeline_id).fullmatch(f.name))
    for old in mine[:max(0, len(mine) - (KEEP - 1))]:
        for f in (old, Path(f"{old}.cancel"), Path(f"{old}.log")):
            f.unlink(missing_ok=True)
    now = time.time()  # microseconds in the name, bumped while taken (Windows clocks repeat)
    sec, micro = int(now), int(now * 1e6) % 1000000
    while True:
        stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime(sec)) + f"{micro:06d}Z"
        f = d / f"{pipeline_id}-{stamp}-{os.getpid()}.jsonl"
        try:
            os.close(os.open(f, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
            return f
        except FileExistsError:
            sec, micro = (sec + 1, 0) if micro == 999999 else (sec, micro + 1)


def read_from(path, offset=0):
    """(events, next offset): the whole lines after byte `offset`. Lines end with "\n" only (an event's text may hold
    U+2028 or NEL); a last line without its newline is still being written and waits for the next read."""
    try:
        with open(path, "rb") as f:
            f.seek(offset)
            data = f.read()
    except OSError:
        return [], offset
    end = data.rfind(b"\n") + 1
    out = []
    for raw in data[:end].split(b"\n")[:-1]:
        try:
            out.append(json.loads(raw.decode("utf-8")))
        except ValueError:
            continue  # a damaged line is skipped, never a reason to stop reading
    return out, offset + end


def read_events(path):
    return read_from(path)[0]


_summaries = {}  # path -> ((size, mtime_ns), summary): a finished run's file does not change


def _cached(f):
    """A run's summary; a run without its end is "running" while its runner holds the lock, else "abandoned"."""
    run = _cached_summary(f)
    if run is not None and run["status"] == "running" and not lock.held_by(lock.for_run(f, run["pipeline"]), f.name):
        run = {**run, "status": "abandoned"}
    return run


def _cached_summary(f):
    try:
        st = f.stat()
    except OSError:
        return None
    key = (st.st_size, st.st_mtime_ns)
    hit = _summaries.get(str(f))
    if hit and hit[0] == key:
        return hit[1]
    run = _summary(f, read_events(f))
    _summaries[str(f)] = (key, run)
    return run


def last_runs(state_dir, repo):
    """{pipeline id: {"status", "events", "started", "seconds", "trigger"}} for the newest run of each pipeline."""
    out = {}
    d = runs_dir(state_dir, repo)
    for f in sorted(d.glob("*.jsonl")) if d.is_dir() else []:
        run = _cached(f)
        if run is not None:
            out[run["pipeline"]] = {"status": run["status"], "events": str(f), "started": run["started"],
                                    "seconds": run["seconds"], "trigger": run["trigger"]}
    return out


def _summary(f, events):
    start = next((e for e in events if e.get("kind") == "run-start"), None)
    if start is None:
        return None
    end = next((e for e in reversed(events) if e.get("kind") == "run-end"), None)
    ends = sorted((e for e in events if e.get("kind") == "step-end" and {"name", "status"} <= set(e)),  # complete ones only
                  key=lambda e: e.get("step", 0) if isinstance(e.get("step"), int) else 0)  # pipeline order
    steps = [{"id": e.get("id"), "name": e["name"], "status": e["status"], "seconds": e.get("seconds", 0)} for e in ends]
    bad = next((e.get("step") for e in ends if e["status"] in ("failed", "timeout")), None)
    lines = [e["text"] for e in events if e.get("kind") == "line" and e.get("step") == bad and isinstance(e.get("text"), str)
             and not e["text"].startswith("retrying in ")]
    return {"pipeline": start["pipeline"], "run": f.name, "status": end["status"] if end else "running", "started": start.get("t"),
            "seconds": end.get("seconds") if end else None, "trigger": start.get("trigger", "cli"), "only": start.get("only"),
            "mode": start.get("mode"),
            "steps": steps, "failure": lines[-1] if lines else None,
            "outputs": [o for e in ends for o in e.get("outputs", []) if isinstance(o, dict)]}


def history(state_dir, repo):
    """{pipeline id: {"runs": newest first (at most SHOWN), "last_scheduled": start of the newest scheduled run,
    "scheduled": {mode or "": start of the newest scheduled run of that mode},
    "typical": median seconds of the recent whole runs that ended ok}}."""
    out = {}
    d = runs_dir(state_dir, repo)
    for f in sorted(d.glob("*.jsonl"), reverse=True) if d.is_dir() else []:
        run = _cached(f)
        if run is None:
            continue
        h = out.setdefault(run["pipeline"], {"runs": [], "last_scheduled": None, "scheduled": {}, "ok": []})
        if len(h["runs"]) < SHOWN:
            h["runs"].append(run)
        if run["trigger"] == "schedule":
            h["last_scheduled"] = h["last_scheduled"] or run["started"]
            h["scheduled"].setdefault(run["mode"] or "", run["started"])  # the newest scheduled run of each mode
        if run["status"] == "ok" and run["only"] is None and len(h["ok"]) < SHOWN:
            h["ok"].append(run["seconds"])
    for h in out.values():
        ok = h.pop("ok")
        h["typical"] = float(statistics.median(ok)) if ok else None
    return out
