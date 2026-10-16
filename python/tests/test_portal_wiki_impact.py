import sqlite3
from datetime import datetime, timedelta, timezone

from python.amauta.memory import store as mstore
from python.amauta.portal import skillimpact
from python.amauta.usage import ingest
from python.tests import portal_fixtures as fx
from python.tests.test_portal_wiki import WikiBase
from python.tests.test_usage import assistant, tool_use, write_jsonl
from python.tests.test_usage_outcome import result_line

NOTE = "Correlation, not causation: sessions that load a skill differ in other ways too."


def stamp(days_ago, minute=0):
    d = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return d.strftime("%Y-%m-%dT%H:") + f"{minute:02d}:00.000Z"


class ImpactBase(WikiBase):
    def add_sessions(self, skill, exposed_errors, control_errors, n=5, project="gamma"):
        """n sessions that load `skill` then make 5 Bash calls with `exposed_errors` failing, and n sessions without it with `control_errors` failing."""
        lines = []
        for kind, errors, count in (("e", exposed_errors, n), ("c", control_errors, n)):
            for i in range(count):
                sid = f"{skill}-{kind}{i}"
                calls = ([tool_use("Skill", f"{sid}-sk", skill=skill)] if kind == "e" else [])
                lines.append(assistant(f"{sid}-m0", calls or [tool_use("Read", f"{sid}-r")], session=sid, ts=stamp(3, 1), cwd=f"/work/{project}", usage={"input_tokens": 1, "output_tokens": 10}))
                for j in range(5):
                    lines.append(assistant(f"{sid}-m{j + 1}", [tool_use("Bash", f"{sid}-b{j}", command="ls")], session=sid, ts=stamp(3, 2 + j), cwd=f"/work/{project}", usage={"input_tokens": 1, "output_tokens": 20}))
                    lines.append(result_line(f"{sid}-b{j}", "Exit code 1" if j < errors else "ok", True if j < errors else None, session=sid, ts=stamp(3, 2 + j)))
        write_jsonl(self.f["home"] / "projects" / f"-work-{project}" / f"{skill}.jsonl", lines)
        c = mstore.connect(self.f["state"] / "memory.db")
        ingest.backfill(c, self.f["home"])
        c.close()


class SkillImpactPageTest(ImpactBase):
    def test_every_skill_page_has_the_block_with_the_note_and_suppresses_tiny_samples(self):
        im = self.page("skill", "work-unit-commits")["impact"]
        self.assertTrue(im["available"])
        self.assertEqual((im["days"], im["note"], im["min_sessions"]), (30, NOTE, 5))
        self.assertEqual(set(im["changes"]), {"versions", "commits", "changes"})
        self.assertTrue(im["metrics"]["error_rate"]["suppressed"])
        self.assertIsNone(im["metrics"]["error_rate"]["delta"])
        self.assertNotIn("impact", self.page("tool", "Bash"))
        self.assertNotIn("impact", self.page("mcp", "engram"))

    def test_enough_sessions_give_values_n_and_a_verdict(self):
        self.add_sessions("impact-skill", exposed_errors=0, control_errors=2)
        im = self.page("skill", "impact-skill")["impact"]
        er = im["metrics"]["error_rate"]
        self.assertTrue(im["outcomes_recorded"])
        self.assertEqual((im["exposed_sessions"], im["control_sessions"], im["control_scope"]), (5, 5, "same-project"))
        self.assertFalse(er["suppressed"])
        self.assertEqual((er["exposed"]["value"], er["baseline"]["value"], er["exposed"]["n"], er["baseline"]["n"]), (0.0, 0.4, 25, 25))
        self.assertEqual(er["verdict"], "better")
        tok = im["metrics"]["tokens_per_turn"]
        self.assertEqual(tok["exposed"]["value"], 20)

    def test_viewing_a_skill_records_its_installed_version_once(self):
        d = self.f["home"] / "skills" / "tracked"
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text("---\nname: tracked\n---\nv1")
        self.page("skill", "tracked")
        self.page("skill", "tracked")
        c = sqlite3.connect(self.f["state"] / "memory.db")
        self.assertEqual(c.execute("SELECT count(*) FROM skill_versions WHERE skill = 'tracked'").fetchone()[0], 1)
        c.close()
        im = self.page("skill", "tracked")["impact"]
        self.assertEqual([v["current"] for v in im["changes"]["versions"]], [True])
        self.assertEqual(im["changes"]["changes"], [])  # a single version is a baseline, not a change

    def test_a_readonly_old_database_still_renders(self):
        c = sqlite3.connect(self.f["state"] / "memory.db")
        c.execute("DROP TABLE skill_versions")
        c.execute("PRAGMA user_version = 6")
        c.commit()
        c.close()
        self.assertTrue(self.page("skill", "work-unit-commits")["impact"]["available"])


class HomeRankingTest(ImpactBase):
    def test_ranking_lists_skills_with_enough_sessions_by_error_rate_delta(self):
        self.add_sessions("good-skill", exposed_errors=0, control_errors=2)
        self.add_sessions("bad-skill", exposed_errors=3, control_errors=0, project="delta")
        rk = self.get("/api/wiki/home")["impact"]
        self.assertTrue(rk["available"])
        self.assertEqual(rk["note"], NOTE)
        self.assertEqual([r["skill"] for r in rk["best"]], ["good-skill"])
        self.assertEqual([r["skill"] for r in rk["worst"]], ["bad-skill"])
        best = rk["best"][0]
        self.assertEqual((best["sessions"], best["n"], best["verdict"]), (5, 25, "better"))
        self.assertLess(best["delta"], 0)
        self.assertGreaterEqual(rk["tracked"], 3)  # includes work-unit-commits and the loaded fixture skills
        self.assertEqual(rk["ranked"], 2)  # the rest is below the n floor and never ranked

    def test_ranking_is_capped_and_empty_without_usage(self):
        for i in range(5):
            self.add_sessions(f"s{i}", exposed_errors=0, control_errors=2, project=f"p{i}")
        self.assertEqual(len(skillimpact.ranking(self.portal)["best"]), 3)
        rk = skillimpact.ranking(self.portal, today=None, top=1)
        self.assertEqual(len(rk["best"]), 1)
        (self.f["state"] / "memory.db").unlink()
        self.assertEqual(self.get("/api/wiki/home")["impact"]["available"], False)
