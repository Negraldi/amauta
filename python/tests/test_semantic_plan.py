import contextlib
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from python.amauta.graph import semantic_plan as sp

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = Path(__file__).parent / "fixtures" / "graphify_chunk_01.json"
FIXTURE_PREFIX = "/REPO_ROOT"  # placeholder root inside the committed chunk fixture; tests rewrite it to the real repo

SPEC = """# graphify reference: extraction subagent prompt

Each semantic subagent receives the prompt below verbatim.

```
You are a graphify extraction subagent.

Files (chunk CHUNK_NUM of TOTAL_CHUNKS):
FILE_LIST

Rules:
- set source_file to the path exactly as it appears in FILE_LIST

DEEP_MODE (if --mode deep was given): be aggressive.

Then write the JSON to disk using the Write tool at this exact absolute path:
CHUNK_PATH
```
"""

# A stand-in for the `graphify` package. It runs in graphify's own interpreter (a venv here), never in ours.
FAKE_PACKAGE = {
    "__init__.py": "",
    "skills/claude/references/extraction-spec.md": SPEC,
    "detect.py": '''
import os
from pathlib import Path
KINDS = {".py": "code", ".sql": "code", ".md": "document", ".pdf": "paper", ".png": "image"}
def detect(root, **kw):
    files = {"code": [], "document": [], "paper": [], "image": [], "video": []}
    for dirpath, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in ("graphify-out", ".git")]
        for n in sorted(names):
            kind = KINDS.get(Path(n).suffix)
            if kind:
                files[kind].append(str(Path(dirpath) / n))
    return {"files": files}
''',
    "cache.py": '''
import json, os
from pathlib import Path
def _log(entry):
    with open(os.environ["FAKE_GRAPHIFY_LOG"], "a") as fh:
        fh.write(json.dumps(entry) + "\\n")
def _store(root):
    return Path(root) / "graphify-out" / "fake_cache.json"
def check_semantic_cache(files, root=Path("."), mode=None, prompt=None, prompt_file=None, cache_root=None):
    _log({"call": "check", "files": list(files), "mode": mode, "prompt_file": str(prompt_file)})
    store = json.loads(_store(root).read_text()) if _store(root).exists() else {}
    nodes, edges, hyper, uncached = [], [], [], []
    for f in files:
        if f in store:
            nodes += store[f]["nodes"]; edges += store[f]["edges"]; hyper += store[f]["hyperedges"]
        else:
            uncached.append(f)
    return nodes, edges, hyper, uncached
def save_semantic_cache(nodes, edges, hyperedges=None, root=Path("."), merge_existing=False, allowed_source_files=None, mode=None, prompt=None, prompt_file=None, partial_source_files=None, cache_root=None):
    _log({"call": "save", "nodes": len(nodes), "edges": len(edges), "allowed": sorted(allowed_source_files or []), "mode": mode, "prompt_file": str(prompt_file)})
    return len(nodes)
''',
    "build.py": '''
import json, os
class FakeGraph:
    def __init__(self, nodes, edges, hyper):
        self.nodes, self.edges, self.hyper = nodes, edges, hyper
    def number_of_nodes(self): return len(self.nodes)
    def number_of_edges(self): return len(self.edges)
def build_from_json(extraction, *, directed=False, root=None, dedup=True):
    with open(os.environ["FAKE_GRAPHIFY_LOG"], "a") as fh:
        fh.write(json.dumps({"call": "build", "root": str(root), "keys": sorted(extraction)}) + "\\n")
    ids = {n["id"] for n in extraction["nodes"]}
    edges = [e for e in extraction.get("edges", []) if e["source"] in ids and e["target"] in ids]
    return FakeGraph(extraction["nodes"], edges, extraction.get("hyperedges", []))
''',
    "cluster.py": '''
def cluster(G, **kw):
    return {0: [n["id"] for n in G.nodes]}
''',
    "export.py": '''
import json, os
from pathlib import Path
def to_json(G, communities, output_path, *, force=False, **kw):
    p = Path(output_path)
    if not force and p.exists() and len(json.loads(p.read_text())["nodes"]) > G.number_of_nodes():
        return False
    p.write_text(json.dumps({"nodes": G.nodes, "links": G.edges, "hyperedges": G.hyper}))
    with open(os.environ["FAKE_GRAPHIFY_LOG"], "a") as fh:
        fh.write(json.dumps({"call": "to_json", "force": force}) + "\\n")
    return True
''',
}

