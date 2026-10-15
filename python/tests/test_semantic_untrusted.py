import json
import os
import time
from pathlib import Path

from python.gentle_lite.graph import semantic_plan as sp

from .test_semantic_plan import Base, good_chunk, node, run_main, write_graph


def chunk_of(nodes, edges=(), hyper=()):
    return {"nodes": list(nodes), "edges": list(edges), "hyperedges": list(hyper)}


def cnode(i, **kw):
    return {"id": i, "label": i, "file_type": "concept", "source_file": "x.md", **kw}


def edge(a, b, **kw):
    return {"source": a, "target": b, "relation": "references", "confidence": "INFERRED", "confidence_score": 0.8, **kw}


class Env(Base):
    def setUp(self):
        super().setUp()
        write_graph(self.repo)
        self.out = self.repo / "graphify-out"

    def put(self, data, num=1, raw=None):
        p = self.out / f".graphify_chunk_{num:02d}.json"
        p.write_text(raw if raw is not None else json.dumps(data))
        return p

    def validate(self):
        code, out, err = run_main("validate", "--repo", str(self.repo))
        return code, (json.loads(out) if out.strip() else {}), err

    def merge(self, *extra):
        code, out, err = run_main("merge", "--repo", str(self.repo), "--graphify-bin", str(self.fake.exe), "--no-sync", *extra)
        return code, (json.loads(out) if out.strip() else {}), err

    def graph(self):
        return json.loads((self.out / "graph.json").read_text())

    def edit_plan(self, fn):
        pf = self.out / ".gentle_semantic_plan.json"
        plan = json.loads(pf.read_text())
        fn(plan)
        pf.write_text(json.dumps(plan))


class LeftoverTest(Env):
    def test_plan_removes_leftover_chunk_and_prompt_files_but_nothing_else(self):
        self.doc("docs/a.md")
        self.plan()
        keep = self.out / "graph.html"
        keep.write_text("keep")
        for name in (".graphify_chunk_01.json", ".graphify_chunk_07.json", ".gentle_semantic_prompt_09.md"):
            (self.out / name).write_text("old")
        self.plan()
        names = sorted(p.name for p in self.out.iterdir() if p.name.startswith((".graphify_chunk_", ".gentle_semantic_prompt_")))
        self.assertEqual(names, [".gentle_semantic_prompt_01.md"], "only the new plan's prompt files remain, no chunk files")
        self.assertTrue(keep.exists())

    def test_a_stale_chunk_from_an_earlier_run_is_never_reused(self):
        self.doc("docs/architecture.md")
        self.plan()
        self.put(good_chunk())
        self.plan()  # a new run: the subagent then fails and never writes chunk 1
        code, report, _ = self.validate()
        self.assertEqual(code, 3)
        self.assertIn("missing", report["chunks"][0]["errors"][0])
        code, report, err = self.merge()
        self.assertEqual(code, 3, err)
        self.assertEqual(len(self.graph()["nodes"]), 2, "graph.json untouched")

    def test_a_chunk_saved_before_the_plan_is_reported_stale(self):
        self.doc("docs/architecture.md")
        _, plan = self.plan()
        self.assertTrue(plan["plan_id"] and isinstance(plan["created_ns"], int))
        path = self.put(good_chunk())
        old = time.time() - 3600
        os.utime(path, (old, old))
        code, report, _ = self.validate()
        self.assertEqual(code, 3)
        self.assertIn("before the plan", " ".join(report["chunks"][0]["errors"]))

    def test_each_plan_gets_its_own_id(self):
        self.doc("docs/a.md")
        _, first = self.plan()
        _, second = self.plan()
        self.assertNotEqual(first["plan_id"], second["plan_id"])


