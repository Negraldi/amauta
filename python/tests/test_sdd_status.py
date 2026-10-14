import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from python.gentle_lite.sdd import status as sdd_status

ROOT = Path(__file__).resolve().parents[2]
TASKS = "# Tasks\n\n- [x] 1.1 first\n- [ ] 1.2 second\n- [ ] 1.3 third\n"


def run_cli(*args, cwd=None):
    env = {**os.environ, "PYTHONPATH": str(ROOT / "python")}
    return subprocess.run([sys.executable, "-P", "-m", "gentle_lite.sdd", *args], capture_output=True, text=True, env=env, cwd=cwd, timeout=60)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name).resolve() / "repo"
        self.repo.mkdir()

    def change(self, name="feat", **files):
        base = self.repo / "openspec" / "changes" / name
        base.mkdir(parents=True, exist_ok=True)
        for rel, text in files.items():
            p = base / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
        return base

    def status(self, change=None, **kw):
        return sdd_status.compute(self.repo, change, **kw)


class SelectionTest(Base):
    def test_no_changes_is_unresolved_and_recommends_sdd_new(self):
        s = self.status()
        self.assertEqual((s["schemaName"], s["schemaVersion"]), ("gentle-ai.sdd-status", 2))
        self.assertIsNone(s["changeName"])
        self.assertEqual(s["nextRecommended"], "sdd-new")
        self.assertEqual(s["blockedReasons"], ["No active OpenSpec changes found under openspec/changes."])

    def test_single_change_is_selected_and_archive_dir_is_ignored(self):
        self.change("feat", **{"proposal.md": "# p"})
        (self.repo / "openspec" / "changes" / "archive" / "2026-old").mkdir(parents=True)
        s = self.status()
        self.assertEqual(s["changeName"], "feat")

    def test_several_changes_require_selection_and_explicit_name_wins(self):
        self.change("a", **{"proposal.md": "p"})
        self.change("b", **{"proposal.md": "p"})
        s = self.status()
        self.assertEqual(s["nextRecommended"], "select-change")
        self.assertIsNone(s["changeName"])
        self.assertTrue(any("a, b" in r for r in s["blockedReasons"]))
        self.assertEqual(self.status("b")["changeName"], "b")

    def test_unknown_or_unsafe_change_names_are_rejected(self):
        self.change("a", **{"proposal.md": "p"})
        for bad in ("nope", "../a", "a/b", ".hidden", ""):
            with self.assertRaises(sdd_status.StatusError, msg=bad):
                self.status(bad or "  ")