FAKE_EXE = """#!{python}
import json, os, sys
with open(os.environ["FAKE_GRAPHIFY_LOG"], "a") as fh:
    fh.write(json.dumps({{"call": "exe", "argv": sys.argv[1:]}}) + "\\n")
"""


class FakeGraphify:
    """A venv (no pip) whose site-packages hold the fake `graphify`, plus an executable whose shebang points at it."""

    def __init__(self, base: Path):
        self.venv = base / "venv"
        subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(self.venv)], check=True, capture_output=True)
        self.python = self.venv / "bin" / "python"
        site = subprocess.run([str(self.python), "-c", "import sysconfig;print(sysconfig.get_paths()['purelib'])"], check=True, capture_output=True, text=True).stdout.strip()
        self.package = Path(site) / "graphify"
        for rel, text in FAKE_PACKAGE.items():
            target = self.package / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        (base / "bin").mkdir()
        self.exe = base / "bin" / "graphify"
        self.exe.write_text(FAKE_EXE.format(python=self.python))
        self.exe.chmod(0o755)


def node(id, file_type="code", source_file="schema.sql", **extra):
    return {"id": id, "label": id, "file_type": file_type, "source_file": source_file, "_origin": "ast", **extra}


def good_chunk():
    return json.loads(FIXTURE.read_text())


def write_graph(repo: Path, nodes=None, links=None):
    out = repo / "graphify-out"
    out.mkdir(parents=True, exist_ok=True)
    nodes = nodes if nodes is not None else [node("schema_users"), node("schema_orders")]
    (out / "graph.json").write_text(json.dumps({"directed": False, "nodes": nodes, "links": links or [], "hyperedges": []}))


def run_main(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = sp.main(list(argv))
    return code, out.getvalue(), err.getvalue()


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._base = tempfile.TemporaryDirectory()
        cls.fake = FakeGraphify(Path(cls._base.name))

    @classmethod
    def tearDownClass(cls):
        cls._base.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name).resolve() / "repo"
        self.repo.mkdir()
        self.log = Path(self.tmp.name) / "fake.log"
        self.state = Path(self.tmp.name) / "state"
        patcher = mock.patch.dict(os.environ, {"FAKE_GRAPHIFY_LOG": str(self.log), "AMAUTA_STATE_DIR": str(self.state)})
        patcher.start()
        self.addCleanup(patcher.stop)

    def calls(self, kind=None):
        if not self.log.exists():
            return []
        rows = [json.loads(line) for line in self.log.read_text().splitlines()]
        return [r for r in rows if kind is None or r["call"] == kind]

    def doc(self, rel, text="# doc\n"):
        p = self.repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        return str(p)

    def plan(self, *extra):
        code, out, err = run_main("plan", "--repo", str(self.repo), "--graphify-bin", str(self.fake.exe), "--skip-update", *extra)
        self.assertEqual(code, 0, err)
        return json.loads(out), json.loads((self.repo / "graphify-out" / ".gentle_semantic_plan.json").read_text())


class FindGraphifyTest(Base):
    def test_interpreter_is_read_from_the_executable_shebang(self):
        exe, python = sp.find_graphify(str(self.fake.exe))
        self.assertEqual(Path(exe), self.fake.exe)
        self.assertEqual(python, str(self.fake.python))

    def test_env_override_names_the_interpreter(self):
        with mock.patch.dict(os.environ, {"AMAUTA_GRAPHIFY_PYTHON": str(self.fake.python)}):
            _, python = sp.find_graphify(str(self.fake.exe))
        self.assertEqual(python, str(self.fake.python))

    def test_missing_graphify_is_a_clear_error(self):
        with mock.patch.dict(os.environ, {"PATH": str(Path(self.tmp.name) / "nowhere")}):
            with self.assertRaises(sp.SemanticError) as ctx:
                sp.find_graphify(None)
        self.assertIn("graphify", str(ctx.exception))

    def test_unusable_shebang_is_a_clear_error(self):
        script = Path(self.tmp.name) / "graphify"
        script.write_text("#!/usr/bin/env bash\necho hi\n")
        script.chmod(0o755)
        with self.assertRaises(sp.SemanticError):
            sp.find_graphify(str(script))


