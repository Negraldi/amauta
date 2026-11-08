# Safety

How amauta keeps away from your real configuration and what it refuses.

## Safety model

- Hooks fail open (always exit 0, empty stdout = no-op) except the SDD preflight, which fails closed for `sdd-*` agents.
- Local only: no network code in telemetry/usage/portal; the portal binds `127.0.0.1`, opens databases read-only and writes only through guarded POSTs (see Security above).
- User content is preserved (hooks, MCP servers, `permissions`, CLAUDE.md text); files are backed up before
  every write and edited managed files are left alone on uninstall unless `--force`.
- Deliberately absent (unlike gentle-ai): consent envelopes, review receipts/lineage, network telemetry, self-update.

## Safety: parameterized targets

Nothing is hardcoded to the real home. Every target can be redirected, and tests
only ever use temp directories:

| Option | Environment variable | Default |
| --- | --- | --- |
| `--claude-home` | `AMAUTA_CLAUDE_HOME` | `~/.claude` |
| `--claude-json` | `AMAUTA_CLAUDE_JSON` | `~/.claude.json` |
| `--state-dir` | `AMAUTA_STATE_DIR` | `~/.amauta` |

If only `--claude-home` is given, the other two default to paths inside it
(`<home>/.claude.json`, `<home>/.amauta`), so a sandboxed install never touches the real home.

Every file is backed up under `<state-dir>/backups/<timestamp>/` before it is written.
Existing user content (CLAUDE.md text, hooks, MCP servers, `permissions.defaultMode`)
is preserved. `permissions.defaultMode` is never set or changed (upstream forces
`bypassPermissions`; amauta deliberately does not); only the `ask` and `deny` rules above are appended (a rule you already list is never recorded as ours), and uninstall removes just the ones amauta added. `deny_added` entries recorded by pre-T15 installs are never stripped on re-install or uninstall; `status` lists them as kept.
Files amauta installs are tracked by hash: if you edit one, re-install and uninstall keep your
version unless you pass `--force`.
