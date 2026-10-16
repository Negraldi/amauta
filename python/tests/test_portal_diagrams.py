import hashlib
import json
import re
import tempfile
import unittest
from pathlib import Path

from python.amauta.portal import api, diagrams
from python.amauta.portal.config import Config
from python.tests import portal_fixtures as fx
from python.tests.test_portal import ApiBase
from python.tests.test_portal_server import ServerBase

ROOT = Path(__file__).resolve().parents[2]
HOSTILE = [
    'x"]\n  click n0 call alert(1)\n  n9["y',
    "<img src=x onerror=alert(1)>",
    "`back` [a] (b) {c} | d ; e # f % g & h \\ i",
    "end", "graph TD", "%% comment", "a --> b", ":::cls", "line1\r\nline2\tline3\x00\x1b[31m",
]


def body_lines(src):
    return src.split("\n")[1:]


class LabelTest(unittest.TestCase):
    def test_label_is_one_quoted_line_without_structural_characters(self):
        for text in HOSTILE:
            lab = diagrams.label(text)
            self.assertTrue(lab.startswith('"') and lab.endswith('"'), lab)
            inner = lab[1:-1]
            for bad in ('"', "\n", "\r", "<", ">", "`", "[", "]", "(", ")", "{", "}", "|", "\\", "\x00", "\x1b"):
                self.assertNotIn(bad, inner, f"{bad!r} survived in {lab!r}")
            self.assertEqual(inner.count(";"), len(re.findall(r"#\w+;", inner)), "a bare ';' survived")

    def test_label_truncates_and_marks_it(self):
        lab = diagrams.label("a" * 500, limit=20)
        self.assertLessEqual(len(lab), 20 + 4)
        self.assertIn("...", lab)

    def test_label_escapes_hash_first_so_entities_cannot_be_forged(self):
        self.assertEqual(diagrams.label("#quot;"), '"#35;quot#59;"')


class ArchitectureTest(unittest.TestCase):
    HS = {"installed": True, "version": "0.1.0", "persona": "neutral", "rdd_mode": "on", "skills": 15, "agents": 12,
          "hooks": [{"event": "Stop", "kind": "usage"}, {"event": "Stop", "kind": "other"}, {"event": "SessionStart", "kind": "review-stop"}],
          "mcp_servers": [{"name": "amauta-memory", "type": "stdio", "command": "python3"}]}

    def test_architecture_shows_hooks_servers_counts_and_state_dir(self):
        src = diagrams.architecture(self.HS, "/home/u/.amauta")
        self.assertTrue(src.startswith("flowchart "))
        for needle in ("Stop", "SessionStart", "usage", "review-stop", "amauta-memory", "15 skills", "12 agents", "/home/u/.amauta", "0.1.0"):
            self.assertIn(needle, src)

    def test_not_installed_gives_none(self):
        self.assertIsNone(diagrams.architecture({"installed": False, "hooks": [], "mcp_servers": []}, "/x"))

    def test_hostile_names_never_break_out_of_their_node(self):
        hs = {**self.HS, "version": HOSTILE[0], "mcp_servers": [{"name": t, "type": HOSTILE[1], "command": "x"} for t in HOSTILE],
              "hooks": [{"event": t, "kind": "other"} for t in HOSTILE]}
        src = diagrams.architecture(hs, HOSTILE[2])
        self.assertNotIn("alert(1)\n", src)
        self.assertNotIn("<img", src)
        for line in body_lines(src):
            self.assertFalse(re.match(r"\s*click\b", line), line)
        ids = re.findall(r"^\s*(n\d+)\[", src, re.M)
        self.assertEqual(len(ids), len(set(ids)))

    def test_caps_events_and_servers(self):
        hs = {**self.HS, "hooks": [{"event": f"E{i}", "kind": "other"} for i in range(100)],
              "mcp_servers": [{"name": f"s{i}", "type": "stdio", "command": "c"} for i in range(100)]}
        src = diagrams.architecture(hs, "/s")
        self.assertLessEqual(len(re.findall(r"^\s*n\d+\[", src, re.M)), 2 * diagrams.MAX_ITEMS + 8)
        self.assertIn("more", src)


