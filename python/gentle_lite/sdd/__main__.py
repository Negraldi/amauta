"""python3 -P -m gentle_lite.sdd <status|continue|preflight-hook>"""
from __future__ import annotations

import sys


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["preflight-hook"]:  # handled before argparse: it must never fail with a usage error
        from .preflight import main as hook_main

        return hook_main()

    import argparse
    import json

    from . import status

    parser = argparse.ArgumentParser(prog="gentle_lite.sdd", epilog="`preflight-hook` is the Claude Code PreToolUse hook entrypoint (payload on stdin).")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name, help_ in (("status", "read-only SDD status for an OpenSpec change"), ("continue", "read-only dispatcher view (same data, with phase instructions)")):
        p = sub.add_parser(name, help=help_)
        p.add_argument("change", nargs="?")
        p.add_argument("--cwd", default=".")
        if name == "status":
            p.add_argument("--json", action="store_true", help="print only the JSON document")
            p.add_argument("--instructions", action="store_true", help="include phaseInstructions")
    args = parser.parse_args(argv)
    try:
        s = status.compute(args.cwd, args.change, instructions=args.cmd == "continue" or args.instructions)
    except status.StatusError as err:
        sys.stderr.write(f"gentle-lite sdd: {err}\n")
        return 1
    if args.cmd == "continue":
        sys.stdout.write(status.render_dispatcher(s))
    elif args.json:
        sys.stdout.write(json.dumps(s, indent=2) + "\n")
    else:
        sys.stdout.write(status.render_markdown(s))
    return 0


if __name__ == "__main__":
    sys.exit(main())
