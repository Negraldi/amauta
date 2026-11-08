"""Run one pipeline (plan S1a, ADR 0010): steps in order, each a process started without a shell, its stdout and
stderr merged and read line by line. Every line is redacted (secrets and identifiers, through the detector catalog)
and written as an event to a JSON-lines file; `on_line` sees the same text (the CLI prints it). A failed, timed-out or
cancelled step stops the run; later steps are reported as skipped. Cancel: create `<events>.cancel`. A step's whole
process tree is stopped (POSIX process group; `taskkill /T` on Windows).

Exit codes: 0 every enabled step ok, 1 a step failed or timed out, 130 cancelled.
"""

import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from ...detectors import scan
from . import config

WINDOWS = sys.platform == "win32"


def cancel_path(events):
    return Path(f"{events}.cancel")


def argv_for(step, repo, python):
    if step["type"] == "command":
        return list(step["argv"])
    if step["type"] == "python":
        return [step.get("interpreter") or python, step["script"], *step["args"]]
    if step["type"] == "r":
        return [step.get("interpreter") or "Rscript", step["script"], *step["args"]]
    out = f"{Path(step['path']).stem}.run.ipynb"  # the source notebook is never overwritten
    return ["jupyter", "nbconvert", "--to", "notebook", "--execute", "--output", out, step["path"]]


def _kill_tree(proc):
    if proc.poll() is not None:
        return
    try:
        if WINDOWS:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
        else:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        pass


class _Events:
    def __init__(self, path, on_line):
        self.path, self.on_line = Path(path), on_line
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.f = open(self.path, "a", encoding="utf-8")

    def emit(self, kind, **fields):
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.f.write(json.dumps({"t": now, "kind": kind, **fields}, ensure_ascii=False) + "\n")
        self.f.flush()

    def line(self, step, name, raw):
        text, _ = scan.redact(raw.rstrip("\r\n"))
        self.emit("line", step=step, name=name, text=text)
        if self.on_line:
            self.on_line(name, text)


def _run_step(i, step, repo, python, ev, cancel, env):
    try:
        group = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if WINDOWS else {"start_new_session": True}
        proc = subprocess.Popen(argv_for(step, repo, python), cwd=Path(repo) / step["cwd"], env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", **group)
    except OSError as e:
        ev.line(i, step["name"], f"cannot start {argv_for(step, repo, python)[0]}: {e.strerror or e}")
        return "failed"
    stop = {"why": None}

    def watch():
        deadline = time.monotonic() + step["timeout"]
        while proc.poll() is None:
            if cancel.exists() or time.monotonic() > deadline:
                stop["why"] = "cancelled" if cancel.exists() else "timeout"
                _kill_tree(proc)
                return
            time.sleep(0.2)

    threading.Thread(target=watch, daemon=True).start()
    with proc.stdout:
        for raw in proc.stdout:
            ev.line(i, step["name"], raw)
    proc.wait()
    return stop["why"] or ("ok" if proc.returncode == 0 else "failed")


def run(repo, pipeline_id, events, python=None, on_line=None, only=None, trigger="cli"):
    """`only`: run just that step (0-based), the others are skipped. `trigger`: cli, portal or schedule (shown in the portal)."""
    pipeline = next((p for p in config.load(repo) if p["id"] == pipeline_id), None)
    if pipeline is None:
        raise config.ConfigError(f"no pipeline {pipeline_id!r} in {config.FILE}")
    if only is not None and not 0 <= only < len(pipeline["steps"]):
        raise config.ConfigError(f"{pipeline_id} has no step {only + 1}")
    python = python or shutil.which("python3") or shutil.which("python") or sys.executable
    ev, cancel = _Events(events, on_line), cancel_path(events)
    names = [s["name"] for s in pipeline["steps"]]
    ev.emit("run-start", pipeline=pipeline_id, name=pipeline["name"], steps=names, trigger=trigger, only=only)
    status, t0 = "ok", time.monotonic()
    for i, step in enumerate(pipeline["steps"]):
        if status != "ok" or (only is None and not step["enabled"]) or (only is not None and i != only):
            ev.emit("step-end", step=i, name=step["name"], status="skipped", seconds=0)
            continue
        ev.emit("step-start", step=i, name=step["name"])
        s0 = time.monotonic()
        env = {**os.environ, "AMAUTA_PIPELINE": pipeline_id, "AMAUTA_PIPELINE_TRIGGER": trigger, "AMAUTA_PIPELINE_STEP": str(i + 1)}
        result = _run_step(i, step, repo, python, ev, cancel, env)
        ev.emit("step-end", step=i, name=step["name"], status=result, seconds=round(time.monotonic() - s0, 1))
        if result != "ok":
            status = "cancelled" if result == "cancelled" else "failed"
    ev.emit("run-end", status=status, seconds=round(time.monotonic() - t0, 1))
    ev.f.close()
    cancel.unlink(missing_ok=True)
    return {"ok": 0, "failed": 1, "cancelled": 130}[status]