class PlanTest(Base):
    def test_chunks_group_by_directory_use_absolute_paths_and_skip_code(self):
        for i in range(7):
            self.doc(f"docs/a/n{i}.md")
        self.doc("docs/b/z.md")
        self.doc("src/app.py", "x = 1\n")
        summary, plan = self.plan("--chunk-size", "3")
        files = [f for c in plan["chunks"] for f in c["files"]]
        self.assertEqual(len(files), 8)
        self.assertEqual(files, sorted(files, key=lambda f: (str(Path(f).parent), f)), "files stay grouped by directory")
        self.assertTrue(all(Path(f).is_absolute() for f in files))
        self.assertFalse(any(f.endswith("app.py") for f in files), "code is covered by the AST pass, not the semantic one")
        self.assertEqual([len(c["files"]) for c in plan["chunks"]], [3, 3, 2], "balanced sizes, never more than --chunk-size")
        self.assertEqual(summary["chunks"], 3)
        self.assertEqual([c["num"] for c in plan["chunks"]], [1, 2, 3])
        self.assertEqual(plan["chunks"][0]["chunk_path"], str(self.repo / "graphify-out" / ".graphify_chunk_01.json"))

    def test_spec_is_discovered_through_the_graphify_interpreter(self):
        self.doc("a.md")
        _, plan = self.plan()
        self.assertEqual(plan["spec"], str(self.fake.package / "skills/claude/references/extraction-spec.md"))
        self.assertEqual(plan["graphify_python"], str(self.fake.python))

    def test_prompt_file_is_the_spec_with_values_substituted(self):
        a, b = self.doc("docs/a.md"), self.doc("docs/b.md")
        write_graph(self.repo)
        _, plan = self.plan()
        prompt = Path(plan["chunks"][0]["prompt_file"]).read_text()
        self.assertIn(f"{a}\n{b}", prompt)
        self.assertIn("(chunk 1 of 1)", prompt)
        self.assertTrue(prompt.rstrip().endswith("your final message is saved for you."), "the Write instruction is replaced by a JSON-only reply")
        self.assertIn("exactly as it appears in FILE_LIST", prompt, "prose mentions of FILE_LIST stay verbatim")
        self.assertIn("schema_users", prompt, "known AST ids are offered as link targets")
        self.assertIn("schema_orders", prompt)
        self.assertNotIn("```", prompt)

    def test_deep_mode_is_stated_in_the_prompt_and_the_cache_namespace(self):
        self.doc("a.md")
        _, plan = self.plan("--deep")
        self.assertIn("--mode deep WAS given", Path(plan["chunks"][0]["prompt_file"]).read_text())
        self.assertEqual(self.calls("check")[-1]["mode"], "deep")
        self.assertTrue(plan["deep"])

    def test_cache_check_receives_the_spec_and_cached_files_are_not_chunked(self):
        cached, fresh = self.doc("docs/cached.md"), self.doc("docs/fresh.md")
        (self.repo / "graphify-out").mkdir()
        (self.repo / "graphify-out" / "fake_cache.json").write_text(json.dumps({cached: {"nodes": [node("c1", "document", cached)], "edges": [], "hyperedges": []}}))
        summary, plan = self.plan()
        self.assertEqual([f for c in plan["chunks"] for f in c["files"]], [fresh])
        self.assertEqual(self.calls("check")[-1]["prompt_file"], plan["spec"])
        self.assertEqual(summary["cached_files"], 1)
        saved = json.loads((self.repo / "graphify-out" / ".gentle_semantic_cached.json").read_text())
        self.assertEqual([n["id"] for n in saved["nodes"]], ["c1"])

    def test_nothing_to_extract_yields_no_chunks(self):
        self.doc("src/app.py", "x = 1\n")
        summary, plan = self.plan()
        self.assertEqual(plan["chunks"], [])
        self.assertEqual(summary["chunks"], 0)

    def test_update_runs_unless_skipped(self):
        self.doc("a.md")
        code, _, err = run_main("plan", "--repo", str(self.repo), "--graphify-bin", str(self.fake.exe))
        self.assertEqual(code, 0, err)
        self.assertEqual(self.calls("exe")[0]["argv"], ["update", str(self.repo)])
        self.assertEqual(len(self.calls("exe")), 1)

    def test_python_runs_isolated_from_the_environment(self):
        # A poisoned PYTHONPATH that shadows `graphify` must not reach graphify's interpreter (-I).
        evil = Path(self.tmp.name) / "evil" / "graphify"
        evil.mkdir(parents=True)
        (evil / "__init__.py").write_text("raise SystemExit('poisoned')")
        self.doc("a.md")
        with mock.patch.dict(os.environ, {"PYTHONPATH": str(evil.parent)}):
            self.plan()