class ArtifactTest(Base):
    def test_planning_chain_next_recommended(self):
        self.change("feat")
        self.assertEqual(self.status()["nextRecommended"], "propose")
        self.change("feat", **{"proposal.md": "p"})
        s = self.status()
        self.assertEqual(s["nextRecommended"], "spec")
        self.assertEqual(s["dependencies"]["specs"], "ready")
        self.assertEqual(s["dependencies"]["tasks"], "blocked")
        self.change("feat", **{"specs/auth/spec.md": "s"})
        self.assertEqual(self.status()["nextRecommended"], "design")
        self.change("feat", **{"design.md": "d"})
        s = self.status()
        self.assertEqual(s["nextRecommended"], "tasks")
        self.assertEqual(s["dependencies"]["tasks"], "ready")
        self.assertEqual(s["dependencies"]["apply"], "blocked")

    def test_full_artifact_set_and_paths(self):
        base = self.change("feat", **{"proposal.md": "p", "specs/auth/spec.md": "s", "specs/x/spec.md": "s", "design.md": "d", "tasks.md": TASKS,
                                      "apply-progress.md": "a", "verify-report.md": "v"})
        s = self.status()
        self.assertEqual(s["artifacts"], {"proposal": "done", "specs": "done", "design": "done", "tasks": "done", "applyProgress": "done", "verifyReport": "done"})
        self.assertEqual(s["artifactPaths"]["proposal"], [str(base / "proposal.md")])
        self.assertEqual(s["artifactPaths"]["specs"], [str(base / "specs/auth/spec.md"), str(base / "specs/x/spec.md")])
        self.assertEqual(s["artifactPaths"]["applyProgress"], [str(base / "apply-progress.md")])
        self.assertEqual(s["contextFiles"], s["artifactPaths"])
        self.assertEqual(s["changeRoot"], str(base))
        self.assertEqual(s["planningHome"], {"mode": "repo-local", "path": str(self.repo / "openspec")})
        self.assertEqual(s["artifactStore"], "openspec")
        self.assertEqual(s["relationships"], {"dependsOn": [], "supersedes": [], "amends": [], "conflictsWith": [], "sameDomainActiveChanges": []})

    def test_missing_artifacts_are_empty_arrays_never_null(self):
        self.change("feat", **{"proposal.md": "p"})
        s = self.status()
        for key in ("specs", "design", "tasks", "applyProgress", "verifyReport"):
            self.assertEqual(s["artifactPaths"][key], [])
            self.assertEqual(s["artifacts"][key], "missing")
        self.assertEqual(s["notes"], [])

    def test_task_progress_and_apply_state(self):
        self.change("feat", **{"proposal.md": "p", "specs/a/spec.md": "s", "design.md": "d", "tasks.md": TASKS})
        s = self.status()
        self.assertEqual(s["taskProgress"], {"total": 3, "completed": 1, "pending": 2, "allComplete": False})
        self.assertEqual((s["applyState"], s["dependencies"]["apply"], s["nextRecommended"]), ("ready", "ready", "apply"))
        self.change("feat", **{"tasks.md": "- [x] one\n* [X] two\n"})
        s = self.status()
        self.assertEqual(s["taskProgress"], {"total": 2, "completed": 2, "pending": 0, "allComplete": True})
        self.assertEqual((s["applyState"], s["dependencies"]["apply"], s["nextRecommended"]), ("all_done", "all_done", "archive"))

    def test_tasks_file_without_checkboxes_is_partial(self):
        self.change("feat", **{"proposal.md": "p", "specs/a/spec.md": "s", "design.md": "d", "tasks.md": "# nothing yet\n"})
        s = self.status()
        self.assertEqual(s["artifacts"]["tasks"], "partial")
        self.assertEqual(s["taskProgress"]["total"], 0)
        self.assertFalse(s["taskProgress"]["allComplete"])


class StoreAndAuthorityTest(Base):
    def test_declared_engram_or_hybrid_store_is_reported_unsupported(self):
        self.change("feat", **{"proposal.md": "p"})
        for store in ("engram", "hybrid"):
            (self.repo / "openspec" / "config.yaml").write_text(f"schema: spec-driven\nsdd:\n  artifact_store: {store}\n")
            s = self.status()
            self.assertEqual(s["artifactStore"], store)
            self.assertEqual(s["nextRecommended"], "resolve-blockers")
            self.assertTrue(any("not supported" in r and store in r for r in s["blockedReasons"]), s["blockedReasons"])

    def test_declared_openspec_store_is_fine(self):
        self.change("feat", **{"proposal.md": "p"})
        (self.repo / "openspec" / "config.yaml").write_text("artifact_store: openspec\n")
        self.assertEqual(self.status()["blockedReasons"], [])

    def test_action_context_allows_only_the_workspace_root(self):
        self.change("feat", **{"proposal.md": "p"})
        self.assertEqual(self.status()["actionContext"], {"mode": "repo-local", "workspaceRoot": str(self.repo), "allowedEditRoots": [str(self.repo)]})

    def test_task_targeting_a_path_outside_the_edit_roots_blocks_apply(self):
        outside = Path(self.tmp.name).resolve() / "other-repo" / "src"
        tasks = f"- [ ] edit `{outside}/main.py`\n- [ ] read `{outside}/ref.py` (read-only)\n- [ ] inside `src/ok.py`\n"
        self.change("feat", **{"proposal.md": "p", "specs/a/spec.md": "s", "design.md": "d", "tasks.md": tasks})
        s = self.status()
        self.assertEqual((s["applyState"], s["dependencies"]["apply"], s["nextRecommended"]), ("blocked", "blocked", "resolve-blockers"))
        (reason,) = s["blockedReasons"]
        self.assertIn("blocked(edit_authority_missing)", reason)
        self.assertIn(str(outside / "main.py"), reason)
        self.assertNotIn("ref.py", reason)
        self.assertNotIn("ok.py", reason)

    def test_read_only_marker_clears_the_blocker(self):
        outside = Path(self.tmp.name).resolve() / "elsewhere" / "f.py"
        self.change("feat", **{"proposal.md": "p", "specs/a/spec.md": "s", "design.md": "d", "tasks.md": f"- [ ] look at `{outside}` (read-only)\n"})
        self.assertEqual(self.status()["blockedReasons"], [])


