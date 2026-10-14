"""Fixture builder shared by the portal tests: a complete fake state dir, Claude home, engram DB and repo."""
import json
import sqlite3
from pathlib import Path

from python.gentle_lite.memory import store as mstore
from python.gentle_lite.usage import ingest
from python.tests.test_usage import assistant, tool_use, write_jsonl

XSS = "<img src=x onerror=alert(1)>"


def usage_blob(inp, out, cr, w5=0, w1=0, think=0):
    return {
        "input_tokens": inp, "output_tokens": out, "cache_read_input_tokens": cr, "cache_creation_input_tokens": w5 + w1,
        "cache_creation": {"ephemeral_5m_input_tokens": w5, "ephemeral_1h_input_tokens": w1},
        "output_tokens_details": {"thinking_tokens": think},
    }


def build(root: Path) -> dict:
    state = root / "state"
    home = root / "claude"
    repo = root / "repo"
    engram = root / "engram.db"

    p1 = home / "projects" / "-work-alpha" / "s1.jsonl"
    p2 = home / "projects" / "-work-beta" / "s2.jsonl"
    write_jsonl(p1, [
        assistant("a1", [tool_use("Skill", "t1", skill="work-unit-commits"), tool_use("Bash", "t2", command="ls")], usage=usage_blob(100, 50, 800, 100, 0, 5), session="s1", ts="2026-10-01T10:00:00.000Z", cwd="/work/alpha"),
        assistant("a2", [tool_use("Agent", "t3", subagent_type="sdd-apply"), tool_use("mcp__engram__mem_save", "t4")], usage=usage_blob(50, 25, 100, 0, 50), session="s1", ts="2026-10-02T10:00:00.000Z", cwd="/work/alpha", model="claude-y"),
    ])
    write_jsonl(p2, [
        assistant("b1", [tool_use("Read", "t5")], usage=usage_blob(10, 10, 0, 0, 0), session="s2", ts="2026-10-02T11:00:00.000Z", cwd="/work/beta"),
    ])

    conn = mstore.connect(state / "memory.db")
    ingest.backfill(conn, home)
    st = mstore.Store(state / "memory.db")
    st.save(XSS, "body one about widgets", type="decision", topic_key="arch/widgets", project="alpha")
    st.save(XSS, "body two about widgets revised", type="decision", topic_key="arch/widgets", project="alpha")  # upsert -> revision 2
    st.save("Other note", "gadgets", type="note", project="beta")
    st.close()
    conn.execute("INSERT INTO events (ts, session_id, event, tool_name, project, payload_bytes, ok) VALUES (?,?,?,?,?,1,1)", ("2026-10-02T10:00:00Z", "s1", "PostToolUse", "Bash", "alpha"))
    conn.commit()
    conn.close()

    e = sqlite3.connect(engram)
    e.executescript(
        """
        CREATE TABLE observations (id INTEGER PRIMARY KEY, sync_id TEXT, session_id TEXT, type TEXT, title TEXT, content TEXT,
          project TEXT, scope TEXT, topic_key TEXT, revision_count INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT, deleted_at TEXT);
        INSERT INTO observations (id, type, title, content, project, scope, topic_key, revision_count, created_at, updated_at)
          VALUES (1, 'bugfix', 'Engram bug', 'fixed the frobnicator', 'alpha', 'project', 'bug/frob', 3, '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z');
        """
    )
    e.commit()
    e.close()

    mem = home / "projects" / "-work-alpha" / "memory"
    mem.mkdir(parents=True, exist_ok=True)
    (mem / "note.md").write_text(f"# Hello\n{XSS}\n")
    (home / "settings.json").write_text(json.dumps({"hooks": {
        "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "env PYTHONPATH=/r python3 -P -m gentle_lite.usage hook"}, {"type": "command", "command": "echo SECRET-USER-HOOK"}]}],
        "SessionStart": [{"matcher": "", "hooks": [{"type": "command", "command": "node /r/bin/gentle-lite.js hook review-stop"}]}],
    }}))
    cj = root / "claude.json"
    cj.write_text(json.dumps({"mcpServers": {"engram": {"type": "stdio", "command": "python3", "args": ["-P"], "env": {"TOKEN": "SECRET-ENV"}}, "other": {"command": "foo"}}}))
    state.mkdir(parents=True, exist_ok=True)
    (state / "state.json").write_text(json.dumps({
        "version": "0.1.0", "installed_at": "2026-10-01T00:00:00Z", "claude_home": str(home), "claude_json": str(cj),
        "components": ["core"], "persona": "neutral", "rdd_mode": "on", "telemetry": True, "managed_files": {"a": "h", "b": "h"},
        "memory_server_key": "engram",
    }))
    (state / "telemetry.dropped").write_bytes(b"xxx")
    (repo / "odd" / "tasks").mkdir(parents=True)
    (repo / "odd" / "tasks" / "feat.md").write_text("# Feature\n\n- [x] T1 Done thing\n- [ ] T2 Open thing\n  - [x] nested ignored\n- [x] T3 Another\n")
    from python.gentle_lite.graph import sync
    from python.tests.test_graph import GRAPH, write_graph

    write_graph(repo, GRAPH)  # graphify-out/graph.json inside the repo, mirrored like the post-commit hook does
    c = mstore.connect(state / "memory.db")
    sync.sync_repo(c, repo)
    c.close()
    return {"state": state, "home": home, "repo": repo, "engram": engram, "claude_json": cj}
