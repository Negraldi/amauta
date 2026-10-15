"""SQLite memory store. One database (memory.db) shared by memory and telemetry."""
from __future__ import annotations

import os
import re
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 5

_MIGRATIONS = {
    1: """
    CREATE TABLE sessions (
        id TEXT PRIMARY KEY, project TEXT, directory TEXT,
        started_at TEXT NOT NULL, ended_at TEXT, summary TEXT);
    CREATE TABLE observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT UNIQUE, session_id TEXT, project TEXT,
        scope TEXT NOT NULL DEFAULT 'project', type TEXT NOT NULL DEFAULT 'note',
        title TEXT NOT NULL, content TEXT NOT NULL, topic_key TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT);
    CREATE INDEX idx_obs_project ON observations(project, deleted_at, updated_at);
    CREATE INDEX idx_obs_topic ON observations(project, scope, topic_key);
    CREATE VIRTUAL TABLE observations_fts USING fts5(
        title, content, topic_key, content='observations', content_rowid='id');
    CREATE TRIGGER observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, content, topic_key)
        VALUES (new.id, new.title, new.content, new.topic_key);
    END;
    CREATE TRIGGER observations_ad AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, content, topic_key)
        VALUES ('delete', old.id, old.title, old.content, old.topic_key);
    END;
    CREATE TRIGGER observations_au AFTER UPDATE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, content, topic_key)
        VALUES ('delete', old.id, old.title, old.content, old.topic_key);
        INSERT INTO observations_fts(rowid, title, content, topic_key)
        VALUES (new.id, new.title, new.content, new.topic_key);
    END;
    CREATE TABLE prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT UNIQUE, session_id TEXT,
        project TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL);
    """,
    2: """
    CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, session_id TEXT, event TEXT NOT NULL,
        tool_name TEXT, cwd TEXT, project TEXT, duration_ms INTEGER,
        payload_bytes INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX idx_events_ts ON events(ts);
    """,
    3: """
    CREATE TABLE usage_messages (
        message_id TEXT PRIMARY KEY, session_id TEXT, project TEXT, model TEXT, ts TEXT,
        input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0,
        cache_read INTEGER NOT NULL DEFAULT 0, cache_write_5m INTEGER NOT NULL DEFAULT 0,
        cache_write_1h INTEGER NOT NULL DEFAULT 0, thinking INTEGER NOT NULL DEFAULT 0,
        sidechain INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX idx_usage_ts ON usage_messages(ts);
    CREATE INDEX idx_usage_session ON usage_messages(session_id);
    CREATE TABLE tool_calls (
        message_id TEXT NOT NULL, call_id TEXT NOT NULL, session_id TEXT, ts TEXT, tool TEXT NOT NULL,
        skill TEXT, subagent_type TEXT, mcp_server TEXT,
        PRIMARY KEY (message_id, call_id));
    CREATE INDEX idx_tool_calls_ts ON tool_calls(ts);
    CREATE TABLE ingest_state (
        path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime REAL NOT NULL, "offset" INTEGER NOT NULL);
    """,
    4: """
    CREATE TABLE graph_nodes (
        repo TEXT NOT NULL, id TEXT NOT NULL, label TEXT, kind TEXT, file TEXT, attrs_json TEXT,
        PRIMARY KEY (repo, id));
    CREATE INDEX idx_graph_nodes_label ON graph_nodes(repo, label COLLATE NOCASE);
    CREATE TABLE graph_edges (
        repo TEXT NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL, relation TEXT, attrs_json TEXT);
    CREATE INDEX idx_graph_edges_src ON graph_edges(repo, src);
    CREATE INDEX idx_graph_edges_dst ON graph_edges(repo, dst);
    CREATE TABLE graph_sync (
        repo TEXT PRIMARY KEY, graph_mtime REAL, synced_at TEXT NOT NULL, nodes INTEGER NOT NULL, edges INTEGER NOT NULL);
    """,
    5: """
    ALTER TABLE graph_sync ADD COLUMN sql_tables INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE graph_sync ADD COLUMN semantic_pending INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE graph_sync ADD COLUMN semantic_at TEXT;
    ALTER TABLE graph_sync ADD COLUMN semantic_model TEXT;
    """,
}


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect(path, busy_ms: int = 5000) -> sqlite3.Connection:
    """Open (creating and migrating if needed) the shared database."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=busy_ms / 1000)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout = {int(busy_ms)}")
    conn.execute("PRAGMA journal_mode = WAL")
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    for target in range(version + 1, SCHEMA_VERSION + 1):
        with conn:  # one transaction per step; another process may race us, so re-check first
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute("PRAGMA user_version").fetchone()[0] >= target:
                continue
            for stmt in _split(_MIGRATIONS[target]):
                conn.execute(stmt)
            conn.execute(f"PRAGMA user_version = {target}")
    return conn


def _split(script: str):
    """Split a migration script on statement boundaries (triggers contain inner semicolons)."""
    buf, out = "", []
    for line in script.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            if buf.strip():
                out.append(buf.strip())
            buf = ""
    return out


def detect_project(cwd: str | None = None) -> str:
    """basename of the git toplevel from cwd, falling back to basename(cwd)."""
    cwd = cwd or os.getcwd()
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"], cwd=cwd, capture_output=True, text=True, timeout=5
        )
        top = out.stdout.strip()
        if out.returncode == 0 and top:
            return os.path.basename(top)
    except (OSError, subprocess.SubprocessError):
        pass
    return os.path.basename(os.path.abspath(cwd)) or "unknown"


def fts_query(text: str) -> str:
    """Quote every term so user text can never be read as FTS5 syntax. Terms are ANDed."""
    terms = [t for t in re.split(r"\s+", text or "") if re.search(r"\w", t)]
    return " ".join('"' + t.replace('"', '""') + '"' for t in terms)


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.conn = connect(self.path)

    def close(self):
        self.conn.close()

    # -- sessions -----------------------------------------------------------------
    def _ensure_session(self, session_id, project, directory=None):
        self.conn.execute(
            "INSERT OR IGNORE INTO sessions (id, project, directory, started_at) VALUES (?, ?, ?, ?)",
            (session_id, project, directory, now()),
        )

    def session_start(self, session_id, project=None, directory=None):
        project = project or detect_project(directory)
        with self.conn:
            self._ensure_session(session_id, project, directory)
        return {"id": session_id, "project": project}

    def session_end(self, session_id, summary=None):
        with self.conn:
            self._ensure_session(session_id, None)
            self.conn.execute(
                "UPDATE sessions SET ended_at = ?, summary = COALESCE(?, summary) WHERE id = ?",
                (now(), summary, session_id),
            )

    def _default_session(self, project):
        return f"manual-save-{project}"

    def session_summary(self, content, project=None, session_id=None):
        project = project or detect_project()
        session_id = session_id or self._default_session(project)
        with self.conn:
            self._ensure_session(session_id, project)
            self.conn.execute("UPDATE sessions SET summary = ? WHERE id = ?", (content, session_id))
        return self.save(
            title=f"Session summary: {project}", content=content, type="session_summary",
            project=project, session_id=session_id,
        )

    def save_prompt(self, content, project=None, session_id=None):
        project = project or detect_project()
        session_id = session_id or self._default_session(project)
        with self.conn:
            self._ensure_session(session_id, project)
            cur = self.conn.execute(
                "INSERT INTO prompts (sync_id, session_id, project, content, created_at) VALUES (?, ?, ?, ?, ?)",
                (f"prompt-{os.urandom(8).hex()}", session_id, project, content, now()),
            )
        return {"id": cur.lastrowid}

    # -- observations -------------------------------------------------------------
    def save(self, title, content, type="note", topic_key=None, scope="project", project=None, session_id=None):
        project = project or detect_project()
        session_id = session_id or self._default_session(project)
        ts = now()
        with self.conn:
            self._ensure_session(session_id, project)
            if topic_key:
                row = self.conn.execute(
                    "SELECT id, revision FROM observations WHERE project IS ? AND scope = ? AND topic_key = ? "
                    "AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 1",
                    (project, scope, topic_key),
                ).fetchone()
                if row:
                    self.conn.execute(
                        "UPDATE observations SET title = ?, content = ?, type = ?, updated_at = ?, revision = ? WHERE id = ?",
                        (title, content, type, ts, row["revision"] + 1, row["id"]),
                    )
                    return {"id": row["id"], "action": "updated", "revision": row["revision"] + 1}
            cur = self.conn.execute(
                "INSERT INTO observations (sync_id, session_id, project, scope, type, title, content, topic_key, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (f"obs-{os.urandom(8).hex()}", session_id, project, scope, type, title, content, topic_key, ts, ts),
            )
            return {"id": cur.lastrowid, "action": "created", "revision": 1}

    def update(self, id, title=None, content=None, type=None, topic_key=None):
        row = self.get(id)
        if row is None:
            raise KeyError(f"observation {id} not found")
        with self.conn:
            self.conn.execute(
                "UPDATE observations SET title = ?, content = ?, type = ?, topic_key = ?, updated_at = ?, "
                "revision = revision + 1 WHERE id = ?",
                (
                    title if title is not None else row["title"],
                    content if content is not None else row["content"],
                    type if type is not None else row["type"],
                    topic_key if topic_key is not None else row["topic_key"],
                    now(), id,
                ),
            )
        return {"id": id, "action": "updated", "revision": row["revision"] + 1}

    def get(self, id):
        row = self.conn.execute("SELECT * FROM observations WHERE id = ? AND deleted_at IS NULL", (id,)).fetchone()
        return dict(row) if row else None

    def search(self, query, project=None, type=None, limit=10):
        match = fts_query(query)
        if not match:
            return []
        sql = (
            "SELECT o.id, o.title, o.type, o.project, o.topic_key, o.updated_at, o.revision, "
            "snippet(observations_fts, 1, '', '', '...', 24) AS snippet "
            "FROM observations_fts JOIN observations o ON o.id = observations_fts.rowid "
            "WHERE observations_fts MATCH ? AND o.deleted_at IS NULL"
        )
        args = [match]
        if project:
            sql += " AND o.project = ?"
            args.append(project)
        if type:
            sql += " AND o.type = ?"
            args.append(type)
        sql += " ORDER BY bm25(observations_fts, 4.0, 1.0, 2.0), o.id DESC LIMIT ?"
        args.append(max(1, min(int(limit or 10), 100)))
        return [dict(r) for r in self.conn.execute(sql, args)]

    def context(self, project=None, limit=20):
        project = project or detect_project()
        limit = max(1, min(int(limit or 20), 100))
        observations = [
            dict(r) for r in self.conn.execute(
                "SELECT id, title, type, topic_key, updated_at, substr(content, 1, 300) AS snippet FROM observations "
                "WHERE project = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT ?",
                (project, limit),
            )
        ]
        sessions = [
            dict(r) for r in self.conn.execute(
                "SELECT id, started_at, ended_at, summary FROM sessions WHERE project = ? AND summary IS NOT NULL "
                "ORDER BY started_at DESC LIMIT 5",
                (project,),
            )
        ]
        return {"project": project, "observations": observations, "sessions": sessions}