class ValidateTest(Base):
    def setUp(self):
        super().setUp()
        write_graph(self.repo)
        self.doc("docs/architecture.md")

    def place(self, data, num=1, raw=None):
        p = self.repo / "graphify-out" / f".graphify_chunk_{num:02d}.json"
        p.write_text(raw if raw is not None else json.dumps(data))
        return p

    def plan_for(self, count=1):
        for i in range(count - 1):
            self.doc(f"docs/extra{i}.md")
        return self.plan("--chunk-size", "1" if count > 1 else "25")

    def validate(self):
        code, out, err = run_main("validate", "--repo", str(self.repo))
        return code, json.loads(out), err

    def test_real_chunk_is_valid(self):
        self.plan_for()
        self.place(good_chunk())
        code, report, _ = self.validate()
        self.assertEqual(code, 0)
        self.assertTrue(report["chunks"][0]["valid"], report)
        self.assertEqual((report["chunks"][0]["nodes"], report["chunks"][0]["edges"], report["chunks"][0]["hyperedges"]), (12, 14, 1))

    def mutate(self, fn):
        data = good_chunk()
        fn(data)
        self.plan_for()
        self.place(data)
        code, report, _ = self.validate()
        return code, report["chunks"][0]

    def test_rejects_bad_file_type(self):
        code, chunk = self.mutate(lambda d: d["nodes"][0].update(file_type="markdown"))
        self.assertFalse(chunk["valid"])
        self.assertIn("file_type", " ".join(chunk["errors"]))
        self.assertEqual(code, 3, "no valid chunk at all")

    def test_rejects_bad_id(self):
        _, chunk = self.mutate(lambda d: d["nodes"][0].update(id="Docs.Architecture/x"))
        self.assertFalse(chunk["valid"])

    def test_rejects_dangling_edge(self):
        _, chunk = self.mutate(lambda d: d["edges"][0].update(target="nowhere_at_all"))
        self.assertFalse(chunk["valid"])
        self.assertIn("nowhere_at_all", " ".join(chunk["errors"]))

    def test_edges_to_ast_ids_are_known(self):
        _, chunk = self.mutate(lambda d: None)
        self.assertTrue(chunk["valid"], chunk)  # fixture edges point at schema_users / schema_orders from graph.json

    def test_rejects_extracted_edge_below_one(self):
        def fn(d):
            d["edges"][0].update(confidence="EXTRACTED", confidence_score=0.9)
        _, chunk = self.mutate(fn)
        self.assertFalse(chunk["valid"])

    def test_rejects_half_confidence_default(self):
        def fn(d):
            d["edges"][0].update(confidence="INFERRED", confidence_score=0.5)
        _, chunk = self.mutate(fn)
        self.assertFalse(chunk["valid"])

    def test_rejects_missing_score(self):
        _, chunk = self.mutate(lambda d: d["edges"][0].pop("confidence_score"))
        self.assertFalse(chunk["valid"])

    def test_rejects_hyperedge_with_unknown_member(self):
        _, chunk = self.mutate(lambda d: d["hyperedges"][0]["nodes"].append("ghost_node"))
        self.assertFalse(chunk["valid"])

    def test_missing_and_malformed_files_are_reported_not_raised(self):
        self.plan_for(2)
        self.place(None, 2, raw="{not json")
        code, report, _ = self.validate()
        self.assertEqual(code, 3)
        by_num = {c["num"]: c for c in report["chunks"]}
        self.assertIn("missing", by_num[1]["errors"][0])
        self.assertIn("JSON", by_num[2]["errors"][0])

    def test_partial_validity_is_exit_zero(self):
        self.plan_for(2)
        self.place(good_chunk(), 1)
        self.place(None, 2, raw="[]")
        code, report, _ = self.validate()
        self.assertEqual(code, 0)
        self.assertEqual([c["valid"] for c in report["chunks"]], [True, False])

    def test_edges_may_reference_nodes_of_another_chunk(self):
        self.plan_for(2)
        a = {"nodes": [{"id": "alpha", "label": "A", "file_type": "concept", "source_file": "x.md"}], "edges": [
            {"source": "alpha", "target": "beta", "relation": "references", "confidence": "INFERRED", "confidence_score": 0.85}], "hyperedges": []}
        b = {"nodes": [{"id": "beta", "label": "B", "file_type": "concept", "source_file": "y.md"}], "edges": [], "hyperedges": []}
        self.place(a, 1)
        self.place(b, 2)
        code, report, _ = self.validate()
        self.assertEqual(code, 0)
        self.assertTrue(all(c["valid"] for c in report["chunks"]), report)


