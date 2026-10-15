"""State directory resolution, consistent with the Node CLI (GENTLE_LITE_STATE_DIR, else ~/.gentle-lite)."""
from __future__ import annotations

import os
from pathlib import Path


def state_dir(env=None, home: Path | None = None) -> Path:
    env = os.environ if env is None else env
    configured = env.get("GENTLE_LITE_STATE_DIR")
    if configured:
        return Path(configured)
    return (home or Path.home()) / ".gentle-lite"


def db_path(env=None) -> Path:
    return state_dir(env) / "memory.db"


def claude_home(env=None, home: Path | None = None) -> Path:
    env = os.environ if env is None else env
    configured = env.get("GENTLE_LITE_CLAUDE_HOME")
    if configured:
        return Path(configured)
    return (home or Path.home()) / ".claude"
