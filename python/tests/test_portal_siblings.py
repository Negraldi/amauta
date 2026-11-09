"""Sibling projects (plan S1d, ADR 0001): projects that live beside amauta (a data catalog, an ETL repository) and that
the portal only links and health-checks. Configured in portal.json `siblings`; no sibling code runs in amauta."""

import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from python.amauta.portal import projects, siblings
from python.amauta.portal.api import Portal
from python.amauta.portal.config import Config


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
                        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"})


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.home = self.root / "home"
        self.state = self.root / "state"
        self.cat = self.home / "catalog"
        (self.cat / "cuts").mkdir(parents=True)
        self.state.mkdir()
        git(self.cat, "init", "-q")
        (self.cat / "README.md").write_text("# catalog\n")
        (self.cat / ".gitignore").write_text("cuts/\n")  # catalog cuts are data, not code
        git(self.cat, "add", ".")
        git(self.cat, "commit", "-qm", "first cut tooling")
        self.portal = Portal(Config(state_dir=self.state, claude_home=self.home / ".claude", repos=[], home=self.home))

    def configure(self, *items):
        return projects.write_config(self.state, {"siblings": list(items)}, self.home)


class ConfigTest(Base):
    def test_siblings_are_a_closed_schema_in_portal_json(self):
        cfg = self.configure({"name": "Data catalog", "path": str(self.cat), "mcp": "oga-catalog", "watch": "cuts/ACTIVE",
                              "max_age_days": 35})
        self.assertEqual(cfg["siblings"], [{"name": "Data catalog", "path": str(self.cat), "mcp": "oga-catalog",
                                            "watch": "cuts/ACTIVE", "max_age_days": 35}])
        self.assertEqual(projects.read_config(self.state, self.home)["siblings"], cfg["siblings"])
        self.assertEqual(projects.read_config(self.state, self.home)["repos"], [], "siblings are not projects")
        for bad in ({"name": "x", "path": "relative"}, {"name": "", "path": str(self.cat)}, {"name": "x" * 61, "path": str(self.cat)},
                    {"name": "x", "path": str(self.cat), "watch": "../out"}, {"name": "x", "path": str(self.cat), "watch": "/etc/x"},
                    {"name": "x", "path": str(self.cat), "max_age_days": 0}, {"name": "x", "path": str(self.cat), "mcp": "a b"},
                    {"name": "x", "path": str(self.cat), "command": "rm -rf"}):
            with self.assertRaises(projects.ConfigError, msg=str(bad)):
                self.configure(bad)

    def test_a_bad_entry_in_the_file_is_dropped_on_read(self):
        (self.state / "portal.json").write_text(json.dumps({"siblings": [{"name": "ok", "path": str(self.cat)}, {"name": "bad"}, "x"]}))
        self.assertEqual([s["name"] for s in projects.read_config(self.state, self.home)["siblings"]], ["ok"])


class HealthTest(Base):
    def test_a_healthy_sibling(self):
        (self.cat / "cuts" / "ACTIVE").write_text("20261101")
        cj = self.home / ".claude.json"
        cj.write_text(json.dumps({"mcpServers": {"oga-catalog": {"command": "python3"}}}))
        (self.state / "state.json").write_text(json.dumps({"claude_json": str(cj)}))
        self.configure({"name": "Data catalog", "path": str(self.cat), "mcp": "oga-catalog", "watch": "cuts/ACTIVE", "max_age_days": 35})
        [s] = siblings.health(self.portal)["siblings"]
        self.assertEqual((s["exists"], s["git"]["subject"], s["git"]["dirty"]), (True, "first cut tooling", 0))
        self.assertEqual(s["mcp"], {"name": "oga-catalog", "claude": True, "codex": False})
        self.assertEqual((s["watch"]["state"], s["watch"]["age_days"]), ("ok", 0))
        self.assertEqual(s["state"], "ok")

    def test_what_needs_attention_is_named(self):
        old = time.time() - 50 * 86400
        (self.cat / "cuts" / "ACTIVE").write_text("x")
        os.utime(self.cat / "cuts" / "ACTIVE", (old, old))
        (self.cat / "notes.txt").write_text("uncommitted\n")
        self.configure({"name": "Data catalog", "path": str(self.cat), "mcp": "oga-catalog", "watch": "cuts/ACTIVE", "max_age_days": 35},
                       {"name": "Gone", "path": str(self.cat), "watch": "cuts/MISSING"})
        first, second = siblings.health(self.portal)["siblings"]
        self.assertEqual((first["watch"]["state"], first["git"]["dirty"], first["mcp"]["claude"]), ("stale", 1, False))
        self.assertEqual(first["state"], "attention")
        self.assertEqual(second["watch"]["state"], "missing")
        import shutil
        shutil.rmtree(self.cat)
        self.assertEqual(siblings.health(self.portal)["siblings"][0]["state"], "missing")

    def test_the_route_answers(self):
        self.configure({"name": "Data catalog", "path": str(self.cat)})
        status, data = self.portal.get("/api/siblings", {})
        self.assertEqual(status, 200)
        self.assertEqual(data["siblings"][0]["name"], "Data catalog")


if __name__ == "__main__":
    unittest.main()
