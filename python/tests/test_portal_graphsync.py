import json
import os
import subprocess
import sys
import time
from pathlib import Path

from python.amauta.portal import graphsync, projects
from python.tests.test_portal_projects import ProjectBase, git_dir
from python.tests.test_portal_server import ServerBase

BEGIN = "# >>> amauta graphify >>>"
REPO_ROOT = Path(__file__).resolve().parents[2]


def real_git(path):
    Path(path).mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.email", "a@b.c"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.name", "T"], check=True)
    return Path(path)


def commit(path, when="2026-10-05T10:00:00Z"):
    (Path(path) / f"f{time.time_ns()}.txt").write_text("x")
    env = {**os.environ, "GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when}
    subprocess.run(["git", "-C", str(path), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "-q", "-m", "x"], check=True, env=env)


class StalenessTest(ProjectBase):
    def test_older_than_the_last_commit_is_stale(self):
        self.assertIs(graphsync.is_stale("2026-10-05T10:00:00Z", 1_791_194_401), True)  # 2026-10-05T10:00:01Z
        self.assertIs(graphsync.is_stale("2026-10-05T10:00:00Z", 1_791_194_400), False)  # same second
        self.assertIs(graphsync.is_stale("2026-10-05T10:00:01Z", 1_791_194_400), False)

    def test_unknown_when_either_side_is_missing(self):
        self.assertIsNone(graphsync.is_stale(None, 1_791_194_400))
        self.assertIsNone(graphsync.is_stale("2026-10-05T10:00:00Z", None))
        self.assertIsNone(graphsync.is_stale("not a date", 5))

    def test_git_projects_report_the_last_commit_hooks_and_staleness(self):
        repo = real_git(self.root / "gitproj")
        commit(repo, "2026-10-05T10:00:00Z")
        info = graphsync.info(repo, "2026-10-05T09:00:00Z")
        self.assertEqual((info["is_git"], info["last_commit"], info["stale"], info["hooks_installed"], info["opted_out"], info["running"]),
                         (True, "2026-10-05T10:00:00Z", True, False, False, False))
        self.assertIs(graphsync.info(repo, "2026-10-05T11:00:00Z")["stale"], False)
        self.assertIsNone(graphsync.info(repo, None)["stale"])
        (repo / ".git" / "hooks").mkdir(exist_ok=True)
        (repo / ".git" / "hooks" / "post-merge").write_text(f"#!/bin/sh\n{BEGIN}\n:\n# <<< amauta graphify <<<\n")
        self.assertTrue(graphsync.info(repo, None)["hooks_installed"])
        subprocess.run(["git", "-C", str(repo), "config", "amauta.graphifyHook", "false"], check=True)
        self.assertTrue(graphsync.info(repo, None)["opted_out"])

    def test_a_plain_directory_has_no_git_facts_and_a_repo_without_commits_no_last_commit(self):
        plain = self.root / "plain"
        plain.mkdir()
        info = graphsync.info(plain, "2026-10-05T09:00:00Z")
        self.assertEqual((info["is_git"], info["last_commit"], info["stale"], info["hooks_installed"]), (False, None, None, False))
        empty = real_git(self.root / "empty")
        self.assertEqual((graphsync.info(empty, "2026-10-05T09:00:00Z")["is_git"], graphsync.info(empty, "2026-10-05T09:00:00Z")["last_commit"]), (True, None))

    def test_running_follows_the_lock(self):
        plain = self.root / "plain"
        (plain / "graphify-out" / ".amauta-graphify.lock").mkdir(parents=True)
        self.assertTrue(graphsync.info(plain, None)["running"])

    def test_the_project_page_carries_the_new_facts_and_the_list_stays_lean(self):
        repo = real_git(self.root / "gitproj")
        commit(repo)
        self.cfg.repos = [repo]
        self.fresh()
        self.assertNotIn("is_git", self.get("/api/projects")["projects"][0]["graph"])
        g = self.page("project", "gitproj")["graph"]
        self.assertEqual((g["mirrored"], g["is_git"], g["stale"], g["hooks_installed"], g["last_commit"]), (False, True, None, False, "2026-10-05T10:00:00Z"))


class GraphSyncApiTest(ServerBase):
    def setUp(self):
        super().setUp()
        self.home = Path(self.tmp.name)
        self.cfg.home = self.home
        self.git = real_git(self.home / "gitproj")
        commit(self.git)
        self.plain = self.home / "plainproj"
        self.plain.mkdir()
        self.cfg.repos = [*self.cfg.repos, self.git, self.plain]
        projects.forget(self.srv.portal)
        self.spawned, self.ran = [], []
        gs = self.srv.graphsync
        gs.spawner = lambda argv, env: self.spawned.append((argv, env))
        gs.runner = lambda argv, timeout: self.ran.append((argv, timeout)) or subprocess.CompletedProcess(argv, 0, "hooks installed\n", "")
        gs.which = lambda name: f"/fake/bin/{name}"

    def post(self, path, body, token=True, origin=None, ctype="application/json", raw=None, extra=None):
        h = {"Content-Type": ctype, **(extra or {})}
        if token:
            h["X-Portal-Token"] = self.token()
        if origin:
            h["Origin"] = origin
        return self.request("POST", path, headers=h, body=raw if raw is not None else json.dumps(body).encode())

    def test_the_request_guards_apply_to_both_endpoints(self):
        for path in ("/api/projects/graph-sync", "/api/projects/graph-connect"):
            self.assertEqual(self.post(path, {"project": "plainproj"}, token=False)[0], 403, path)
            self.assertEqual(self.post(path, {"project": "plainproj"}, origin="http://evil.example")[0], 403, path)
            self.assertEqual(self.post(path, {"project": "plainproj"}, extra={"Sec-Fetch-Site": "cross-site"})[0], 403, path)
            self.assertEqual(self.post(path, {"project": "plainproj"}, ctype="text/plain")[0], 415, path)
            self.assertEqual(self.post(path, None, raw=b"not json")[0], 400, path)
            self.assertEqual(self.post(path, ["plainproj"])[0], 400, path)
            self.assertEqual(self.post(path, None, raw=json.dumps({"project": "x" * 5000}).encode())[0], 413, path)
            self.assertEqual(self.request("POST", path, headers={"Host": "evil.example", "Content-Type": "application/json"}, body=b"{}")[0], 403, path)
        self.assertEqual((self.spawned, self.ran), ([], []))

    def test_unknown_projects_and_paths_are_400_and_nothing_starts(self):
        for body in ({"project": "nope"}, {"project": "../plainproj"}, {"project": str(self.plain)}, {"project": "/etc"}, {"project": ""}, {"project": 5}, {}, {"project": "plainproj", "path": "/etc"}):
            for path in ("/api/projects/graph-sync", "/api/projects/graph-connect"):
                s, _, data = self.post(path, body)
                self.assertEqual(s, 400, (path, body))
                self.assertIn("error", json.loads(data))
        self.assertEqual((self.spawned, self.ran), ([], []))

    def test_sync_starts_the_refresh_in_the_background_with_the_right_argv_and_returns_202(self):
        for proj, directory in (("plainproj", self.plain), ("gitproj", self.git)):
            self.spawned.clear()
            s, _, data = self.post("/api/projects/graph-sync", {"project": proj})
            self.assertEqual(s, 202, data)
            self.assertEqual(json.loads(data)["project"], proj)
            (argv, env), = self.spawned
            self.assertEqual(argv, [sys.executable, "-P", "-m", "amauta.graph.refresh", "--repo", str(directory.resolve())])
            self.assertEqual(env["AMAUTA_STATE_DIR"], str(self.cfg.state_dir))
            self.assertEqual(env["PYTHONPATH"], str(REPO_ROOT / "python"))
            self.assertFalse({k for k in env if "KEY" in k or "TOKEN" in k or "SECRET" in k}, "no secrets in the child's environment")

    def test_sync_without_graphify_is_a_clear_error(self):
        self.srv.graphsync.which = lambda name: None
        s, _, data = self.post("/api/projects/graph-sync", {"project": "plainproj"})
        self.assertEqual(s, 409)
        self.assertIn("graphify is not installed", json.loads(data)["error"])
        self.assertEqual(self.spawned, [])

    def test_a_spawn_failure_is_reported(self):
        def boom(argv, env):
            raise OSError("no exec")
        self.srv.graphsync.spawner = boom
        s, _, data = self.post("/api/projects/graph-sync", {"project": "plainproj"})
        self.assertEqual(s, 500)
        self.assertIn("could not start", json.loads(data)["error"])

    def test_connect_runs_the_cli_for_a_git_project(self):
        s, _, data = self.post("/api/projects/graph-connect", {"project": "gitproj"})
        self.assertEqual(s, 200, data)
        (argv, timeout), = self.ran
        self.assertEqual(argv, ["/fake/bin/node", str(REPO_ROOT / "bin" / "amauta.js"), "graphify", "hook", "install", "--cwd", str(self.git.resolve()), "--state-dir", str(self.cfg.state_dir)])
        self.assertGreater(timeout, 0)
        self.assertEqual(json.loads(data)["project"], "gitproj")

    def test_connect_really_installs_the_event_hooks(self):
        import shutil
        if shutil.which("node") is None:
            self.skipTest("node not available")
        self.srv.graphsync.runner = graphsync.run_cli
        self.srv.graphsync.which = shutil.which
        s, _, data = self.post("/api/projects/graph-connect", {"project": "gitproj"})
        self.assertEqual(s, 200, data)
        for event in ("post-commit", "post-merge", "post-rewrite", "post-checkout"):
            self.assertIn(BEGIN, (self.git / ".git" / "hooks" / event).read_text(), event)
        self.assertTrue(graphsync.info(self.git, None)["hooks_installed"])

    def test_connect_refuses_a_non_git_directory_a_subdirectory_and_a_failing_cli(self):
        s, _, data = self.post("/api/projects/graph-connect", {"project": "plainproj"})
        self.assertEqual(s, 400)
        self.assertIn("git", json.loads(data)["error"])
        sub = self.git / "sub"
        sub.mkdir()
        self.cfg.repos = [*self.cfg.repos, sub]
        projects.forget(self.srv.portal)
        self.assertEqual(self.post("/api/projects/graph-connect", {"project": "sub"})[0], 400)
        self.assertEqual(self.ran, [])
        self.srv.graphsync.runner = lambda argv, timeout: subprocess.CompletedProcess(argv, 1, "", "amauta: hook is not a shell script\n")
        s, _, data = self.post("/api/projects/graph-connect", {"project": "gitproj"})
        self.assertEqual(s, 500)
        self.assertIn("not a shell script", json.loads(data)["error"])

    def test_connect_without_node_is_a_clear_error(self):
        self.srv.graphsync.which = lambda name: None
        s, _, data = self.post("/api/projects/graph-connect", {"project": "gitproj"})
        self.assertEqual(s, 409)
        self.assertIn("node", json.loads(data)["error"])

    def test_two_projects_with_the_same_name_are_ambiguous(self):
        other = git_dir(self.home / "elsewhere" / "plainproj")
        self.cfg.repos = [*self.cfg.repos, other]
        projects.forget(self.srv.portal)
        self.assertEqual(self.post("/api/projects/graph-sync", {"project": "plainproj"})[0], 400)
        self.assertEqual(self.spawned, [])


class CatalogTest(ServerBase):
    def test_every_error_the_sync_actions_can_send_has_a_spanish_entry(self):
        import re
        from python.tests.test_portal_i18n import catalog, covered
        keys = catalog()
        src = (REPO_ROOT / "python" / "amauta" / "portal" / "graphsync.py").read_text()
        messages = [re.sub(r"\{[^}]*\}", "{reason}", m) for m in re.findall(r'SyncError\(f?"((?:[^"\\]|\\.)*)"', src)]
        self.assertGreaterEqual(len(messages), 8)
        self.assertEqual([m for m in messages if not covered(m.replace('\\"', '"'), keys)], [])
