## CodeGraph

For structural or codebase questions (repo map, architecture, call flow, dependencies, references, impact), use CodeGraph before broad Read/Glob/Grep.

1. Resolve the project root with `git rev-parse --show-toplevel || pwd`. Never initialize in `$HOME`, temporary directories or non-project folders.
2. If `<root>/.codegraph/` is missing and CodeGraph is available, run `codegraph init` once from the root (no need to ask), then query.
3. Prefer the `codegraph_explore` MCP tool; without it use the read-only CLI (`codegraph status|query|explore|node|files|callers|callees|impact|affected`).
4. Each git worktree needs its own index, created under the home directory (never `/tmp`); never copy or symlink another checkout's `.codegraph/`.
5. Rely on the watcher after edits; run `codegraph sync` only when it reports stale files. Never run `codegraph uninit|install|uninstall|upgrade`; use `codegraph index` only to recover a corrupt index.
6. Fall back to filesystem tools only if CodeGraph fails, and say so briefly.
