import json
import os
import threading
from unittest import mock
from pathlib import Path

from python.amauta.memory import store as mstore
from python.amauta.portal import api, projects, server
from python.amauta.portal.config import Config
from python.amauta.usage import ingest
from python.tests import portal_fixtures as fx
from python.tests.test_portal import ApiBase
from python.tests.test_portal_server import ServerBase
from python.tests.test_portal_wiki import WikiBase
from python.tests.test_usage import assistant, write_jsonl


def git_dir(path):
    (Path(path) / ".git").mkdir(parents=True, exist_ok=True)
    return Path(path)


class ProjectBase(WikiBase):
    """The fixture tree lives under a temp root that stands in for $HOME, so discovery rules (existing dirs under HOME) are testable."""

    def setUp(self):
        super().setUp()
        self.home_dir = self.root
        self.cfg.home = self.home_dir
        self.portal = api.Portal(self.cfg)

    def session(self, sid, cwd, ts="2026-10-05T10:00:00.000Z"):
        write_jsonl(self.f["home"] / "projects" / f"-p-{sid}" / f"{sid}.jsonl", [assistant(f"m-{sid}", session=sid, ts=ts, cwd=str(cwd))])
        conn = mstore.connect(self.f["state"] / "memory.db")
        ingest.backfill(conn, self.f["home"])
        conn.close()

    def fresh(self):
        self.portal = api.Portal(self.cfg)
        return self.portal

    def names(self):
        return [r.name for r in self.fresh().repos()]


class ConfigFileTest(ProjectBase):
    def cfg_file(self, text):
        (self.f["state"] / "portal.json").write_text(text)

    def test_defaults_when_the_file_is_missing_or_broken(self):
        for text in (None, "not json", "[]", '{"repos": "x"}', '{"auto_discover": "yes"}'):
            if text is not None:
                self.cfg_file(text)
            self.assertEqual(projects.read_config(self.f["state"]), {"repos": [], "auto_discover": True}, text)

    def test_valid_entries_are_kept_and_invalid_ones_dropped(self):
        a = git_dir(self.root / "a")
        (self.root / "file.txt").write_text("x")
        self.cfg_file(json.dumps({"repos": [str(a), "relative/dir", str(self.root / "ghost"), str(self.root / "file.txt"), 5, str(a)], "auto_discover": False}))
        self.assertEqual(projects.read_config(self.f["state"], home=self.root), {"repos": [str(a.resolve())], "auto_discover": False})


class OutsideHomeTest(ProjectBase):
    """Explicitly configured paths may live outside $HOME (a data disk); system trees, `/` and $HOME itself stay refused."""

    def setUp(self):
        super().setUp()
        self.fake_home = self.root / "home"
        self.fake_home.mkdir()
        self.data = self.root / "mnt" / "datos"
        self.data.mkdir(parents=True)
        # The temp tree lives under /tmp, itself a system tree, so the tests use a narrower list for the "elsewhere" case.
        patcher = mock.patch.object(projects, "SYSTEM_TREES", ("/proc", "/sys", "/dev", "/run", "/etc", "/usr", "/boot", "/var"))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_an_absolute_existing_directory_outside_home_is_accepted(self):
        self.assertEqual(projects.check_repo(str(self.data), self.fake_home), self.data.resolve())

    def test_the_default_list_refuses_the_temp_tree(self):
        mock.patch.stopall()
        with self.assertRaises(projects.ConfigError):
            projects.check_repo(str(self.data), self.fake_home)

    def test_root_system_trees_home_and_relative_paths_are_refused(self):
        link = self.root / "to-etc"
        link.symlink_to("/etc", target_is_directory=True)
        for bad in ("/", "/etc", "/proc/self", "/usr/lib", "/boot", "/var/lib", str(link), str(self.fake_home), "mnt/datos", ""):
            with self.assertRaises(projects.ConfigError, msg=bad):
                projects.check_repo(bad, self.fake_home)

    def test_a_directory_inside_home_still_works_even_when_home_is_under_a_system_tree(self):
        sub = self.fake_home / "p"
        sub.mkdir()
        self.assertEqual(projects.check_repo(str(sub), self.fake_home), sub.resolve())

    def test_config_file_and_settings_post_keep_outside_paths(self):
        (self.f["state"] / "portal.json").write_text(json.dumps({"repos": [str(self.data), "/etc"]}))
        self.assertEqual(projects.read_config(self.f["state"], home=self.fake_home)["repos"], [str(self.data.resolve())])
        out = projects.write_config(self.f["state"], {"repos": [str(self.data)]}, home=self.fake_home)
        self.assertEqual(out["repos"], [str(self.data.resolve())])

    def test_discovery_stays_inside_home(self):
        git_dir(self.data)
        self.assertIsNone(projects.git_root(str(self.data), self.fake_home))


