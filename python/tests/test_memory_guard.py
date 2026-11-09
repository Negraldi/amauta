"""The memory guard (plan D3, ADR 0007): always on. Secret-like text is rejected with a fixed message that never echoes
it; personal identifiers are redacted before they are stored, and the result says how many, never which."""

import json
import tempfile
import unittest
from pathlib import Path

from python.amauta.memory import guard, server
from python.amauta.memory import store as mstore
from python.tests import detector_fixtures as fx

SECRET = "AKIA" + "Q" * 16


class GuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = mstore.Store(Path(self.tmp.name) / "memory.db")
        self.addCleanup(self.store.close)

    def rows(self, sql):
        return [tuple(r) for r in self.store.conn.execute(sql)]

    def test_a_secret_is_rejected_everywhere_and_nothing_is_written(self):
        for call in (lambda: self.store.save("t", f"key {SECRET}", project="p"),
                     lambda: self.store.save(f"title {SECRET}", "c", project="p"),
                     lambda: self.store.save_prompt(f"use {SECRET}", project="p"),
                     lambda: self.store.session_summary(f"done {SECRET}", project="p")):
            with self.assertRaises(guard.GuardError) as cm:
                call()
            self.assertEqual(str(cm.exception), guard.SECRET_REJECTED)
            self.assertNotIn(SECRET, str(cm.exception))
        self.assertEqual(self.rows("SELECT count(*) FROM observations"), [(0,)])
        self.assertEqual(self.rows("SELECT count(*) FROM prompts"), [(0,)])
        saved = self.store.save("t", "fine", project="p")
        with self.assertRaises(guard.GuardError):
            self.store.update(saved["id"], content=f"now {SECRET}")
        self.assertEqual(self.store.get(saved["id"])["content"], "fine")

    def test_personal_identifiers_are_redacted_and_counted(self):
        c, card = fx.cedula(4), fx.card(4)
        r = self.store.save(f"cliente {c}", f"pago con {card} de ana@example.org", project="p")
        self.assertEqual(r["redacted"], {"cedula": 1, "card": 1, "email": 1})
        row = self.store.get(r["id"])
        for value in (c, card, "ana@example.org"):
            self.assertNotIn(value, row["title"] + row["content"])
        self.assertIn("[REDACTED_CEDULA]", row["title"])
        p = self.store.save_prompt(f"llamar al {fx.mobile(4)}", project="p")
        self.assertEqual(p["redacted"], {"phone": 1})
        self.assertNotIn(fx.mobile(4), self.rows("SELECT content FROM prompts")[0][0])
        clean = self.store.save("t2", "nothing personal", project="p")
        self.assertNotIn("redacted", clean)

    def test_the_mcp_tool_answers_with_the_fixed_message_and_the_count(self):
        with self.assertRaises(guard.GuardError):
            server._run(self.store, "mem_save", {"title": "t", "content": f"x {SECRET}"})
        msg = server._run(self.store, "mem_save", {"title": "t", "content": f"cedula {fx.cedula(5)}", "project": "p"})
        self.assertIn("1 cedula redacted", msg)
        self.assertNotIn(fx.cedula(5), msg)


if __name__ == "__main__":
    unittest.main()
