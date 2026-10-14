"""python3 -m gentle_lite.telemetry <hook|report>"""
from __future__ import annotations

import sys


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["hook"]:
        try:
            from .hook import main as hook_main  # lean import path: this runs on every tool call

            return hook_main()
        except Exception:  # fail open, even if the module cannot be imported
            return 0

    import argparse
    import json

    from .. import paths
    from . import report

    parser = argparse.ArgumentParser(prog="gentle_lite.telemetry")
    sub = parser.add_subparsers(dest="cmd", required=True)
    rep = sub.add_parser("report", help="summarize recorded events")
    rep.add_argument("--days", type=int, default=7)
    rep.add_argument("--json", action="store_true")
    sub.add_parser("hook", help="record one Claude Code hook event from stdin")
    pr = sub.add_parser("prune", help="delete events older than N days")
    pr.add_argument("--days", type=int, required=True)
    args = parser.parse_args(argv)
    if args.cmd == "prune":
        from ..memory import store as mstore
        from . import housekeeping

        if args.days < 1:
            parser.error("--days must be >= 1")
        conn = mstore.connect(paths.db_path())
        try:
            deleted = housekeeping.prune(conn, args.days)
        finally:
            conn.close()
        sys.stdout.write(json.dumps({"deleted": deleted, "days": args.days}) + "\n")
        return 0
    data = report.build(paths.db_path(), days=args.days)
    sys.stdout.write(json.dumps(data, indent=2) + "\n" if args.json else report.render(data))
    return 0


if __name__ == "__main__":
    sys.exit(main())