class OddTest(unittest.TestCase):
    @staticmethod
    def tasks(n, phases=1, **extra):
        return [{"done": i % 3 == 0, "blocked": False, "phase": f"F{i * phases // max(n, 1)} Phase {i * phases // max(n, 1)}" if phases > 1 else None,
                 "title": f"T{i} Thing {i}", **extra} for i in range(n)]

    def test_status_by_shape_label_and_class_not_color_alone(self):
        tasks = [{"done": True, "title": "T1 Done thing"}, {"done": False, "title": "T2 Open thing"},
                 {"done": False, "blocked": True, "title": "T3 Stuck thing"}, {"done": True, "title": "plain title without id"}]
        src = diagrams.odd_progress("feat.md", tasks)
        self.assertTrue(src.startswith("flowchart TB"))
        self.assertIn("2/4", src)
        self.assertRegex(src, r'n\d+\(\["T1 [^"]*done[^"]*"\]\)')      # done: stadium + word
        self.assertRegex(src, r'n\d+\["T2 [^"]*pending[^"]*"\]')         # pending: rectangle + word
        self.assertRegex(src, r'n\d+\{\{"T3 [^"]*blocked[^"]*"\}\}')    # blocked: hexagon + word
        for cls in ("done", "pending", "blocked"):
            self.assertRegex(src, rf"class n\d+(,n\d+)* {cls}")
        self.assertNotIn("Open thing", src)  # only the task id is drawn

    def test_no_single_fan_out_node(self):
        src = diagrams.odd_progress("feat.md", self.tasks(34))
        self.assertNotRegex(src, r"\bn\d+ -->")
        self.assertNotIn("-->", src)

    def test_one_subgraph_per_phase_in_a_grid_of_rows(self):
        src = diagrams.odd_progress("feat.md", self.tasks(34, phases=3))
        self.assertEqual(len(re.findall(r"^\s*subgraph p\d+\[", src, re.M)), 3)
        self.assertIn("F0 Phase 0", src)
        self.assertEqual(src.count("direction LR"), 3)
        self.assertGreaterEqual(len(re.findall(r"~~~", src)), 20)  # invisible links build the rows
        rows = [len(m.split("~~~")) for m in re.findall(r"^\s*(n\d+(?: ~~~ n\d+)+)\s*$", src, re.M)]
        self.assertTrue(rows and max(rows) <= diagrams.GRID_COLUMNS)

    def test_a_document_without_phases_is_a_single_group_of_rows(self):
        src = diagrams.odd_progress("feat.md", self.tasks(34))
        self.assertEqual(len(re.findall(r"^\s*subgraph ", src, re.M)), 1)
        self.assertEqual(len(re.findall(r"^\s*n\d+[\[({]", src, re.M)), 34)

    def test_sizes_0_1_34_200(self):
        self.assertIsNone(diagrams.odd_progress("x.md", []))
        one = diagrams.odd_progress("x.md", self.tasks(1))
        self.assertEqual(len(re.findall(r"^\s*n\d+[\[({]", one, re.M)), 1)
        self.assertNotIn("more", one)
        big = diagrams.odd_progress("x.md", self.tasks(34, phases=4))
        self.assertEqual(len(re.findall(r"^\s*n\d+[\[({]", big, re.M)), 34)
        huge = diagrams.odd_progress("x.md", self.tasks(200, phases=8))
        self.assertLessEqual(len(re.findall(r"^\s*n\d+[\[({]", huge, re.M)), diagrams.MAX_TASKS + 1)
        self.assertIn(f"{200 - diagrams.MAX_TASKS} more", huge)
        self.assertLessEqual(len(huge.splitlines()), 8 * diagrams.MAX_TASKS)

    def test_hostile_titles_phases_and_names(self):
        tasks = [{"done": i % 2 == 0, "blocked": i % 5 == 0, "phase": HOSTILE[i % len(HOSTILE)], "title": HOSTILE[(i + 3) % len(HOSTILE)]} for i in range(60)]
        src = diagrams.odd_progress(HOSTILE[0], tasks)
        self.assertNotIn("alert(1)\n", src)
        self.assertNotIn("<img", src)
        for line in body_lines(src):
            self.assertFalse(re.match(r"\s*click\b", line), line)
        self.assertEqual(len(re.findall(r"^\s*end\s*$", src, re.M)), len(re.findall(r"^\s*subgraph ", src, re.M)))
        ids = re.findall(r"^\s*(n\d+)[\[({]", src, re.M)
        self.assertEqual(len(ids), len(set(ids)))

    def test_syntax_characters_become_spaces_not_entity_codes_in_the_grid(self):
        src = diagrams.odd_progress("a`b.md", [{"done": True, "title": "`code` [x] (y)", "phase": "P `1` <b>"}, {"done": False, "title": "W2 ok", "phase": "P2"}])
        self.assertNotRegex(src, r"#\d+;")
        self.assertIn("W2 ○ pending", src)

    def test_old_tuple_free_task_dicts_still_work(self):
        src = diagrams.odd_progress("x.md", [{"done": True, "title": "T1"}])
        self.assertIn("1/1", src)