class MergeTest(Base):
    def setUp(self):
        super().setUp()
        write_graph(self.repo, nodes=[node("schema_users"), node("schema_orders"), node("docs_architecture", "document", "docs/architecture.md")],
                    links=[{"source": "docs_architecture", "target": "schema_users", "relation": "contains", "_origin": "ast"}])
        self.doc("docs/architecture.md")
        self.plan()
        self.chunk_path = self.repo / "graphify-out" / ".graphify_chunk_01.json"

    def place(self, data):
        self.chunk_path.write_text(json.dumps(data))

    def merge(self, *extra):
        code, out, err = run_main("merge", "--repo", str(self.repo), "--graphify-bin", str(self.fake.exe), *extra)
        return code, (json.loads(out) if out.strip() else {}), err

    def graph(self):
        return json.loads((self.repo / "graphify-out" / "graph.json").read_text())

    def test_merge_grows_the_graph_and_stamps_origin(self):
        self.place(good_chunk())
        code, report, err = self.merge("--no-sync")
        self.assertEqual(code, 0, err)
        g = self.graph()
        self.assertEqual((report["nodes_before"], report["nodes_after"]), (3, 15))
        self.assertEqual(len(g["nodes"]), 15)
        self.assertEqual(len(g["links"]), 15)  # 1 AST + 14 semantic
        origins = {n["id"]: n["_origin"] for n in g["nodes"]}
        self.assertEqual(origins["schema_users"], "ast")
        self.assertEqual(origins["docs_architecture_postgresql"], "semantic")
        self.assertEqual(len(g["hyperedges"]), 1)
        self.assertEqual(self.calls("build")[0]["root"], str(self.repo))

    def test_ast_node_wins_an_id_collision(self):
        data = good_chunk()
        data["nodes"].append({"id": "schema_users", "label": "SEMANTIC USERS", "file_type": "concept", "source_file": "x.md"})
        self.place(data)
        self.assertEqual(self.merge("--no-sync")[0], 0)
        users = [n for n in self.graph()["nodes"] if n["id"] == "schema_users"]
        self.assertEqual(len(users), 1)
        self.assertEqual(users[0]["_origin"], "ast")

    def test_invalid_chunk_is_skipped_with_a_warning(self):
        bad = good_chunk()
        bad["nodes"][0]["file_type"] = "markdown"
        self.place(bad)
        code, report, err = self.merge("--no-sync")
        self.assertEqual(code, 3)
        self.assertEqual(report["nodes_after"], report["nodes_before"])
        self.assertIn("skipping chunk 1", err)
        self.assertEqual(len(self.graph()["nodes"]), 3, "graph.json untouched")

    def test_cached_semantic_results_are_merged_too(self):
        cached = self.repo / "graphify-out" / ".gentle_semantic_cached.json"
        cached.write_text(json.dumps({"nodes": [{"id": "cached_one", "label": "C", "file_type": "concept", "source_file": "c.md"}], "edges": [], "hyperedges": []}))
        self.place(good_chunk())
        self.assertEqual(self.merge("--no-sync")[0], 0)
        self.assertIn("cached_one", {n["id"] for n in self.graph()["nodes"]})

    def test_shrink_guard_is_honoured_and_nothing_else_happens(self):
        self.place(good_chunk())
        before = (self.repo / "graphify-out" / "graph.json").read_text()
        # Make the existing graph larger than what the merge can rebuild: the fake guard refuses when existing > new.
        big = json.loads(before)
        big["nodes"] += [node(f"extra_{i}") for i in range(40)]
        (self.repo / "graphify-out" / "graph.json").write_text(json.dumps(big))
        # The merge keeps every existing node, so force a loss by dropping the AST nodes from the extraction input.
        with mock.patch.object(sp, "load_existing", return_value=({"nodes": [node("schema_users"), node("schema_orders")], "edges": [], "hyperedges": []}, 41)):
            code, report, err = self.merge()
        self.assertEqual(code, 4)
        self.assertFalse(report["written"])
        self.assertEqual(len(self.graph()["nodes"]), 43, "never clobbers a larger graph")
        self.assertEqual(self.calls("save"), [], "no cache save after a refused write")
        self.assertFalse((self.state / "memory.db").exists(), "no sync after a refused write")
        self.assertNotIn(True, [c["force"] for c in self.calls("to_json")])

    def test_cache_is_saved_with_the_planned_files_only(self):
        self.place(good_chunk())
        self.assertEqual(self.merge("--no-sync")[0], 0)
        save = self.calls("save")[0]
        self.assertEqual(save["allowed"], [str(self.repo / "docs" / "architecture.md")])
        self.assertEqual((save["nodes"], save["prompt_file"]), (12, str(self.fake.package / "skills/claude/references/extraction-spec.md")))

    def test_sync_clears_pending_and_records_the_model(self):
        self.place(good_chunk())
        code, report, err = self.merge("--semantic-model", "claude-haiku-5-5")
        self.assertEqual(code, 0, err)
        self.assertTrue(report["synced"])
        conn = sqlite3.connect(self.state / "memory.db")
        try:
            row = conn.execute("SELECT nodes, edges, semantic_pending, semantic_model FROM graph_sync WHERE repo = ?", (str(self.repo),)).fetchone()
        finally:
            conn.close()
        self.assertEqual(row, (15, 15, 0, "claude-haiku-5-5"))


