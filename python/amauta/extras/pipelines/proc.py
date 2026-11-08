"""One step's process (ADR 0010, review R4-R6): its argv (never a shell), environment and working folder; reading its
output line by line; stopping its whole process tree on timeout or cancel.

A step owns its processes. On POSIX it starts in its own process group, and when its main process exits the group is
stopped, so a background child cannot hold the step open past its end or its timeout. On Windows `taskkill /T` stops
the tree while the main process lives; a child that outlives it can keep the output open (documented limit).
Paths of scripts and notebooks are taken from the project root; `cwd` only sets the working folder.
"""

import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

WINDOWS = sys.platform == "win32"
AMAUTA_PYTHON = str(Path(__file__).resolve().parents[3])  # the folder amauta adds to PYTHONPATH for its own modules


class Escape(ValueError):
    """A path that leads outside the project."""


def inside(repo, rel):
    """The real path of `rel` under the project, refusing a symlink (or anything) that leads outside it."""
    root = Path(os.path.realpath(repo))
    real = Path(os.path.realpath(root / rel))
    if real != root and root not in real.parents:
        raise Escape(f"{rel} leads outside the project ({real})")
    return real


def argv_for(step, repo, python):
    if step["type"] == "command":
        return list(step["argv"])
    if step["type"] in ("python", "r"):
        default = python if step["type"] == "python" else "Rscript"
        return [step.get("interpreter") or default, str(inside(repo, step["script"])), *step["args"]]
    nb = inside(repo, step["path"])
    out = f"{nb.stem}.run.ipynb"  # the source notebook is never overwritten
    return ["jupyter", "nbconvert", "--to", "notebook", "--execute", "--output", out, str(nb)]


def step_env(extra):
    """The caller's environment for a step, with the user's own PYTHONPATH (amauta's module folder removed)."""
    env = dict(os.environ)
    user = env.pop("AMAUTA_USER_PYTHONPATH", None)
    if user is None:
        user = os.pathsep.join(p for p in env.get("PYTHONPATH", "").split(os.pathsep)
                               if p and os.path.realpath(p) != os.path.realpath(AMAUTA_PYTHON))
    if user:
        env["PYTHONPATH"] = user
    else:
        env.pop("PYTHONPATH", None)
    return {**env, **extra}


def kill_tree(proc):
    try:
        if WINDOWS:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
            return
        os.killpg(proc.pid, signal.SIGTERM)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            os.killpg(proc.pid, 0)  # raises once the whole group is gone
            time.sleep(0.1)
        os.killpg(proc.pid, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        pass


def _watch(proc, timeout, cancel, done, stop):
    """Until the output closes: stop the tree on timeout or cancel; on POSIX stop leftovers once the main process ends."""
    deadline, swept = time.monotonic() + timeout, False
    while not done.is_set():
        if cancel.exists() or time.monotonic() > deadline:
            stop["why"] = "cancelled" if cancel.exists() else "timeout"
            kill_tree(proc)
            return
        if proc.poll() is not None and not swept and not WINDOWS:
            swept = True
            try:
                os.killpg(proc.pid, signal.SIGKILL)  # what the step left running in the background
            except (OSError, ProcessLookupError):
                pass
        time.sleep(0.1)


def run(step, repo, python, env, cancel, on_line):
    """Run one attempt of a step; "ok", "failed", "timeout" or "cancelled". Each output line goes to `on_line`."""
    cwd = Path(repo) / step["cwd"]
    if not cwd.is_dir():
        on_line(f"cwd {step['cwd']} is not a folder")
        return "failed"
    try:
        argv = argv_for(step, repo, python)
        flags = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | 0x08000000} if WINDOWS else {"start_new_session": True}
        proc = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", **flags)
    except Escape as e:
        on_line(str(e))
        return "failed"
    except OSError as e:
        on_line(f"cannot start {argv[0]}: {e.strerror or e}")
        return "failed"
    done, stop = threading.Event(), {"why": None}
    watcher = threading.Thread(target=_watch, args=(proc, step["timeout"], cancel, done, stop), daemon=True)
    watcher.start()
    with proc.stdout:
        for raw in proc.stdout:
            on_line(raw)
    done.set()
    proc.wait()
    watcher.join(timeout=5)
    if not WINDOWS:  # a step owns its process group: stop what it left behind, with or without its output
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass
    return stop["why"] or ("ok" if proc.returncode == 0 else "failed")