class GraphTest(unittest.TestCase):
    def g(self, n=3, edges=None):
        nodes = [{"id": f"id{i}", "label": f"L{i}", "kind": "function", "file": "f.py", "depth": 0 if i == 0 else 1} for i in range(n)]
        return {"start": ["id0"], "nodes": nodes, "edges": edges if edges is not None else [{"src": "id0", "dst": f"id{i}", "relation": "calls"} for i in range(1, n)]}

    def test_neighbors_become_edges_with_relations(self):
        src = diagrams.graph_neighborhood(self.g())
        self.assertTrue(src.startswith("flowchart "))
        self.assertIn("L0", src)
        self.assertEqual(len(re.findall(r"-->\|", src)), 2)
        self.assertIn("calls", src)
        self.assertRegex(src, r"class n0 start")

    def test_caps_nodes_and_edges_and_drops_dangling_edges(self):
        g = self.g(120)
        g["edges"].append({"src": "id0", "dst": "ghost", "relation": "calls"})
        src = diagrams.graph_neighborhood(g)
        self.assertLessEqual(len(re.findall(r"^\s*n\d+\[", src, re.M)), diagrams.MAX_GRAPH_NODES + 1)
        self.assertLessEqual(len(re.findall(r"-->", src)), diagrams.MAX_GRAPH_EDGES)
        self.assertNotIn("ghost", src)

    def test_hostile_labels_and_relations(self):
        nodes = [{"id": f"i{i}", "label": t, "kind": HOSTILE[1], "file": HOSTILE[2], "depth": 0} for i, t in enumerate(HOSTILE)]
        edges = [{"src": "i0", "dst": f"i{i}", "relation": t} for i, t in enumerate(HOSTILE)]
        src = diagrams.graph_neighborhood({"start": ["i0"], "nodes": nodes, "edges": edges})
        self.assertNotIn("alert(1)\n", src)
        self.assertNotIn("<img", src)
        for line in body_lines(src):
            self.assertFalse(re.match(r"\s*click\b", line), line)

    def test_no_nodes_gives_none(self):
        self.assertIsNone(diagrams.graph_neighborhood({"start": [], "nodes": [], "edges": []}))


class DiagramEndpointsTest(ApiBase):
    def test_diagrams_endpoint(self):
        d = self.get("/api/diagrams")
        self.assertIn("Stop", d["architecture"])
        self.assertIn("flowchart", d["architecture"])
        self.assertEqual(d["odd"][0]["document"], "feat.md")
        self.assertEqual((d["odd"][0]["done"], d["odd"][0]["total"]), (2, 3))
        self.assertIn("T2", d["odd"][0]["source"])
        self.assertNotIn("SECRET-USER-HOOK", json.dumps(d))

    def test_diagrams_not_installed(self):
        p = api.Portal(Config(state_dir=self.root / "none", claude_home=self.root / "none"))
        status, body = p.get("/api/diagrams", {})
        self.assertEqual(status, 200)
        self.assertIsNone(body["architecture"])
        self.assertEqual(body["odd"], [])

    def test_harness_reports_skill_and_agent_counts_from_managed_files(self):
        state = json.loads((self.f["state"] / "state.json").read_text())
        state["managed_files"] = {"skills/a/SKILL.md": "h", "skills/a/ref.md": "h", "skills/b/SKILL.md": "h", "agents/x.md": "h", "CLAUDE.md": "h"}
        (self.f["state"] / "state.json").write_text(json.dumps(state))
        h = self.get("/api/harness")
        self.assertEqual((h["skills"], h["agents"]), (2, 1))

    def test_graph_diagram_endpoint(self):
        key = str(self.f["repo"].resolve())
        g = self.get("/api/graph/diagram", repo=key, node="a")
        self.assertTrue(g["available"])
        self.assertTrue(g["source"].startswith("flowchart "))

    def test_graph_diagram_validates_like_neighbors(self):
        status, body = self.portal.get("/api/graph/diagram", {"repo": "/not/configured", "node": "a"})
        self.assertEqual(status, 400)
        key = str(self.f["repo"].resolve())
        status, body = self.portal.get("/api/graph/diagram", {"repo": key})
        self.assertEqual(status, 400)


class StaticMermaidTest(ServerBase):
    def test_mermaid_is_served_with_javascript_type_and_same_headers(self):
        status, headers, data = self.request("GET", "/static/mermaid.min.js")
        self.assertEqual(status, 200)
        self.assertTrue(headers["content-type"].startswith("text/javascript"))
        self.assertEqual(headers["x-content-type-options"], "nosniff")
        self.assertIn("default-src 'none'", headers["content-security-policy"])
        manifest = json.loads((ROOT / "assets" / "manifest.json").read_text())["vendored"]["mermaid"]
        self.assertEqual(hashlib.sha256(data).hexdigest(), manifest["sha256"])

    def test_csp_allows_no_remote_origin_and_no_unsafe_eval(self):
        _, headers, _ = self.request("GET", "/static/app.js")
        csp = headers["content-security-policy"]
        self.assertNotIn("unsafe-eval", csp)
        self.assertNotRegex(csp, r"https?:")
        self.assertIn("script-src 'self'", csp)

    def test_diagram_endpoints_are_json_through_the_server(self):
        status, headers, data = self.request("GET", "/api/diagrams")
        self.assertEqual(status, 200)
        self.assertIn("architecture", json.loads(data))
