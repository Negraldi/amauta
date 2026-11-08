"""Run one pipeline (ADR 0010, 0011): its steps as a DAG, each a process started without a shell (proc.py).

A step starts once every step it needs is done, at most `max_parallel` at a time. Done means ok, or skipped because
the step is off (`enabled: false`), outside the run's mode, or outside an "only this step" run. A failed, timed-out or
cancelled step skips only the steps that need it (reason "needs"); other branches finish. A failure or timeout is
tried again up to `retries` times, `retry_delay` seconds apart; a step that exits 0 but did not change each of its
`outputs` has failed.

Every output line is redacted (the detector catalog; a private key block from BEGIN to END) and written as an event to
a JSON-lines file; `on_line` sees the same text (the CLI prints it). The run holds its pipeline's lock (lock.py). Cancel:
create `<events>.cancel`, or send SIGTERM/SIGINT; whatever stops the runner, the run ends with a run-end event.

Exit codes: 0 every step that ran was ok, 1 a step failed or timed out, 130 cancelled.
"""

import json
import os
import re
import shutil
import signal
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
from pathlib import Path

from ...detectors import scan
from . import config, lock, proc

KEY_BEGIN = re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")
KEY_END = re.compile(r"-----END [A-Z0-9 ]*PRIVATE KEY-----")
DONE = ("ok", "skipped")
argv_for = proc.argv_for  # kept for callers of 0.6


def cancel_path(events):
    return Path(f"{events}.cancel")


class _Events:
    """The run's events file; safe to use from the threads of parallel steps."""

    def __init__(self, path, on_line):
        self.path, self.on_line = Path(path), on_line
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.f = open(self.path, "a", encoding="utf-8")
        self.mutex, self.in_key = threading.Lock(), set()

    def emit(self, kind, **fields):
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self.mutex:
            self.f.write(json.dumps({"t": now, "kind": kind, **fields}, ensure_ascii=False) + "\n")
            self.f.flush()

    def line(self, i, step, raw):
        text = raw.rstrip("\r\n")
        if KEY_BEGIN.search(text) or i in self.in_key:
            self.in_key.discard(i) if KEY_END.search(text) else self.in_key.add(i)
            text = "[REDACTED_PRIVATE_KEY]"
        else:
            text, _ = scan.redact(text)
        self.emit("line", step=i, id=step["id"], name=step["name"], text=text)
        if self.on_line:
            self.on_line(step["name"], text)


def _snapshot(repo, step):
    def state(rel):
        try:
            st = (Path(repo) / rel).stat()
            return (st.st_size, st.st_ino, st.st_mtime_ns)
        except OSError:
            return None
    return {rel: state(rel) for rel in step["outputs"]}


def _check_outputs(i, step, repo, before, ev):
    """[{path, bytes, modified}] when the step wrote or changed every output; None (after saying why) otherwise."""
    found = []
    for rel in step["outputs"]:
        f = Path(repo) / rel
        if not f.is_file():
            ev.line(i, step, f"{rel} was not written")
            return None
        st = f.stat()
        if before.get(rel) == (st.st_size, st.st_ino, st.st_mtime_ns):
            ev.line(i, step, f"{rel} was not updated by this step")
            return None
        modified = datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(timespec="seconds")
        found.append({"path": rel, "bytes": st.st_size, "modified": modified})
    return found


def _attempts(i, step, ctx):
    """Run the step, retrying a failure or timeout; returns (status, attempts, outputs)."""
    attempt = 1
    while True:
        before = _snapshot(ctx["repo"], step)
        result = proc.run(step, ctx["repo"], ctx["python"], ctx["env"](i), ctx["cancel"], lambda raw: ctx["ev"].line(i, step, raw))
        outputs = _check_outputs(i, step, ctx["repo"], before, ctx["ev"]) if result == "ok" else None
        if result == "ok" and outputs is None:
            result = "failed"
        if result in ("ok", "cancelled") or attempt > step["retries"]:
            return result, attempt, outputs or []
        attempt += 1
        ctx["ev"].emit("step-retry", step=i, id=step["id"], name=step["name"], attempt=attempt, of=step["retries"] + 1,
                       delay=step["retry_delay"])
        ctx["ev"].line(i, step, f"retrying in {step['retry_delay']} s (attempt {attempt} of {step['retries'] + 1})")
        deadline = time.monotonic() + step["retry_delay"]
        while time.monotonic() < deadline:
            if ctx["cancel"].exists():
                return "cancelled", attempt - 1, []
            time.sleep(0.2)


def _one(i, step, ctx):
    ctx["ev"].emit("step-start", step=i, id=step["id"], name=step["name"])
    s0 = time.monotonic()
    result, attempts, outputs = _attempts(i, step, ctx)
    ctx["ev"].emit("step-end", step=i, id=step["id"], name=step["name"], status=result, seconds=round(time.monotonic() - s0, 1),
                   attempts=attempts, outputs=outputs)
    return result