class UntrustedChunkTest(Env):
    def setUp(self):
        super().setUp()
        self.doc("docs/architecture.md")
        self.plan()

    def invalid(self, data=None, raw=None):
        self.put(data, raw=raw)
        code, report, err = self.validate()
        self.assertNotIn("Traceback", err)
        chunk = report["chunks"][0]
        self.assertFalse(chunk["valid"], chunk)
        return chunk

    def test_unhashable_edge_endpoint_is_invalid_not_a_crash(self):
        self.invalid(chunk_of([cnode("a")], [edge(["a"], {"x": 1})]))

    def test_non_string_endpoint_is_invalid(self):
        self.invalid(chunk_of([cnode("a")], [edge(1, "a")]))

    def test_hyperedge_member_that_is_a_dict_is_invalid(self):
        self.invalid(chunk_of([cnode("a"), cnode("b"), cnode("c")], [], [{"id": "h", "nodes": ["a", "b", {"x": 1}]}]))

    def test_non_list_hyperedges_value_is_invalid(self):
        self.invalid({"nodes": [cnode("a")], "edges": [], "hyperedges": "yes"})

    def test_non_list_edges_value_is_invalid(self):
        self.invalid({"nodes": [cnode("a")], "edges": {"a": 1}, "hyperedges": []})

    def test_non_string_relation_or_hyperedge_id_is_invalid(self):
        self.invalid(chunk_of([cnode("a")], [edge("a", "a", relation=["x"])]))
        self.invalid(chunk_of([cnode("a"), cnode("b"), cnode("c")], [], [{"id": ["h"], "nodes": ["a", "b", "c"]}]))

    def test_non_string_node_fields_are_invalid(self):
        self.invalid(chunk_of([cnode("a", source_file=["x"])]))

    def test_top_level_garbage_is_invalid(self):
        self.invalid(raw="null")
        self.invalid(raw='"text"')

    def test_ids_of_an_invalid_chunk_are_not_known_endpoints(self):
        self.edit_plan(lambda p: None)
        self.doc("docs/second.md")
        self.plan("--chunk-size", "1")
        good_edge_to_beta = chunk_of([cnode("alpha")], [edge("alpha", "beta")])
        bad_with_beta = chunk_of([cnode("beta", file_type="markdown")])  # invalid: file_type
        self.put(good_edge_to_beta, 1)
        self.put(bad_with_beta, 2)
        code, report, _ = self.validate()
        by = {c["num"]: c for c in report["chunks"]}
        self.assertFalse(by[2]["valid"])
        self.assertFalse(by[1]["valid"], "its only endpoint lives in a chunk that was rejected")
        self.assertIn("beta", " ".join(by[1]["errors"]))
        code, _, _ = self.merge()
        self.assertEqual(code, 3)
        self.assertEqual(len(self.graph()["nodes"]), 2)

    def test_valid_chunks_may_still_reference_each_other(self):
        self.doc("docs/second.md")
        self.plan("--chunk-size", "1")
        self.put(chunk_of([cnode("alpha")], [edge("alpha", "beta")]), 1)
        self.put(chunk_of([cnode("beta")], [edge("beta", "alpha")]), 2)
        code, report, _ = self.validate()
        self.assertEqual(code, 0)
        self.assertTrue(all(c["valid"] for c in report["chunks"]), report)

    def test_garbage_in_the_cached_results_file_is_ignored(self):
        self.put(good_chunk())
        (self.out / ".gentle_semantic_cached.json").write_text(json.dumps({"nodes": [{"id": ["x"]}, "s", {"id": "ok_one", "label": "o", "file_type": "concept", "source_file": "c.md"}], "edges": "no", "hyperedges": 7}))
        code, report, err = self.merge()
        self.assertEqual(code, 0, err)
        ids = {n["id"] for n in self.graph()["nodes"]}
        self.assertIn("ok_one", ids)
        self.assertNotIn("Traceback", err)


class UntrustedPlanTest(Env):
    def setUp(self):
        super().setUp()
        self.doc("docs/architecture.md")
        self.plan()
        self.put(good_chunk())

    def refused(self, fn, needle):
        self.edit_plan(fn)
        for argv in (("validate", "--repo", str(self.repo)), ("merge", "--repo", str(self.repo), "--graphify-bin", str(self.fake.exe), "--no-sync")):
            code, _, err = run_main(*argv)
            self.assertEqual(code, 2, (argv, err))
            self.assertIn(needle, err)
            self.assertNotIn("Traceback", err)
        self.assertEqual(len(self.graph()["nodes"]), 2)

    def test_interpreter_from_the_plan_is_never_executed(self):
        marker = Path(self.tmp.name) / "pwned"
        evil = Path(self.tmp.name) / "evil.sh"
        evil.write_text(f"#!/bin/sh\ntouch {marker}\n")
        evil.chmod(0o755)
        self.edit_plan(lambda p: p.update(graphify_python=str(evil)))
        code, _, err = run_main("merge", "--repo", str(self.repo), "--graphify-bin", str(self.fake.exe), "--no-sync")
        self.assertEqual(code, 2)
        self.assertIn("different graphify", err)
        self.assertFalse(marker.exists())

    def test_chunk_path_must_be_the_planned_file_inside_graphify_out(self):
        self.refused(lambda p: p["chunks"][0].update(chunk_path="/etc/hostname"), "chunk_path")

    def test_prompt_file_must_stay_inside_graphify_out(self):
        self.refused(lambda p: p["chunks"][0].update(prompt_file="/etc/hostname"), "prompt_file")

    def test_wrong_types_are_a_clear_error(self):
        self.refused(lambda p: p.update(chunks="nope"), "chunks")

    def test_file_lists_must_be_lists_of_strings(self):
        self.refused(lambda p: p["chunks"][0].update(files=[1, {"a": 1}]), "files")

    def test_plan_of_another_repo_is_refused(self):
        self.refused(lambda p: p.update(repo="/somewhere/else"), "another repository")

    def test_all_files_and_mode_are_type_checked(self):
        self.refused(lambda p: p.update(all_files="x"), "all_files")


class CleanupTest(Env):
    def test_the_dead_spec_constant_is_gone(self):
        self.assertFalse(hasattr(sp, "SPEC_REL"))

    def test_prompt_asks_for_a_json_only_reply_and_never_for_a_file_write(self):
        self.doc("docs/a.md")
        _, plan = self.plan()
        prompt = Path(plan["chunks"][0]["prompt_file"]).read_text()
        self.assertNotIn("Then write the JSON to disk", prompt)
        self.assertNotIn(plan["chunks"][0]["chunk_path"], prompt)
        self.assertIn("Reply with only the JSON object", prompt)
        self.assertIn("no code fences", prompt)
        self.assertIn("You are a graphify extraction subagent.", prompt, "the rest of the spec stays verbatim")
