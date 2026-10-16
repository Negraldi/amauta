# Upgrading

## From 0.1.0 to 0.2.0

Your install is a git clone. Updating means moving that clone to the new release and running `amauta install` again from it. Your sticky choices (persona, optional modules, review mode) are kept.

### The easy way

```bash
amauta upgrade --dry-run   # shows the current version, the target and the plan; changes nothing
amauta upgrade             # asks for confirmation (use --yes to skip it)
```

`amauta upgrade` refuses to run when the clone has uncommitted changes or is not on a branch that tracks `origin`, and tells you how to fix it. It then runs `git fetch --tags origin`, fast-forwards your branch to the latest `vX.Y.Z` tag (`git merge --ff-only`), runs `amauta install` and `amauta status` from the new checkout, and prints the rollback command. Pass `--claude-home`, `--claude-json` and `--state-dir` if you use non-default locations.

### The manual way

```bash
cd <your amauta clone>
git pull --ff-only
git fetch --tags
amauta install
amauta status
```

### Afterwards

Start a new Claude Code session: hooks, skills and MCP servers are read at session start.

### What changes on disk

- New skills `archify` and `impeccable` are installed only if you enable them (`amauta install --with-archify`, `--with-impeccable`); `--without-<module>` turns one off again.
- The portal gains a desktop launcher, created only when you run `amauta portal install-launcher`.
- The telemetry database in the state directory migrates to schema v7 on first use. The migration is additive (new columns and an index) and older versions ignore them; the next usage backfill refills outcome data from your transcripts.
- Settings written through the portal create installer backups; nothing else is touched without your action.

### Rolling back

```bash
amauta upgrade --to v0.1.0   # detaches the clone at the old tag, then reinstalls
```

This leaves the clone on a detached HEAD, and 0.1.0 has no `upgrade` command. To come back to your branch: `git -C <clone> checkout main && amauta install`.

You can also restore the files the installer changed from its backups: `amauta restore --backup <id>` (the backup id is printed by `install` and listed in the state directory).