def _skip_reason(i, step, only, mode):
    if only is not None:
        return None if i == only else "only"
    if not step["enabled"]:
        return "off"
    return "mode" if mode is not None and step["modes"] is not None and mode not in step["modes"] else None


def _schedule(pipeline, ctx, only, mode):
    """Run the DAG; {step id: status}."""
    steps, status, running = pipeline["steps"], {}, {}
    index = {s["id"]: i for i, s in enumerate(steps)}

    def settle(i, st, reason):
        status[st["id"]] = "skipped" if reason else None
        if reason:
            ctx["ev"].emit("step-end", step=i, id=st["id"], name=st["name"], status="skipped", seconds=0, reason=reason)
    with ThreadPoolExecutor(max_workers=pipeline["max_parallel"]) as pool:
        while len(status) < len(steps) or running:
            for i, st in enumerate(steps):
                if st["id"] in status:
                    continue
                needs = [status.get(n) for n in st["needs"]]
                if any(n is not None and n not in DONE for n in needs) or (ctx["cancel"].exists() and only is None):
                    settle(i, st, "needs" if not ctx["cancel"].exists() else "cancelled")
                elif all(n in DONE for n in needs) and len(running) < pipeline["max_parallel"]:
                    reason = _skip_reason(i, st, only, mode)
                    settle(i, st, reason)
                    if not reason:
                        running[pool.submit(_one, i, st, ctx)] = st["id"]
            if running:
                finished, _ = wait(list(running), timeout=0.5, return_when=FIRST_COMPLETED)
                for fut in finished:
                    status[running.pop(fut)] = fut.result()
    return {sid: status[sid] for sid in index}


def _mode(pipeline, mode):
    if not pipeline["modes"]:
        if mode is not None:
            raise config.ConfigError(f"{pipeline['id']} has no modes")
        return None
    mode = mode or pipeline["default_mode"]
    if mode not in pipeline["modes"]:
        raise config.ConfigError(f"{pipeline['id']}: mode must be one of {', '.join(pipeline['modes'])}")
    return mode


def _on_signal(cancel):
    """SIGTERM and SIGINT cancel the run (main thread only: the portal's tests call run() from other threads)."""
    if threading.current_thread() is not threading.main_thread():
        return lambda: None
    old = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT)}
    for s in old:
        signal.signal(s, lambda *_: cancel.write_text(""))
    return lambda: [signal.signal(s, h) for s, h in old.items()]


def run(repo, pipeline_id, events, python=None, on_line=None, only=None, trigger="cli", mode=None):
    """`only`: run just that step (0-based). `trigger`: cli, portal or schedule. `mode`: one of the pipeline's modes."""
    pipeline = next((p for p in config.load(repo) if p["id"] == pipeline_id), None)
    if pipeline is None:
        raise config.ConfigError(f"no pipeline {pipeline_id!r} in {config.FILE}")
    if only is not None and not 0 <= only < len(pipeline["steps"]):
        raise config.ConfigError(f"{pipeline_id} has no step {only + 1}")
    mode = _mode(pipeline, mode)
    python = python or shutil.which("python3") or shutil.which("python") or sys.executable
    lock_file, name = Path(events).parent / f"{pipeline_id}.lock", Path(events).name
    lock.adopt(lock_file, name)  # Busy when another run of this pipeline is alive
    cancel, ev, t0, status = cancel_path(events), _Events(events, on_line), time.monotonic(), "failed"
    restore = _on_signal(cancel)
    base = {"AMAUTA_PIPELINE": pipeline_id, "AMAUTA_PIPELINE_TRIGGER": trigger, "AMAUTA_PIPELINE_MODE": mode or ""}
    ctx = {"repo": repo, "python": python, "ev": ev, "cancel": cancel,
           "env": lambda i: proc.step_env({**base, "AMAUTA_PIPELINE_STEP": str(i + 1)})}
    try:
        steps = pipeline["steps"]
        ev.emit("run-start", pipeline=pipeline_id, name=pipeline["name"], steps=[s["name"] for s in steps], ids=[s["id"] for s in steps],
                needs={s["id"]: s["needs"] for s in steps}, trigger=trigger, only=only, mode=mode, pid=os.getpid())
        results = _schedule(pipeline, ctx, only, mode).values()
        status = "cancelled" if cancel.exists() or "cancelled" in results else ("ok" if all(r in DONE for r in results) else "failed")
    except KeyboardInterrupt:
        cancel.write_text("")
        status = "cancelled"
    finally:
        restore()
        ev.emit("run-end", status=status, seconds=round(time.monotonic() - t0, 1))
        ev.f.close()
        cancel.unlink(missing_ok=True)
        lock.drop(lock_file, name)
    return {"ok": 0, "failed": 1, "cancelled": 130}[status]
