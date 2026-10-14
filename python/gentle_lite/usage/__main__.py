"""python3 -P -m gentle_lite.usage <hook|backfill>"""
from __future__ import annotations

import sys


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["hook"]:
        try:
            from .hook import main as hook_main

            return hook_main()
        except Exception:
            return 0

    import argparse
    import json

    from .. import paths
    from ..memory import store as mstore
    from . import ingest

    parser = argparse.ArgumentParser(prog="gentle_lite.usage", epilog="The Claude Code hook entrypoint is `hook` (reads the hook payload on stdin); it is handled before argparse.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    bf = sub.add_parser("backfill", help="ingest every transcript under <claude-home>/projects")
    bf.add_argument("--claude-home")
    args = parser.parse_args(argv)
    if args.cmd != "backfill":  # unreachable while backfill is the only subcommand; guards future ones
        parser.error(f"unknown command {args.cmd}")
    home = args.claude_home or paths.claude_home()
    conn = mstore.connect(paths.db_path())
    try:
        result = ingest.backfill(conn, home)
    finally:
        conn.close()
    sys.stdout.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
