import os
import shutil
import sqlite3
import subprocess
import unittest

from python.amauta.memory import store as mstore
from python.amauta.portal import skillhist as sh
from python.tests.test_portal_wiki import WikiBase
from python.tests.test_skill_impact import call, sess, turn

GIT = shutil.which("git")
ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
       "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}


def loaded(sid, day, n_err, n_ok=4, tokens=100):
    """A session that loads S on `day` and then makes n_err failing and n_ok good calls."""
    t = f"2026-10-{day:02d}T10:00:00.000Z"
    calls = [call(t, "Skill", skill="S")] + [call(f"2026-10-{day:02d}T10:01:{i:02d}.000Z", result="error" if i < n_err else "ok") for i in range(n_err + n_ok)]
    return sess(sid, calls, [turn(f"2026-10-{day:02d}T10:02:00.000Z", tokens)])


class TimestampTest(unittest.TestCase):
    def test_every_format_is_comparable_in_utc(self):
        self.assertEqual(sh.norm_ts("2026-10-01T10:00:00.123Z"), "2026-10-01T10:00:00")
        self.assertEqual(sh.norm_ts("2026-10-01T10:00:00Z"), "2026-10-01T10:00:00")
        self.assertEqual(sh.norm_ts("2026-10-01T10:00:00-05:00"), "2026-10-01T15:00:00")
        self.assertIsNone(sh.norm_ts("garbage"))
        self.assertIsNone(sh.norm_ts(None))


class WindowTest(unittest.TestCase):
    def test_sessions_are_assigned_by_the_time_of_their_first_load(self):
        data = [loaded(f"a{i}", 1, 2) for i in range(5)] + [loaded(f"b{i}", 10, 0) for i in range(5)]
        before = sh.exposed_window(data, "S", None, "2026-10-05T00:00:00")
        after = sh.exposed_window(data, "S", "2026-10-05T00:00:00", None)
        self.assertEqual((before["sessions"], after["sessions"]), (5, 5))
        self.assertAlmostEqual(before["metrics"]["error_rate"]["value"], 2 / 6)
        self.assertEqual(after["metrics"]["error_rate"]["value"], 0.0)

    def test_boundaries_are_half_open(self):
        data = [loaded("x", 5, 0)]
        self.assertEqual(sh.exposed_window(data, "S", "2026-10-05T10:00:00", None)["sessions"], 1)
        self.assertEqual(sh.exposed_window(data, "S", None, "2026-10-05T10:00:00")["sessions"], 0)


class DeltaTest(unittest.TestCase):
    def test_before_and_after_a_change_with_enough_sessions(self):
        data = [loaded(f"a{i}", 1, 2) for i in range(5)] + [loaded(f"b{i}", 10, 0) for i in range(5)]
        (c,) = sh.deltas(data, "S", [{"kind": "installed", "ts": "2026-10-05T00:00:00", "label": "v2"}])
        self.assertFalse(c["suppressed"])
        self.assertEqual((c["before_sessions"], c["after_sessions"]), (5, 5))
        er = c["metrics"]["error_rate"]
        self.assertAlmostEqual(er["before"], 1 / 3)
        self.assertEqual((er["after"], er["n_before"], er["n_after"]), (0.0, 30, 20))
        self.assertAlmostEqual(er["delta"], -1 / 3)
        self.assertEqual(er["verdict"], "better")

    def test_either_side_under_five_sessions_is_suppressed_but_reports_n(self):
        data = [loaded(f"a{i}", 1, 2) for i in range(3)] + [loaded(f"b{i}", 10, 0) for i in range(5)]
        (c,) = sh.deltas(data, "S", [{"kind": "installed", "ts": "2026-10-05T00:00:00", "label": "v2"}])
        self.assertTrue(c["suppressed"])
        self.assertEqual((c["before_sessions"], c["after_sessions"]), (3, 5))
        self.assertIsNone(c["metrics"]["error_rate"]["delta"])

    def test_windows_end_at_the_next_change_of_the_same_kind(self):
        data = [loaded(f"a{i}", 1, 2) for i in range(5)] + [loaded(f"b{i}", 10, 1) for i in range(5)] + [loaded(f"c{i}", 20, 0) for i in range(5)]
        pts = [{"kind": "installed", "ts": "2026-10-05T00:00:00", "label": "v2"}, {"kind": "installed", "ts": "2026-10-15T00:00:00", "label": "v3"},
               {"kind": "commit", "ts": "2026-10-12T00:00:00", "label": "c1"}]
        got = {c["label"]: c for c in sh.deltas(data, "S", pts)}
        self.assertEqual((got["v2"]["before_sessions"], got["v2"]["after_sessions"]), (5, 5))  # after v2 stops at v3: the day-20 sessions belong to v3
        self.assertEqual((got["v3"]["before_sessions"], got["v3"]["after_sessions"]), (5, 5))
        self.assertEqual((got["c1"]["before_sessions"], got["c1"]["after_sessions"]), (10, 5))  # only one commit: windows are open on both ends

    def test_no_changes_no_deltas(self):
        self.assertEqual(sh.deltas([loaded("a", 1, 0)], "S", []), [])


