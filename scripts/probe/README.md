# Runtime probe (plan N1)

A throwaway hook that records how Claude Code and Codex run hooks on a real machine. It answers the questions the
Windows and Codex work depends on. Nothing here is installed by `amauta install`; use a scratch project and remove the
hook entries afterwards.

## Setup (scratch project only)

1. Create an empty folder, run `git init` in it, and note the absolute path of this file's sibling `probe-hook.mjs`
   (use forward slashes on Windows: `C:/Users/me/amauta/scripts/probe/probe-hook.mjs`).
2. Claude Code: create `.claude/settings.json` in the scratch project:

   ```json
   {
     "hooks": {
       "PreToolUse": [{ "matcher": "Read", "hooks": [{ "type": "command", "command": "node \"C:/path/to/probe-hook.mjs\" --ask" }] }],
       "PostToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node \"C:/path/to/probe-hook.mjs\" --block" }] }],
       "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \"C:/path/to/probe-hook.mjs\"" }] }]
     }
   }
   ```

3. Codex: put the same three entries in `.codex/hooks.json` of the scratch project (or your Codex home, then remove
   them), with `AMAUTA_RUNTIME=codex` set in the environment of the Codex session if possible.

## What to try in each client

| # | Ask the agent to... | What to look for |
| --- | --- | --- |
| 1 | read any file | You are asked to confirm (PreToolUse `ask`) |
| 2 | create a file `a.txt` | The agent says it saw "amauta probe: PostToolUse block reached the agent" |
| 3 | use a subagent that reads a file | A log row from inside the subagent (`payloadKeys` may include an agent id) |
| 4 | continue the same subagent with a follow-up | Whether the client can resume a subagent with its context |
| 5 | Codex only: list its custom agents if `.codex/agents/*.toml` exists | Whether Codex loads TOML agent definitions |

## Send back

The log file, by default `%TEMP%\amauta-probe.jsonl` on Windows or `$TMPDIR/amauta-probe.jsonl` elsewhere
(override with `AMAUTA_PROBE_LOG`), plus a line per row of the table saying what happened. The log holds event names,
payload key names, the shell variables `SHELL`, `ComSpec`, `MSYSTEM`, whether `PSModulePath` is set, the working
directory and the startup time; no prompt text or tool input.