class DiscoveryTest(ProjectBase):
    def test_union_of_flags_config_and_discovered_roots_without_duplicates(self):
        alpha = git_dir(self.root / "alpha")
        beta = git_dir(self.root / "beta")
        (self.f["state"] / "portal.json").write_text(json.dumps({"repos": [str(beta), str(self.f["repo"])], "auto_discover": True}))
        (alpha / "src").mkdir()
        self.session("s7", alpha / "src")
        self.assertEqual(self.names(), ["repo", "beta", "alpha"])  # flag first, then config, then discovered; the flag repo is not repeated

    def test_auto_discover_off_adds_nothing(self):
        alpha = git_dir(self.root / "alpha")
        self.session("s7", alpha)
        (self.f["state"] / "portal.json").write_text(json.dumps({"repos": [], "auto_discover": False}))
        self.assertEqual(self.names(), ["repo"])

    def test_only_existing_git_roots_under_home_count(self):
        git_dir(self.root)  # home itself is a git repo: it is never a project
        plain = self.root / "plain"
        plain.mkdir()
        outside = Path(self.tmp.name + "-outside")
        outside.mkdir()
        self.addCleanup(outside.rmdir)
        self.session("s1x", plain)
        self.session("s2x", self.root / "gone" / "deep")
        self.session("s3x", "/work/alpha")
        self.session("s4x", outside)
        self.assertEqual(self.names(), ["repo"])

    def test_a_symlink_that_leaves_home_is_not_followed(self):
        outside = Path(self.tmp.name + "-outside")
        git_dir(outside)
        self.addCleanup(lambda: [p.rmdir() for p in (outside / ".git", outside)])
        link = self.root / "escape"
        link.symlink_to(outside, target_is_directory=True)
        self.session("s5x", link)
        self.assertEqual(self.names(), ["repo"])

    def test_discovery_is_capped(self):
        for i in range(projects.MAX_DISCOVERED + 10):
            self.session(f"cap{i}", git_dir(self.root / f"proj{i:03d}"))
        found = self.fresh().repos()
        self.assertLessEqual(len(found), 1 + projects.MAX_DISCOVERED)

    def test_cwd_inside_a_nested_path_resolves_to_the_nearest_git_root(self):
        alpha = git_dir(self.root / "alpha")
        (alpha / "a" / "b").mkdir(parents=True)
        self.session("deep", alpha / "a" / "b")
        self.assertIn("alpha", self.names())


