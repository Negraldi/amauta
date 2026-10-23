"""python3 -P -m amauta.usage <hook|backfill>"""
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

    parser = argparse.ArgumentParser(prog="amauta.usage", epilog="The Claude Code hook entrypoint is `hook` (reads the hook payload on stdin); it is handled before argparse.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    bf = sub.add_parser("backfill", help="ingest every transcript under <claude-home>/projects and/or every rollout under <codex-home>/sessions")
    bf.add_argument("--claude-home")
    bf.add_argument("--codex-home")
    bf.add_argument("--runtime", choices=("claude", "codex", "all"), default="claude", help="what to ingest (default: claude)")
    args = parser.parse_args(argv)
    if args.cmd != "backfill":  # unreachable while backfill is the only subcommand; guards future ones
        parser.error(f"unknown command {args.cmd}")
    conn = mstore.connect(paths.db_path())
    result = {}
    try:
        if args.runtime in ("claude", "all"):
            result.update(ingest.backfill(conn, args.claude_home or paths.claude_home()))
        if args.runtime in ("codex", "all"):
            from . import codex

            result["codex"] = codex.backfill(conn, args.codex_home or paths.codex_home())
    finally:
        conn.close()
    sys.stdout.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
