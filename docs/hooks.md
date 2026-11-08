# Hooks

The hook handlers amauta registers and what each one does.

Hooks registered in `settings.json` (and `hooks.json` for Codex) run one command per event,
`node <repo>/bin/amauta.js hook event <Event> --state-dir DIR --with handler,...` (absolute path, no `PATH` dependency);
the dispatcher runs the handlers below in order (ADR 0002). They read the Claude Code hook JSON on stdin, always exit 0 and
fail open; an empty stdout is a no-op.

- `skill-registry` (UserPromptSubmit): refreshes `<project>/.atl/skill-registry.md` only for
  projects that opted in (an existing `.atl/` directory or `.atl/` in `.gitignore`; run
  `amauta skill-registry refresh` once to opt in). Skips `/`, `$HOME`, directories without
  a project marker and a symlinked `.atl`. Home paths are written as `~/...`.
- `review-stop` (SessionStart/Stop): when review is switched on and this session
  produced a candidate that `review assess` marks as due, blocks the stop once per candidate.
  The switch is off by default; clone-local `off` (in `.git/amauta-rdd-mode`) wins over global. SessionStart keeps the
  baseline only for an explicit `resume`/`compact`; `startup`, `clear`, a missing or an unknown `source` start from the
  current state.
- `privacy` (UserPromptSubmit, and PreToolUse on `Read|NotebookRead|NotebookEdit` in Claude Code): asks before a data
  file is read (CSV, TSV, Excel, Parquet, SPSS, Stata, SAS, R data, JSON Lines, SQLite and Access files outside
  `test`, `fixture`, `example` and `sample` folders, plus anything under the paths in `<state dir>/privacy.json`,
  `{"paths": [...]}`), and shows a warning when a prompt seems to hold a secret. It never denies and never repeats the
  text it found; a failure is silent (ADR 0007). Codex reads files through its shell, so it gets only the prompt check.
  Tools for the data itself: `amauta privacy scan|redact|pseudonymize` (counts, lines and columns, never values; the
  pseudonym key is `<state dir>/privacy.key`, 0600).