@unittest.skipUnless(shutil.which("graphify"), "graphify is not on PATH")
class RealGraphifyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name).resolve() / "repo"
        (self.repo / "docs").mkdir(parents=True)
        for name, text in (("architecture", "# Architecture\n\nOrders live in PostgreSQL.\n"), ("auth", "# Auth\n\nUsers have unique emails.\n"), ("billing", "# Billing\n\nInvoices read orders.\n")):
            (self.repo / "docs" / f"{name}.md").write_text(text)
        (self.repo / "schema.sql").write_text("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE);\nCREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total INTEGER);\n")
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.state = Path(self.tmp.name) / "state"
        patcher = mock.patch.dict(os.environ, {"AMAUTA_STATE_DIR": str(self.state), "GRAPHIFY_QUERY_LOG_DISABLE": "1"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_plan_validate_merge_against_the_installed_graphify(self):
        code, out, err = run_main("plan", "--repo", str(self.repo))
        self.assertEqual(code, 0, err)
        plan = json.loads((self.repo / "graphify-out" / ".gentle_semantic_plan.json").read_text())
        self.assertEqual(len(plan["chunks"]), 1)
        self.assertEqual(len(plan["chunks"][0]["files"]), 3)
        self.assertTrue(Path(plan["spec"]).is_file())
        before = len(json.loads((self.repo / "graphify-out" / "graph.json").read_text())["nodes"])
        chunk = FIXTURE.read_text().replace(FIXTURE_PREFIX, str(self.repo))
        Path(plan["chunks"][0]["chunk_path"]).write_text(chunk)
        code, out, err = run_main("validate", "--repo", str(self.repo))
        self.assertEqual(code, 0, err)
        self.assertTrue(json.loads(out)["chunks"][0]["valid"], out)
        code, out, err = run_main("merge", "--repo", str(self.repo), "--semantic-model", "claude-haiku-5-5")
        self.assertEqual(code, 0, err)
        report = json.loads(out)
        self.assertTrue(report["written"] and report["synced"], report)
        graph = json.loads((self.repo / "graphify-out" / "graph.json").read_text())
        self.assertGreater(len(graph["nodes"]), before)
        self.assertGreater(len(graph["links"]), report["edges_before"])
        # Second plan: the cache now serves all three documents.
        code, out, err = run_main("plan", "--repo", str(self.repo), "--skip-update")
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out)["chunks"], 0)
        # The shrink refusal itself is not provable against real graphify (merge feeds the existing nodes back in, so it
        # cannot rebuild fewer); it is covered with the fake guard in test_shrink_guard_is_honoured_and_nothing_else_happens.


class FixtureHygieneTest(unittest.TestCase):
    def test_committed_fixtures_hold_no_machine_specific_paths(self):
        # The real chunk fixture uses a placeholder root that tests rewrite; no usernames, session ids or scratch dirs.
        bad = []
        for f in sorted((Path(__file__).parent / "fixtures").glob("*")):
            text = f.read_text(encoding="utf-8")
            for needle in ("/home/", "/tmp/", "/Users/", "claude-"):
                if needle in text:
                    bad.append(f"{f.name}: {needle}")
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
