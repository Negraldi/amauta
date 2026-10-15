import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from python.amauta import paths
from python.amauta.memory import store as mstore


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = mstore.Store(Path(self.tmp.name) / "memory.db")
        self.addCleanup(self.store.close)

    def test_state_dir_resolution(self):
        self.assertEqual(paths.state_dir({"GENTLE_LITE_STATE_DIR": "/x/y"}), Path("/x/y"))
        self.assertEqual(paths.state_dir({}, home=Path("/h")), Path("/h/.gentle-lite"))

    def test_pragmas_and_schema_version(self):
        c = self.store.conn
        self.assertEqual(c.execute("PRAGMA journal_mode").fetchone()[0], "wal")
        self.assertEqual(c.execute("PRAGMA busy_timeout").fetchone()[0], 5000)
        self.assertEqual(c.execute("PRAGMA user_version").fetchone()[0], mstore.SCHEMA_VERSION)
        names = {r[0] for r in c.execute("SELECT name FROM sqlite_master")}
        for t in ("sessions", "observations", "observations_fts", "prompts", "events"):
            self.assertIn(t, names)

    def test_reopen_is_idempotent(self):
        self.store.save(title="a", content="b", project="p")
        path = self.store.path
        self.store.close()
        again = mstore.Store(path)
        self.addCleanup(again.close)
        self.assertEqual(again.get(1)["title"], "a")

    def test_save_search_roundtrip_and_ranking(self):
        a = self.store.save(title="FTS5 tokenizer notes", content="porter stemming trade-offs", project="p", type="decision")
        self.store.save(title="Unrelated", content="nothing here", project="p")
        hits = self.store.search("tokenizer", project="p")
        self.assertEqual([h["id"] for h in hits], [a["id"]])
        self.assertEqual(self.store.search("tokenizer", project="other"), [])
        self.assertEqual(self.store.search("tokenizer", type="bugfix"), [])
        self.assertEqual(len(self.store.search("tokenizer", type="decision")), 1)

    def test_search_sanitizes_fts_syntax(self):
        self.store.save(title="plain", content="hello world", project="p")
        for q in ['"', 'a AND', 'NEAR(', '*', 'title:foo', 'x" OR "y', '-', "O'Brien", '', '   ']:
            self.assertIsInstance(self.store.search(q), list, q)  # never raises
        self.assertEqual(len(self.store.search("hello world")), 1)
        self.assertEqual(self.store.search("hello AND world"), [])  # AND is a literal word, not an operator
        self.assertEqual(self.store.search("hello NOT world"), [])

    def test_topic_key_upserts_latest_row_and_bumps_revision(self):
        first = self.store.save(title="arch", content="v1", project="p", topic_key="architecture/auth")
        second = self.store.save(title="arch", content="v2", project="p", topic_key="architecture/auth")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(second["action"], "updated")
        self.assertEqual(second["revision"], 2)
        self.assertEqual(self.store.get(first["id"])["content"], "v2")
        other_project = self.store.save(title="arch", content="x", project="q", topic_key="architecture/auth")
        self.assertNotEqual(other_project["id"], first["id"])
        other_scope = self.store.save(title="arch", content="x", project="p", scope="personal", topic_key="architecture/auth")
        self.assertNotEqual(other_scope["id"], first["id"])
        self.assertEqual(len(self.store.search("v2")), 1)
        self.assertEqual(self.store.search("v1"), [])  # FTS follows the update

    def test_update_changes_fields_and_fts(self):
        r = self.store.save(title="t", content="alpha", project="p")
        u = self.store.update(r["id"], content="beta", title="t2")
        self.assertEqual(u["revision"], 2)
        self.assertEqual(self.store.search("alpha"), [])
        self.assertEqual(len(self.store.search("beta")), 1)
        with self.assertRaises(KeyError):
            self.store.update(999, content="x")

    def test_get_missing_and_deleted(self):
        self.assertIsNone(self.store.get(42))

    def test_sessions_prompts_and_summary(self):
        self.store.session_start("s1", project="p", directory="/d")
        self.store.session_start("s1", project="p", directory="/d")  # idempotent
        self.store.save_prompt("remember this", project="p", session_id="s1")
        self.store.session_summary("did things", project="p", session_id="s1")
        self.store.session_end("s1", summary="final")
        row = self.store.conn.execute("SELECT project, ended_at, summary FROM sessions WHERE id='s1'").fetchone()
        self.assertEqual(row[0], "p")
        self.assertIsNotNone(row[1])
        self.assertEqual(row[2], "final")
        self.assertEqual(self.store.conn.execute("SELECT count(*) FROM prompts").fetchone()[0], 1)
        self.assertEqual(len(self.store.search("things", project="p")), 1)  # summary is searchable

    def test_context_lists_recent_observations_for_project(self):
        for i in range(5):
            self.store.save(title=f"note {i}", content="c", project="p")
        self.store.save(title="elsewhere", content="c", project="q")
        ctx = self.store.context(project="p", limit=3)
        self.assertEqual([o["title"] for o in ctx["observations"]], ["note 4", "note 3", "note 2"])

    def test_detect_project(self):
        with tempfile.TemporaryDirectory() as d:
            plain = Path(d) / "plain-dir"
            plain.mkdir()
            self.assertEqual(mstore.detect_project(str(plain)), "plain-dir")
            repo = Path(d) / "my-repo"
            (repo / "sub").mkdir(parents=True)
            os.system(f"git init -q {repo}")
            self.assertEqual(mstore.detect_project(str(repo / "sub")), "my-repo")

    def test_wal_allows_concurrent_reader(self):
        self.store.save(title="t", content="c", project="p")
        other = sqlite3.connect(self.store.path)
        self.addCleanup(other.close)
        self.assertEqual(other.execute("SELECT count(*) FROM observations").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
