"""Where runs live: `<state dir>/pipelines/runs/<project key>/<pipeline>-<UTC time>.jsonl`, one events file per run.
The project key is the folder name plus a short hash of its real path, so two projects with one name never mix."""

import hashlib
import json
import os
import time
from pathlib import Path


def project_key(repo):
    real = os.path.realpath(repo)
    return f"{Path(real).name}-{hashlib.sha256(real.encode('utf-8')).hexdigest()[:8]}"


def runs_dir(state_dir, repo):
    return Path(state_dir) / "pipelines" / "runs" / project_key(repo)


def new_run(state_dir, repo, pipeline_id):
    return runs_dir(state_dir, repo) / f"{pipeline_id}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{os.getpid()}.jsonl"


def read_events(path, after=0):
    """Events after the first `after` ones (the portal polls with the count it already has)."""
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for line in lines[after:]:
        try:
            out.append(json.loads(line))
        except ValueError:
            break  # a line still being written
    return out


def last_runs(state_dir, repo):
    """{pipeline id: {"status", "events", "started"}} for the newest run of each pipeline; a run without its end is running."""
    out = {}
    d = runs_dir(state_dir, repo)
    for f in sorted(d.glob("*.jsonl")) if d.is_dir() else []:
        events = read_events(f)
        start = next((e for e in events if e.get("kind") == "run-start"), None)
        if start is None:
            continue
        end = next((e for e in reversed(events) if e.get("kind") == "run-end"), None)
        out[start["pipeline"]] = {"status": end["status"] if end else "running", "events": str(f), "started": start["t"]}
    return out