class ProjectsApiTest(ProjectBase):
    def setUp(self):
        super().setUp()
        self.alpha = git_dir(self.root / "alpha")
        self.session("s7", self.alpha)
        st = mstore.Store(self.f["state"] / "memory.db")
        st.save("Repo note", "about the repo", type="note", project="repo")
        st.close()

    def by_name(self):
        return {p["name"]: p for p in self.get("/api/projects")["projects"]}

    def test_every_project_reports_odd_sessions_memories_and_graph(self):
        p = self.by_name()
        self.assertEqual(set(p), {"repo", "alpha"})
        r = p["repo"]
        self.assertEqual(r["path"], str(self.f["repo"].resolve()))
        self.assertEqual(r["odd"], {"features": 1, "done": 2, "total": 3, "percent": 67})
        self.assertEqual(r["memories"], 1)
        self.assertTrue(r["graph"]["mirrored"])
        self.assertGreater(r["graph"]["nodes"], 0)
        self.assertEqual(r["origin"], ["flag"])
        a = p["alpha"]
        self.assertEqual((a["sessions"], a["memories"], a["odd"]["features"], a["graph"]["mirrored"]), (2, 1, 0, False))  # s7 by cwd, s1 by project name; one live memory
        self.assertEqual(a["origin"], ["discovered"])

    def test_config_is_part_of_the_answer(self):
        (self.f["state"] / "portal.json").write_text(json.dumps({"repos": [str(self.alpha)], "auto_discover": False}))
        body = self.fresh() and self.get("/api/projects")
        self.assertEqual((body["auto_discover"], body["config_repos"]), (False, [str(self.alpha.resolve())]))
        self.assertEqual({p["name"] for p in body["projects"]}, {"repo", "alpha"})

    def test_project_page_lists_features_sessions_memories_and_graph(self):
        pg = self.page("project", "repo")
        self.assertEqual((pg["kind"], pg["id"], pg["title"]), ("project", "repo", "repo"))
        self.assertEqual(pg["progress"], {"done": 2, "total": 3, "percent": 67})
        heads = {s["heading"]: s for s in pg["sections"]}
        self.assertEqual([(i["kind"], i["id"]) for i in heads["ODD features"]["items"]], [("feature", "repo/feat")])
        self.assertIn("2 of 3", heads["ODD features"]["items"][0]["value"])
        self.assertEqual([i["kind"] for i in heads["Memories"]["items"]], ["memory"])
        self.assertEqual(pg["odd_diagrams"][0]["feature"], "repo/feat")
        self.assertIn("T2", pg["odd_diagrams"][0]["source"])
        self.assertEqual(pg["graph"]["mirrored"], True)
        labels = {m["label"] for m in pg["meta"]}
        self.assertTrue({"Path", "Features", "Sessions", "Memories", "Graph memory"} <= labels)
        a = self.page("project", "alpha")
        self.assertEqual({s["heading"] for s in a["sections"]} & {"Recent sessions"}, {"Recent sessions"})
        self.assertEqual(a["graph"]["mirrored"], False)
        self.assertIn("graphify", a["graph"]["howto"])

    def test_unknown_project_is_404_and_ids_are_never_paths(self):
        for ident in ("nope", "../repo", "/", "repo/x"):
            self.assertEqual(self.status("/api/wiki/page", kind="project", id=ident), 404, ident)

    def test_projects_are_searchable(self):
        groups = {g["kind"]: g for g in self.get("/api/wiki/search", q="alph")["groups"]}
        self.assertEqual([(i["kind"], i["id"]) for i in groups["project"]["items"]], [("project", "alpha")])


class QualifiedFeatureIdsTest(ProjectBase):
    def other(self):
        other = git_dir(self.root / "other")
        (other / "odd" / "tasks").mkdir(parents=True)
        (other / "odd" / "tasks" / "feat.md").write_text("# Other feature\n\n- [ ] X1 thing\n")
        self.cfg.repos = [self.f["repo"], other]
        return self.fresh()

    def test_feature_pages_answer_to_project_qualified_ids(self):
        pg = self.page("feature", "repo/feat")
        self.assertEqual((pg["id"], pg["title"]), ("repo/feat", "Feature"))
        self.assertEqual(self.meta(pg)["Repository"], "repo")

    def test_an_unqualified_id_still_works_when_unambiguous(self):
        self.assertEqual(self.page("feature", "feat")["id"], "repo/feat")

    def test_an_ambiguous_unqualified_id_is_not_guessed(self):
        self.other()
        self.assertEqual(self.status("/api/wiki/page", kind="feature", id="feat"), 404)
        self.assertEqual(self.page("feature", "other/feat")["title"], "Other feature")
        self.assertEqual(self.page("feature", "repo/feat")["title"], "Feature")

    def test_recent_and_search_use_qualified_ids(self):
        ids = [i["id"] for i in self.get("/api/wiki/recent")["items"] if i["kind"] == "feature"]
        self.assertEqual(ids, ["repo/feat"])
        hits = [i["id"] for g in self.get("/api/wiki/search", q="feat")["groups"] if g["kind"] == "feature" for i in g["items"]]
        self.assertEqual(hits, ["repo/feat"])

    def test_hostile_feature_ids_stay_404(self):
        for ident in ("repo/../x", "../repo/feat", "repo/feat/extra", "repo/"):
            self.assertEqual(self.status("/api/wiki/page", kind="feature", id=ident), 404, ident)


