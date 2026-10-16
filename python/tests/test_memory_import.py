import sqlite3
import subprocess
import os
import sys
import tempfile
import unittest
from pathlib import Path

from python.amauta.memory import importer
from python.amauta.memory import store as mstore

ROOT = Path(__file__).resolve().parents[2]

ENGRAM_SCHEMA = """
CREATE TABLE sessions (id TEXT PRIMARY KEY, project TEXT NOT NULL, ownership_mode TEXT, directory TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, summary TEXT);
CREATE TABLE observations (id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT, session_id TEXT NOT NULL, type TEXT NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL, tool_name TEXT, project TEXT, scope TEXT NOT NULL DEFAULT 'project', topic_key TEXT,
  normalized_hash TEXT, revision_count INTEGER NOT NULL DEFAULT 1, duplicate_count INTEGER NOT NULL DEFAULT 1, last_seen_at TEXT,
  pinned BOOLEAN NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT, embedding BLOB, future_column TEXT);
CREATE TABLE user_prompts (id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT, session_id TEXT NOT NULL, content TEXT NOT NULL,
  project TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
"""


def make_engram(path):
    c = sqlite3.connect(path)
    c.executescript(ENGRAM_SCHEMA)
    c.execute("INSERT INTO sessions (id, project, directory, summary) VALUES ('s1','demo','/d','sum')")
    c.execute("INSERT INTO observations (sync_id, session_id, type, title, content, project, topic_key, revision_count, future_column) VALUES ('sync-a','s1','decision','Alpha','alpha content','demo','k/a',3,'zzz')")
    c.execute("INSERT INTO observations (sync_id, session_id, type, title, content, project) VALUES (NULL,'s1','note','Beta','beta content','demo')")
    c.execute("INSERT INTO observations (sync_id, session_id, type, title, content, project, deleted_at) VALUES ('sync-d','s1','note','Gone','gone content','demo','2026-01-01')")
    c.execute("INSERT INTO user_prompts (sync_id, session_id, content, project) VALUES ('p1','s1','a prompt','demo')")
    c.commit()
    c.close()


class ImportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.src = Path(self.tmp.name) / "engram.db"
        make_engram(self.src)
        self.store = mstore.Store(Path(self.tmp.name) / "memory.db")
        self.addCleanup(self.store.close)

    def test_import_copies_rows_and_maps_columns(self):
        counts = importer.import_engram(self.src, self.store)
        self.assertEqual(counts, {"sessions": 1, "observations": 3, "prompts": 1})
        hits = self.store.search("alpha")
        self.assertEqual(len(hits), 1)
        row = self.store.get(hits[0]["id"])
        self.assertEqual((row["type"], row["topic_key"], row["revision"], row["project"]), ("decision", "k/a", 3, "demo"))
        self.assertEqual(self.store.search("gone"), [])  # deleted rows stay deleted
        self.assertEqual(len(self.store.search("beta")), 1)  # NULL sync_id got a synthetic one

    def test_import_is_idempotent(self):
        importer.import_engram(self.src, self.store)
        again = importer.import_engram(self.src, self.store)
        self.assertEqual(again, {"sessions": 0, "observations": 0, "prompts": 0})
        self.assertEqual(self.store.conn.execute("SELECT count(*) FROM observations").fetchone()[0], 3)

    def test_source_is_opened_read_only_and_never_modified(self):
        before = self.src.read_bytes()
        importer.import_engram(self.src, self.store)
        self.assertEqual(self.src.read_bytes(), before)
        self.assertFalse(Path(str(self.src) + "-wal").exists())

    def test_missing_source_raises(self):
        with self.assertRaises(FileNotFoundError):
            importer.import_engram(Path(self.tmp.name) / "nope.db", self.store)

    def test_cli(self):
        state = Path(self.tmp.name) / "state"
        env = {**os.environ, "PYTHONPATH": str(ROOT / "python"), "AMAUTA_STATE_DIR": str(state)}
        r = subprocess.run([sys.executable, "-m", "amauta.memory", "import-engram", "--from", str(self.src)], capture_output=True, text=True, env=env, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("observations: 3", r.stdout)
        missing = subprocess.run([sys.executable, "-m", "amauta.memory", "import-engram", "--from", "/nonexistent.db"], capture_output=True, text=True, env=env, timeout=30)
        self.assertNotEqual(missing.returncode, 0)


if __name__ == "__main__":
    unittest.main()