class InstructionsTest(Base):
    def test_instructions_are_optional_and_cover_execution_phases(self):
        self.change("feat", **{"proposal.md": "p"})
        self.assertNotIn("phaseInstructions", self.status())
        s = self.status(instructions=True)
        self.assertEqual(set(s["phaseInstructions"]), {"apply", "verify", "archive"})
        self.assertTrue(all(isinstance(i, str) and i for v in s["phaseInstructions"].values() for i in v))


class CliTest(Base):
    def test_json_prints_only_the_json_document(self):
        self.change("feat", **{"proposal.md": "p"})
        r = run_cli("status", "feat", "--cwd", str(self.repo), "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["changeName"], "feat")

    def test_markdown_output_has_summary_and_a_json_block(self):
        self.change("feat", **{"proposal.md": "p"})
        r = run_cli("status", "--cwd", str(self.repo))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("## SDD Status: feat", r.stdout)
        self.assertIn("next: spec", r.stdout)
        block = r.stdout.split("```json\n", 1)[1].split("\n```", 1)[0]
        self.assertEqual(json.loads(block)["nextRecommended"], "spec")

    def test_unresolved_markdown_and_blocked_reasons(self):
        r = run_cli("status", "--cwd", str(self.repo))
        self.assertIn("## SDD Status: unresolved", r.stdout)
        self.assertIn("No active OpenSpec changes found under openspec/changes.", r.stdout)

    def test_instructions_flag(self):
        self.change("feat", **{"proposal.md": "p"})
        out = json.loads(run_cli("status", "--cwd", str(self.repo), "--json", "--instructions").stdout)
        self.assertIn("phaseInstructions", out)

    def test_continue_is_a_read_only_dispatcher_view(self):
        self.change("feat", **{"proposal.md": "p"})
        before = sorted(str(p) for p in self.repo.rglob("*"))
        r = run_cli("continue", "--cwd", str(self.repo))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("## Native SDD Dispatcher: feat", r.stdout)
        self.assertIn("next_recommended: spec", r.stdout)
        self.assertIn("phaseInstructions", r.stdout)
        self.assertEqual(sorted(str(p) for p in self.repo.rglob("*")), before)

    def test_explicit_unknown_change_exits_non_zero(self):
        r = run_cli("status", "ghost", "--cwd", str(self.repo))
        self.assertEqual(r.returncode, 1)
        self.assertIn("ghost", r.stderr)

    def test_does_not_import_code_from_cwd(self):
        evil = Path(self.tmp.name) / "evil"
        (evil / "gentle_lite").mkdir(parents=True)
        marker = Path(self.tmp.name) / "pwned"
        (evil / "gentle_lite" / "__init__.py").write_text(f"open({str(marker)!r}, 'w').write('x')\n")
        r = run_cli("status", "--cwd", str(self.repo), cwd=evil)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(marker.exists())

    def test_engram_store_is_stated_clearly_in_markdown(self):
        self.change("feat", **{"proposal.md": "p"})
        (self.repo / "openspec" / "config.yaml").write_text("artifact_store: engram\n")
        r = run_cli("status", "--cwd", str(self.repo))
        self.assertIn("not supported", r.stdout)


if __name__ == "__main__":
    unittest.main()