class ProjectConfigWriteTest(ServerBase):
    def setUp(self):
        super().setUp()
        self.home = Path(self.tmp.name)
        self.cfg.home = self.home
        self.good = git_dir(self.home / "proj")

    def post(self, body, token=True, origin=None, ctype="application/json", raw=None, extra=None):
        h = {"Content-Type": ctype, **(extra or {})}
        if token:
            h["X-Portal-Token"] = self.token()
        if origin:
            h["Origin"] = origin
        data = raw if raw is not None else json.dumps(body).encode()
        return self.request("POST", "/api/projects/config", headers=h, body=data)

    def saved(self):
        return json.loads((self.cfg.state_dir / "portal.json").read_text())

    def test_a_valid_write_is_normalized_deduplicated_and_persisted(self):
        link = self.home / "link"
        link.symlink_to(self.good, target_is_directory=True)
        status, _, body = self.post({"repos": [str(self.good), str(link), str(self.good) + "/"], "auto_discover": False})
        self.assertEqual(status, 200, body)
        self.assertEqual(self.saved(), {"repos": [str(self.good.resolve())], "auto_discover": False})
        self.assertEqual(json.loads(body)["config_repos"], [str(self.good.resolve())])
        self.assertEqual(json.loads(self.request("GET", "/api/projects")[2])["auto_discover"], False)

    def test_each_part_of_the_body_is_optional_and_keeps_the_rest(self):
        self.post({"repos": [str(self.good)], "auto_discover": False})
        self.assertEqual(self.post({"auto_discover": True})[0], 200)
        self.assertEqual(self.saved(), {"repos": [str(self.good.resolve())], "auto_discover": True})

    def rejected(self, status, body=None, **kw):
        s, _, data = self.post(body, **kw)
        self.assertEqual(s, status, data)
        self.assertFalse((self.cfg.state_dir / "portal.json").exists(), "a rejected write leaves no file")
        return json.loads(data)

    def test_the_request_guards_apply(self):
        self.rejected(403, {"repos": []}, token=False)
        self.rejected(403, {"repos": []}, origin="http://evil.example")
        self.rejected(403, {"repos": []}, extra={"Sec-Fetch-Site": "cross-site"})
        self.rejected(415, {"repos": []}, ctype="text/plain")
        self.rejected(400, raw=b"not json")
        self.rejected(400, ["repos"])
        self.assertEqual(self.request("POST", "/api/projects/config", headers={"Host": "evil.example", "Content-Type": "application/json"}, body=b"{}")[0], 403)

    def test_the_body_size_is_capped(self):
        self.rejected(413, raw=json.dumps({"repos": ["/" + "a" * 100] * 400}).encode())

    def test_the_schema_is_closed(self):
        self.rejected(400, {"repos": [], "extra": 1})
        self.rejected(400, {"repos": "x"})
        self.rejected(400, {"repos": [5]})
        self.rejected(400, {"repos": [], "auto_discover": "yes"})
        self.rejected(400, {})

    def test_every_path_rule_has_its_own_rejection(self):
        (self.home / "file.txt").write_text("x")
        outside = Path(self.tmp.name + "-outside")
        outside.mkdir()
        self.addCleanup(outside.rmdir)
        (self.home / "escape").symlink_to(outside, target_is_directory=True)
        for bad in (str(self.home), "relative/dir", "", str(self.home / "ghost"), str(self.home / "file.txt"), str(outside), str(self.home / "escape"), str(self.good) + "\x00", "/", str(self.home.parent)):
            err = self.rejected(400, {"repos": [bad]})
            self.assertIn("error", err, bad)

    def test_at_most_fifty_paths(self):
        paths = []
        for i in range(projects.MAX_CONFIG_REPOS + 1):
            paths.append(str(git_dir(self.home / f"p{i:02d}")))
        self.rejected(413 if len(json.dumps({"repos": paths})) > server.PROJECTS_MAX_BODY else 400, {"repos": paths})

    def test_a_failed_write_keeps_the_previous_file(self):
        self.post({"repos": [str(self.good)]})
        before = self.saved()
        self.assertEqual(self.post({"repos": [str(self.home / "ghost")]})[0], 400)
        self.assertEqual(self.saved(), before)
