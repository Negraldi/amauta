# Upgrading

## From 0.3.1 to 0.4.0

```bash
amauta upgrade --to v0.4.0
```

- Codex is installed automatically when `~/.codex` exists; otherwise add it with `amauta install --runtime both` (or `--runtime codex`). `amauta status` shows both runtimes and what differs between them.
- Existing real copies in `~/.claude/skills` become links to the shared store `~/.amauta/skills`, unless you edited them: edited copies are kept and reported (`--force` replaces them).
- Import past Codex usage once: `python3 -P -m amauta.usage backfill --runtime all`.
- Codex asks you to trust the new hooks the first time it starts; amauta never writes that trust itself.
- The memory database is not migrated: 0.4.0 adds a `runtime` column to the usage tables through an idempotent step, and 0.3.1 ignores it.
- Rollback: `amauta upgrade --to v0.3.1`. The Codex files amauta wrote stay in place until you run `amauta uninstall --runtime codex` before rolling back.

## From 0.3.0 to 0.3.1

```bash
amauta upgrade --to v0.3.1
```

Nothing to migrate. Project paths outside your home directory (for example `/mnt/datos/...`) can now be added in Settings > Projects or in `~/.amauta/portal.json`; open the Harness wiki and press "Refresh descriptions" once to fill MCP servers with large tool lists such as rea. Rollback: `amauta upgrade --to v0.3.0`.

## From 0.2.0 to 0.3.0

```bash
amauta upgrade --dry-run          # current version, target tag and plan; changes nothing
amauta upgrade --to v0.3.0        # or plain `amauta upgrade` for the latest tag; add --yes to skip the confirmation
```

The command, its checks and the manual alternative are the same as in the 0.1.0 to 0.2.0 section below. Start a new Claude Code session afterwards (hooks, skills and MCP servers are read at session start); a portal that is already open keeps the old code until you close and reopen it.

### What changes on disk

- A new skill, `amauta-wiki-explain`, is installed with the harness. Nothing else is added to `~/.claude` that you did not already have.
- New optional files in the state directory (`~/.amauta` by default), created only when you use the feature: `portal.json` (project paths), `themes/*.json` (custom themes), `wiki/` (cached MCP tool descriptions, explanation requests and notes). The telemetry schema does not change.
- The desktop launcher does not need reinstalling: its entry runs `amauta portal launch`, which now also passes the repos listed in `portal.json`. Run `amauta portal install-launcher` only if you have never created it.

### Use the new features

- **Projects.** The portal finds projects from `--repo DIR`, from `~/.amauta/portal.json` and, while `auto_discover` is true (the default), from the git roots of your session working directories under `$HOME`. To list them yourself write `{"repos": ["/home/you/code/app"], "auto_discover": true}` (set `auto_discover` to false to use only the listed paths), or add and remove paths in Settings > Projects.
- **Themes.** Pick System, Light, Dark or a custom theme in the top bar. Create, edit, import and export themes at `#/themes`; they are stored as `~/.amauta/themes/<name>.json`, and you can also drop a valid file there by hand.
- **Language.** The language switch in the top bar changes the portal chrome between English and Spanish and remembers your choice; the default follows the browser language. Your own text is never translated.
- **Explanations.** On a component page, "Request explanation" queues a request; "Refresh descriptions" on an MCP server page asks that local server for its tool list. To write the explanations, tell Claude Code: "process the wiki explanation requests". The `amauta-wiki-explain` skill reads the queue (`python3 -P -m amauta.portal.wikiexplain list`), writes a note per component (`... write --kind K --id I --file note.md`) and the portal shows it; the lint flags a note when its component changes.

### Rolling back

```bash
amauta upgrade --to v0.2.0
```

Custom themes, `portal.json` and wiki notes stay in the state directory and are ignored by 0.2.0.

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
