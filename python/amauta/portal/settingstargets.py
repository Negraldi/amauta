"""The install targets a Settings change passes to `amauta install`: the Claude home and state dir, and the Codex home
and skills dir whenever a Codex home directory exists, so one preview, apply or undo covers both runtimes.

The Codex paths follow resolveCodexTargets (src/install/paths.js): a custom Claude home (anything but ~/.claude) keeps
every Codex path inside it unless a Codex home was given explicitly (Config.codex_home or AMAUTA_CODEX_HOME), so a
sandboxed portal never names the real ~/.codex or ~/.agents. Read-only: it only checks that the Codex home is a directory.
Also how the installer's JSON (Claude keys at the top, the Codex result under `codex`) is read back.
"""
from __future__ import annotations

import os
from pathlib import Path

from .. import paths


def codex_targets(cfg, env=None, home: Path | None = None):
    """(codex home, codex skills dir), or None when there is no Codex home directory to install into."""
    env = os.environ if env is None else env
    home = home or Path.home()
    custom_claude = Path(cfg.claude_home) != home / ".claude"
    if cfg.codex_home is not None:
        codex_home = Path(cfg.codex_home)
    else:
        codex_home = paths.codex_home(env, home, claude_home=cfg.claude_home if custom_claude else None)
    if not codex_home.is_dir():
        return None
    ambient = env.get("CODEX_HOME")
    sandboxed = custom_claude or (codex_home != home / ".codex" and not (ambient and codex_home == Path(ambient)))
    configured = env.get("AMAUTA_CODEX_SKILLS_DIR")
    if configured:
        skills = Path(configured)
    else:
        skills = codex_home / ".agents" / "skills" if sandboxed else home / ".agents" / "skills"
    return codex_home, skills


def target_args(cfg, claude_json=None, env=None, home: Path | None = None) -> list:
    """argv entries naming every install target; `claude_json` is the file the last install recorded, if any."""
    env = os.environ if env is None else env
    out = ["--claude-home", str(cfg.claude_home), "--state-dir", str(cfg.state_dir)]
    claude_json = env.get("AMAUTA_CLAUDE_JSON") or claude_json
    if isinstance(claude_json, str) and claude_json:
        out.append(f"--claude-json={claude_json}")
    codex = codex_targets(cfg, env, home)
    if codex is not None:
        out += ["--codex-home", str(codex[0]), "--codex-skills-dir", str(codex[1])]
    return out


PLAN_KEYS = ("changed", "files", "removed", "skipped", "state_changes", "impeccable")


def plan_view(plan: dict) -> dict:
    """What a preview shows of the installer's dry run; the Codex part (`codex`) only when Codex was a target."""
    view = {k: plan.get(k) for k in PLAN_KEYS if k in plan}
    if isinstance(plan.get("codex"), dict):
        view["codex"] = {k: plan["codex"].get(k) for k in ("changed", "files", "removed", "skipped") if k in plan["codex"]}
    return view


def backup_id_of(result) -> str | None:
    backup = result.get("backup") if isinstance(result, dict) else None
    return os.path.basename(backup) if isinstance(backup, str) and backup else None
