"""State directory resolution, consistent with the Node CLI (AMAUTA_STATE_DIR, else ~/.amauta)."""
from __future__ import annotations

import os
from pathlib import Path


def state_dir(env=None, home: Path | None = None) -> Path:
    env = os.environ if env is None else env
    configured = env.get("AMAUTA_STATE_DIR")
    if configured:
        return Path(configured)
    return (home or Path.home()) / ".amauta"


def db_path(env=None) -> Path:
    return state_dir(env) / "memory.db"


def claude_home(env=None, home: Path | None = None) -> Path:
    env = os.environ if env is None else env
    configured = env.get("AMAUTA_CLAUDE_HOME")
    if configured:
        return Path(configured)
    return (home or Path.home()) / ".claude"


def codex_home(env=None, home: Path | None = None, claude_home=None) -> Path:
    """Same order as resolveCodexTargets in src/install/paths.js: AMAUTA_CODEX_HOME, then a custom Claude home (the
    `claude_home` argument or AMAUTA_CLAUDE_HOME) keeps Codex inside it as `<claude home>/.codex`, then CODEX_HOME,
    then ~/.codex. Empty values count as unset (Codex ignores an empty CODEX_HOME)."""
    env = os.environ if env is None else env
    configured = env.get("AMAUTA_CODEX_HOME")
    if configured:
        return Path(configured)
    custom_claude = claude_home or env.get("AMAUTA_CLAUDE_HOME")
    if custom_claude:
        return Path(custom_claude) / ".codex"
    ambient = env.get("CODEX_HOME")
    if ambient:
        return Path(ambient)
    return (home or Path.home()) / ".codex"


def runtime(env=None) -> str:
    """The runtime that launched the hook: 'codex' when AMAUTA_RUNTIME says so, else 'claude' (anything else is ignored)."""
    env = os.environ if env is None else env
    return "codex" if env.get("AMAUTA_RUNTIME") == "codex" else "claude"
