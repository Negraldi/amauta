# Migrating from gentle-ai

A one-time migration script; dry run by default.

## Migrating from gentle-ai

`scripts/migrate.sh` replaces gentle-ai with amauta for Claude Code (they do not coexist). Close Claude Code, then run it from a terminal:

```
scripts/migrate.sh            # dry run: prints every action, changes nothing
scripts/migrate.sh --execute  # asks y/N before each phase
```

Phases: preflight, backup (`~/amauta-migration/<timestamp>/backup.tar.gz` with sha256), engram memory import, `gentle-ai uninstall --agent claude-code` (gentle-ai asks its own confirmation), disable the `engram@engram` plugin, `amauta install --with-sdd --with-rea --with-context7 --with-impeccable`, verification. Re-running resumes unfinished phases; after a finished run it does nothing, and after a rollback a new `--execute` starts a NEW run directory (an existing `backup.tar.gz` is never overwritten). The backup directory is `0700` and its files `0600`. gentle-ai's own uninstall prompt runs on your real terminal and is not logged. To undo: `scripts/rollback.sh ~/amauta-migration/<timestamp>` (restores config, only `mcpServers` of `~/.claude.json`, never `~/.claude/projects`; replaced files are moved aside, not deleted; works even if amauta was never installed; the backup directory is kept and marked `rolled-back`). `--assume-yes` exists only for the automated tests.