class ObserveTest(WikiBase):
    def skill(self, text, name="hist-skill"):
        d = self.f["home"] / "skills" / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "SKILL.md").write_text(text)
        return d / "SKILL.md"

    def rows(self):
        c = sqlite3.connect(self.f["state"] / "memory.db")
        try:
            return c.execute("SELECT skill, hash, first_seen FROM skill_versions ORDER BY first_seen, hash").fetchall()
        finally:
            c.close()

    def test_first_seen_uses_the_file_time_once_per_hash_and_stores_no_content(self):
        p = self.skill("---\nname: hist-skill\n---\nSECRET-BODY-123")
        os.utime(p, (1_790_000_000, 1_790_000_000))
        sh.observe(self.portal)
        sh.observe(self.portal)  # idempotent
        ((name, digest, first),) = self.rows()
        self.assertEqual((name, len(digest), first), ("hist-skill", 64, "2026-09-21T14:13:20Z"))
        self.assertNotIn(b"SECRET-BODY-123", b"".join(p.read_bytes() for p in self.f["state"].glob("memory.db*")))
        p.write_text("---\nname: hist-skill\n---\nSECOND")
        os.utime(p, (1_790_100_000, 1_790_100_000))
        sh.observe(self.portal)
        self.assertEqual(len(self.rows()), 2)
        p.write_text("---\nname: hist-skill\n---\nSECRET-BODY-123")  # back to the first content: the hash is already known
        os.utime(p, (1_790_200_000, 1_790_200_000))
        sh.observe(self.portal)
        self.assertEqual(len(self.rows()), 2)

    def test_future_file_times_are_clamped_to_now(self):
        p = self.skill("x")
        os.utime(p, (4_000_000_000, 4_000_000_000))
        sh.observe(self.portal)
        ((_, _, first),) = self.rows()
        self.assertLess(first, "2100")

    def test_no_database_means_nothing_is_created_and_nothing_raises(self):
        self.skill("x")
        for f in self.f["state"].glob("memory.db*"):
            f.unlink()
        sh.observe(self.portal)
        self.assertFalse((self.f["state"] / "memory.db").exists())

    def test_unreadable_state_is_fail_open(self):
        self.skill("x")
        from unittest import mock
        with mock.patch.object(mstore, "connect", side_effect=sqlite3.OperationalError("locked")):
            sh.observe(self.portal)  # must not raise
        self.assertEqual(self.rows(), [])


@unittest.skipUnless(GIT, "git is not installed")
class GitTest(WikiBase):
    def git(self, *args, env=None):
        return subprocess.run(["git", "-C", str(self.f["repo"]), *args], check=True, capture_output=True, text=True, env={**ENV, **(env or {})}).stdout.strip()

    def test_commits_touching_the_skill_directory_of_a_known_repo(self):
        repo = self.f["repo"]
        d = repo / "assets" / "skills" / "git-skill"
        d.mkdir(parents=True)
        self.git("init", "-q")
        (d / "SKILL.md").write_text("one")
        self.git("add", "-A")
        self.git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "feat(skill): one <b>x</b>", env={"GIT_COMMITTER_DATE": "2026-10-01T10:00:00Z", "GIT_AUTHOR_DATE": "2026-10-01T10:00:00Z"})
        (repo / "other.txt").write_text("unrelated")
        self.git("add", "-A")
        self.git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "chore: unrelated")
        (d / "SKILL.md").write_text("two")
        self.git("add", "-A")
        self.git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "fix(skill): two", env={"GIT_COMMITTER_DATE": "2026-10-05T10:00:00Z", "GIT_AUTHOR_DATE": "2026-10-05T10:00:00Z"})
        got = sh.git_commits(self.portal, "git-skill")
        self.assertEqual([c["subject"] for c in got], ["fix(skill): two", "feat(skill): one <b>x</b>"])
        self.assertEqual(got[0]["date"][:10], "2026-10-05")
        self.assertRegex(got[0]["hash"], r"^[0-9a-f]{7,12}$")
        self.assertEqual(sh.git_commits(self.portal, "nope-skill"), [])
        self.assertEqual(sh.git_commits(self.portal, "../etc"), [])

    def test_a_missing_repo_or_git_gives_an_empty_list(self):
        from unittest import mock
        self.assertEqual(sh.git_commits(self.portal, "anything"), [])
        (self.f["repo"] / "assets" / "skills" / "x").mkdir(parents=True)
        with mock.patch("subprocess.run", side_effect=OSError("no git")):
            self.assertEqual(sh.git_commits(self.portal, "x"), [])


class ChangesTest(ObserveTest):
    def test_changes_combine_installed_versions_and_commits_into_ordered_points(self):
        c = mstore.connect(self.f["state"] / "memory.db")
        c.executemany("INSERT INTO skill_versions (skill, hash, first_seen) VALUES (?,?,?)", [("S", "a" * 64, "2026-10-01T00:00:00Z"), ("S", "b" * 64, "2026-10-05T00:00:00Z")])
        c.commit()
        c.close()
        from unittest import mock
        with mock.patch.object(sh, "git_commits", return_value=[{"hash": "abc1234", "date": "2026-10-03T12:00:00+00:00", "subject": "fix: s"}]):
            out = sh.changes(self.portal, "S", [loaded(f"a{i}", 2, 2) for i in range(5)] + [loaded(f"b{i}", 8, 0) for i in range(5)])
        self.assertEqual([v["hash"] for v in out["versions"]], ["b" * 12, "a" * 12])  # newest first, shortened
        self.assertEqual([(p["kind"], p["label"]) for p in out["changes"]], [("installed", "bbbbbbbbbbbb"), ("commit", "abc1234 fix: s")])  # newest first
        self.assertEqual(out["commits"][0]["subject"], "fix: s")
        inst = out["changes"][0]
        self.assertFalse(inst["suppressed"])
        self.assertEqual(inst["metrics"]["error_rate"]["verdict"], "better")


if __name__ == "__main__":
    unittest.main()
