"""python3 -P -m amauta.portal [--port 8765] [--claude-home] [--engram-db] [--repo PATH]..."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .. import paths
from .config import Config
from .server import make_server, watch_idle


def build_parser():
    p = argparse.ArgumentParser(prog="amauta.portal", description="Read-only local control portal on 127.0.0.1.")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--claude-home")
    p.add_argument("--codex-home", help="Codex home to read (default: AMAUTA_CODEX_HOME, <claude home>/.codex for a custom Claude home, "
                   "CODEX_HOME, ~/.codex)")
    p.add_argument("--engram-db")
    p.add_argument("--repo", action="append", default=[], help="repository whose odd/tasks/*.md and mirrored graphify graph to show (repeatable)")
    p.add_argument("--idle-exit", type=float, default=None, metavar="SECONDS", help="exit cleanly after this many seconds without a page heartbeat (default: run until stopped)")
    return p


def build_config(args, env=None, home: Path | None = None) -> Config:
    """A --claude-home without --codex-home keeps the Codex home inside it, as the installer does."""
    return Config(
        state_dir=paths.state_dir(env, home),
        claude_home=args.claude_home or paths.claude_home(env, home),
        codex_home=args.codex_home or paths.codex_home(env, home, claude_home=args.claude_home),
        engram_db=args.engram_db or (home or Path.home()) / ".engram" / "engram.db",
        repos=args.repo,
    )


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    cfg = build_config(args)
    try:
        srv = make_server(cfg, port=args.port, idle_exit=args.idle_exit)
    except OSError as err:
        sys.stderr.write(f"amauta portal: cannot listen on 127.0.0.1:{args.port}: {err.strerror}\n")
        return 1
    sys.stdout.write(f"amauta portal: http://127.0.0.1:{srv.port}/  (Ctrl+C to stop)\n")
    sys.stdout.flush()
    if srv.idle is not None:
        watch_idle(srv)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
