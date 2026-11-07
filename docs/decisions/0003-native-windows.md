# 0003 Native Windows support

Status: accepted 2026-11-07.

## Context

amauta assumes POSIX: hook commands use `env`, `sh`, `timeout` and `python3`; skills are shared with symlinks;
`graph/lock.py` reads `/proc`, uses `SIGHUP` (absent on Windows) and `os.kill(pid, 0)` (which sends CTRL_C_EVENT on
Windows); `findOnPath` ignores PATHEXT; the portal launcher writes a `.desktop` file.

## Decision

- The kernel runs natively on Windows in phase 1; graphify hooks and the desktop launcher follow.
- All hooks run as `node <bin> hook <name>`; one dispatcher process per event; Node starts Python with the interpreter
  resolved at install time (`--python` / `AMAUTA_PYTHON`, stored in state). No `env`, `sh` or `timeout` in commands.
- Skill links: directory junctions on Windows, falling back to a hash-managed copy that `amauta sync` keeps current.
- Git for Windows is a requirement (Claude Code already needs it; review, ODD commits and graphify need git).
- CI on Linux, macOS and Windows; Windows runs a marked portable subset that grows over time.

## Rejected

WSL only (no native users); requiring developer mode for symlinks.

## Consequences

Codex asks the user to trust changed hook commands once after the upgrade (UPGRADING notes). Native Claude Code and
Codex behavior on Windows is verified by the user with the probe script, not by CI.
