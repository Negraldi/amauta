"""python3 -P -m gentle_lite.portal [--port 8765] [--claude-home] [--engram-db] [--repo PATH]... [--graphify PATH]"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .. import paths
from .config import Config
from .server import make_server


def build_parser():
    p = argparse.ArgumentParser(prog="gentle_lite.portal", description="Read-only local control portal on 127.0.0.1.")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--claude-home")
    p.add_argument("--engram-db")
    p.add_argument("--repo", action="append", default=[], help="repository whose odd/tasks/*.md to show (repeatable)")
    p.add_argument("--graphify", help="graphify-out directory or graph.json")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    cfg = Config(
        state_dir=paths.state_dir(),
        claude_home=args.claude_home or paths.claude_home(),
        engram_db=args.engram_db or Path.home() / ".engram" / "engram.db",
        repos=args.repo,
        graphify=args.graphify,
    )
    try:
        srv = make_server(cfg, port=args.port)
    except OSError as err:
        sys.stderr.write(f"gentle-lite portal: cannot listen on 127.0.0.1:{args.port}: {err.strerror}\n")
        return 1
    sys.stdout.write(f"gentle-lite portal: http://127.0.0.1:{srv.port}/  (Ctrl+C to stop)\n")
    sys.stdout.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
