"""The portal Security page (plan D14): protections, trusted projects, installed checkers, profiles and how many
values the memory guard redacted. Counts and names only: never a matched value, a key or a row."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from python.amauta.memory import store as mstore
from python.amauta.portal import security
from python.amauta.portal.config import Config
from python.tests import detector_fixtures as fx


class SecurityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.state = self.root / "state"
        self.state.mkdir()
        self.cfg = Config(state_dir=self.state, claude_home=self.root / "home", engram_db=self.root / "none.db")

    def test_a_fresh_machine_reports_defaults(self):
        r = security.report(self.cfg, search_path="")
        self.assertEqual(r["protections"], {"memory_guard": "on", "privacy": "on", "checks": "on", "installed": False})
        self.assertEqual(r["trusted"], [])
        self.assertEqual(r["profiles"], {"names": ["default"], "drafts": 0, "selected": []})
        self.assertEqual(r["redacted"], {})
        self.assertEqual(sorted(c["name"] for c in r["checkers"]), sorted(security.CHECKERS))
        self.assertTrue(all(c["installed"] is False for c in r["checkers"]))

    def test_it_reads_state_trust_profiles_and_redaction_counts(self):
        (self.state / "state.json").write_text(json.dumps({"privacy": False, "checks": True}))
        (self.state / "checks").mkdir()
        (self.state / "checks" / "trust.json").write_text(json.dumps({"projects": [{"path": "/work/app", "trusted_at": "2026-11-08T10:00:00Z"}]}))
        for d in ("profiles/acme", "profiles/other.draft", "profiles/acme.bak-20261108T100000"):
            (self.state / d).mkdir(parents=True)
        (self.state / "profiles" / "selection.json").write_text(json.dumps({"/work/app": "acme"}))
        s = mstore.Store(self.state / "memory.db")
        s.save("t", f"cliente {fx.cedula(1)} y {fx.cedula(2)}, correo a@b.co", project="p")
        s.save_prompt(f"llamar {fx.mobile(1)}", project="p")
        s.close()
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        (bin_dir / "gitleaks").write_text("#!/bin/sh\n")
        (bin_dir / "gitleaks").chmod(0o755)
        r = security.report(self.cfg, search_path=str(bin_dir))
        self.assertEqual(r["protections"]["privacy"], "off")
        self.assertTrue(r["protections"]["installed"])
        self.assertEqual(r["trusted"], [{"name": "app", "path": "/work/app", "since": "2026-11-08T10:00:00Z"}])
        self.assertEqual(r["profiles"], {"names": ["default", "acme"], "drafts": 1, "selected": [{"project": "app", "profile": "acme"}]})
        self.assertEqual(r["redacted"], {"cedula": 2, "email": 1, "phone": 1})
        self.assertEqual({c["name"]: c["installed"] for c in r["checkers"]}["gitleaks"], True)
        self.assertNotIn(fx.cedula(1), json.dumps(r))

    def test_an_unreadable_database_is_reported_not_raised(self):
        (self.state / "memory.db").write_text("not a database")
        self.assertEqual(security.report(self.cfg, search_path="")["redacted"], {})


    def test_the_api_route_answers(self):
        from python.amauta.portal.api import Portal
        status, data = Portal(self.cfg).get("/api/security", {})
        self.assertEqual(status, 200)
        self.assertEqual(data["protections"]["memory_guard"], "on")


if __name__ == "__main__":
    unittest.main()
