import contextlib
import io
import json
import os
import subprocess
import unittest
from pathlib import Path
from unittest import mock

from python.gentle_lite.graph import lock as gl

from .test_semantic_plan import good_chunk
from .test_semantic_untrusted import Env, chunk_of, cnode, edge


class SaveChunkTest(Env):
    def setUp(self):
        super().setUp()
        self.doc("docs/architecture.md")
        self.plan()
        self.target = self.out / ".graphify_chunk_01.json"

    def save(self, text=None, *args, via="stdin", num="1"):
        out, err = io.StringIO(), io.StringIO()
        argv = ["save-chunk", num, "--repo", str(self.repo), *args]
        stdin = io.StringIO(text if text is not None else "")
        if via == "file":
            src = Path(self.tmp.name) / "reply.json"
            src.write_text(text)
            argv += ["--input", str(src)]
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), mock.patch("sys.stdin", stdin):
            from python.gentle_lite.graph import semantic_plan as sp
            code = sp.main(argv)
        return code, (json.loads(out.getvalue()) if out.getvalue().strip() else {}), err.getvalue()

    def test_saves_stdin_and_the_chunk_then_validates(self):
        code, report, err = self.save(json.dumps(good_chunk()))
        self.assertEqual(code, 0, err)
        self.assertEqual((report["num"], report["nodes"], report["edges"], report["hyperedges"]), (1, 12, 14, 1))
        self.assertEqual(Path(report["path"]), self.target)
        self.assertEqual(json.loads(self.target.read_text()), good_chunk())
        code, validated, _ = self.validate()
        self.assertEqual((code, validated["chunks"][0]["valid"]), (0, True))

    def test_saves_from_an_input_file(self):
        code, _, err = self.save(json.dumps(good_chunk()), via="file")
        self.assertEqual(code, 0, err)
        self.assertTrue(self.target.exists())

    def test_tolerates_surrounding_whitespace(self):
        code, _, err = self.save("\n\n  \t" + json.dumps(good_chunk(), indent=1) + "  \n\n")
        self.assertEqual(code, 0, err)

    def rejected(self, text, needle=None):
        self.target.write_text("PREVIOUS")
        code, report, err = self.save(text)
        self.assertEqual(code, 2, err)
        self.assertEqual(report, {})
        self.assertEqual(self.target.read_text(), "PREVIOUS", "a rejected reply never touches the chunk file")
        self.assertEqual([p.name for p in self.out.glob(".gentle_semantic_tmp*")], [], "no temp file left behind")
        if needle:
            self.assertIn(needle, err)
        self.assertNotIn("Traceback", err)

    def test_rejects_a_fenced_reply(self):
        self.rejected("```json\n" + json.dumps(good_chunk()) + "\n```", "single JSON object")

    def test_rejects_prose_around_the_object(self):
        self.rejected("Here is the result:\n" + json.dumps(good_chunk()), "single JSON object")
        self.rejected(json.dumps(good_chunk()) + "\nDone.", "single JSON object")

    def test_rejects_two_objects(self):
        self.rejected(json.dumps(good_chunk()) + json.dumps(good_chunk()), "single JSON object")

    def test_rejects_non_objects_and_empty(self):
        for text in ("[]", "null", '"x"', "42", "", "   \n"):
            self.rejected(text, "single JSON object")

    def test_rejects_a_structurally_invalid_chunk(self):
        data = good_chunk()
        data["nodes"][0]["file_type"] = "markdown"
        self.rejected(json.dumps(data), "file_type")
        self.rejected(json.dumps({"nodes": [cnode("a")], "edges": [edge(["a"], "a")]}), "source")

    def test_rejects_oversized_input(self):
        with mock.patch("python.gentle_lite.graph.semantic_plan.MAX_CHUNK_BYTES", 50):
            self.rejected(json.dumps(good_chunk()), "larger than")

    def test_endpoints_in_other_chunks_are_allowed_but_reported(self):
        code, report, err = self.save(json.dumps(chunk_of([cnode("alpha")], [edge("alpha", "beta_in_chunk_two")])))
        self.assertEqual(code, 0, err)
        self.assertTrue(any("beta_in_chunk_two" in w for w in report["warnings"]), report)
        self.assertTrue(self.target.exists())

    def test_unknown_chunk_number_is_an_error(self):
        for num in ("0", "2", "-1"):
            code, _, err = self.save(json.dumps(good_chunk()), num=num)
            self.assertEqual(code, 2, num)
            self.assertIn("chunk", err)

    def test_requires_a_plan(self):
        (self.out / ".gentle_semantic_plan.json").unlink()
        code, _, err = self.save(json.dumps(good_chunk()))
        self.assertEqual(code, 2)
        self.assertIn("plan", err)

    def test_fails_fast_while_the_lock_is_held(self):
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        lock = gl.lock_path(self.repo)
        lock.mkdir()
        (lock / "pid").write_text(f"{os.getpid()}\n")
        code, _, err = self.save(json.dumps(good_chunk()))
        self.assertEqual(code, 2)
        self.assertIn("already running", err)
        self.assertFalse(self.target.exists())

    def test_saved_chunk_survives_a_second_plan_only_as_a_leftover_to_remove(self):
        self.save(json.dumps(good_chunk()))
        self.plan()
        self.assertFalse(self.target.exists())


class LockHeldExitCodeTest(unittest.TestCase):
    def test_lock_held_maps_to_tempfail_exit_code(self):
        from python.gentle_lite.graph import semantic_plan
        self.assertEqual(semantic_plan.EXIT_LOCKED, 75)
        self.assertNotIn(semantic_plan.EXIT_LOCKED, (semantic_plan.EXIT_ERROR, semantic_plan.EXIT_NO_VALID, semantic_plan.EXIT_REFUSED))
