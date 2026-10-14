## Memory

Persistent memory is the `engram` MCP server (tools `mem_*`); it survives sessions and compaction.

- Session start: call `mem_current_project`, then `mem_context` with that project; pass the same `project` to later calls. If the project is unknown, skip reads instead of guessing.
- Save with `mem_save` right after a decision, bugfix, discovery, convention or config change. Use `type` = `decision` | `bugfix` | `discovery` | `convention` | `config`, a short title, and a stable `topic_key` for anything that evolves (same key updates the entry). Do not save what the repo, git history or code already shows, secrets, or transient chatter.
- On any reference to past work: `mem_context`, then `mem_search`, then `mem_get_observation` for the full text.
- Before saying "done", call `mem_session_summary` (goal, outcome, next step).
- Memory is bookkeeping, never the reply: save first, then end the turn with the complete user-facing answer. If a memory call fails, answer anyway.
