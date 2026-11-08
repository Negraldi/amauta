# 0006 Code security: checks at edit and at Stop, per-project trust

Status: accepted 2026-11-07.

## Context

The user wants compiler-like feedback ("like Rust"): after an edit the agent sees `file:line:col: error: message` and
fixes it in the same turn. Some checkers execute repository code (cargo build scripts and proc macros, eslint and tsc
configuration, mypy plugins).

## Decision

- One checks engine in the kernel, one finding format, an error baseline per file so only new errors block.
- `PostToolUse` on edits runs the fast checker for the edited file (<= 10 s); the Stop check runs project checkers for
  the languages touched (<= 120 s). Both are on by default (`--without-checks` turns them off).
- By default only checkers that do not execute repository code run; the others need `amauta check trust` per project.
- Stop policy is shared with the review reminder: one combined block, at most two per turn, `stop_hook_active`
  honoured.
- AGENTS.md "hooks fail open with empty stdout" gains documented exceptions: checks and privacy hooks print decisions.
  A hook that crashes still fails open, but its failure is visible in `status`, the portal and at SessionStart.

## Amendment 2026-11-08 (plan D6)

The Stop check runs inside the one Stop hook, whose timeout stays at 60 s like every other hook; the project
checkers share a 40 s budget instead of 120 s. Only changed files are reported, so no project-wide baseline is kept.

## Consequences

Checkers are detected on PATH and never installed. Secrets in edited code are reported by the same detector catalog
as data security.
