"""python3 -m amauta.memory <serve|import-engram|current-project>"""
from __future__ import annotations

import argparse
import sys

from .. import paths
from . import importer, server, store as mstore


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="amauta.memory")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("serve", help="run the MCP server over stdio")
    imp = sub.add_parser("import-engram", help="copy sessions/observations/prompts from an engram database (read-only)")
    imp.add_argument("--from", dest="source", required=True)
    sub.add_parser("current-project", help="print the detected project name")
    args = parser.parse_args(argv)

    if args.cmd == "current-project":
        print(mstore.detect_project())
        return 0
    store = mstore.Store(paths.db_path())
    try:
        if args.cmd == "serve":
            server.serve(store)
            return 0
        try:
            counts = importer.import_engram(args.source, store)
        except Exception as e:  # report any import failure plainly
            print(f"import failed: {e}", file=sys.stderr)
            return 1
        for name, n in counts.items():
            print(f"{name}: {n}")
        return 0
    finally:
        store.close()


if __name__ == "__main__":
    sys.exit(main())
