"""`amauta pipeline list | run ID | status [--json] | cancel ID` (plan S1a, ADR 0010); the project is the git root of
--cwd (default: the current directory). `run` prints each output line as `[step] text` while it runs."""

import argparse
import json
import subprocess
import sys
from pathlib import Path

from ... import paths as amauta_paths
from . import config, runner, store


def _repo(cwd):
    r = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return Path(r.stdout.strip()).resolve() if r.returncode == 0 and r.stdout.strip() else Path(cwd).resolve()


def main(argv=None):
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--cwd", default=".")
    common.add_argument("--state-dir")
    p = argparse.ArgumentParser(prog="amauta pipeline", description="Run a project's pipelines (.amauta/pipelines.json).")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", parents=[common])
    r = sub.add_parser("run", parents=[common])
    r.add_argument("id")
    r.add_argument("--python", help="interpreter for python steps (default: python3 on PATH)")
    r.add_argument("--events", help="events file (default: a new file in the state directory)")
    sub.add_parser("status", parents=[common]).add_argument("--json", action="store_true")
    sub.add_parser("cancel", parents=[common]).add_argument("id")
    a = p.parse_args(argv)
    state = Path(a.state_dir) if a.state_dir else amauta_paths.state_dir()
    repo = _repo(a.cwd)
    try:
        return _run(a, state, repo)
    except config.ConfigError as e:
        print(f"amauta pipeline: {e}", file=sys.stderr)
        return 2


def _run(a, state, repo):
    if a.cmd == "list":
        for p in config.load(repo):
            print(f"{p['id']}: {p['name']} ({len(p['steps'])} step{'' if len(p['steps']) == 1 else 's'})")
        return 0
    if a.cmd == "run":
        events = Path(a.events) if a.events else store.new_run(state, repo, a.id)
        code = runner.run(repo, a.id, events, python=a.python, on_line=lambda name, text: print(f"[{name}] {text}", flush=True))
        print(f"{a.id}: {['ok', 'failed'][code == 1] if code != 130 else 'cancelled'}  ({events})")
        return code
    runs = store.last_runs(state, repo)
    if a.cmd == "cancel":
        run = runs.get(a.id)
        if not run or run["status"] != "running":
            print(f"amauta pipeline: {a.id} is not running", file=sys.stderr)
            return 1
        runner.cancel_path(run["events"]).write_text("")
        return 0
    lines = [f"{k}: {v['status']} ({v['started']})" for k, v in runs.items()]
    print(json.dumps(runs, indent=1) if a.json else "\n".join(lines) or "no runs yet")
    return 0


if __name__ == "__main__":
    sys.exit(main())
