import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from python.amauta.portal import archify, server
from python.tests.test_portal import ApiBase
from python.tests.test_portal_server import ServerBase

NODE = shutil.which("node")
HOSTILE = ['"><img src=x onerror=alert(1)>', "a\nb\x00c\x1b[31m", "</script><script>alert(1)</script>", "x" * 500, "é漢字 `tick` {brace} [b]"]
HS = {"installed": True, "version": "0.1.0", "persona": "neutral", "rdd_mode": "on", "skills": 22, "agents": 14,
      "hooks": [{"event": "Stop", "kind": "usage"}, {"event": "Stop", "kind": "review-stop"}, {"event": "SessionStart", "kind": "skill-registry"}],
      "mcp_servers": [{"name": "amauta", "type": "stdio", "command": "python3"}, {"name": "rea", "type": "http", "command": None}]}
STORES = [{"label": "memory.db", "detail": "memories"}, {"label": "telemetry", "detail": "events"}]

# A fake archify: writes a page that records how it was called. argv: validate|render architecture in.json [out.html].
FAKE = """import fs from 'node:fs';
const [cmd, , input, out] = process.argv.slice(2);
const here = new URL('.', 'file://' + process.argv[1]).pathname;
const mode = fs.existsSync(here + 'mode') ? fs.readFileSync(here + 'mode', 'utf8') : '';
fs.appendFileSync(here + 'log', JSON.stringify({ cmd, update: process.env.ARCHIFY_UPDATE_CHECK_DISABLED, keys: Object.keys(process.env).sort(), cwd: process.cwd() }) + '\\n');
if (mode === 'invalid' && cmd === 'validate') { console.log('{"ok":false,"error":"bad layout"}'); process.exit(1); }
if (mode === 'crash' && cmd === 'render') { console.error('boom'); process.exit(2); }
if (mode === 'hang') { setTimeout(() => {}, 60000); }
else if (cmd === 'validate') console.log('{"ok":true}');
else fs.writeFileSync(out, '<!doctype html><title>fake</title><svg></svg>');
"""


class BuildTest(unittest.TestCase):
    def test_build_shows_hooks_per_event_servers_counts_and_stores_and_passes_the_structural_check(self):
        ir = archify.build(HS, STORES)
        self.assertEqual(archify.check(ir), [])
        labels = {c["label"] for c in ir["components"]}
        for want in ("amauta 0.1.0", "Stop", "SessionStart", "amauta", "rea", "22 skills", "14 agents", "memory.db", "telemetry"):
            self.assertIn(want, labels)
        stop = next(c for c in ir["components"] if c["label"] == "Stop")
        self.assertEqual(stop["sublabel"], "review-stop, usage")
        self.assertEqual(ir["diagram_type"], "architecture")
        self.assertEqual(ir["layout"]["mode"], "grid")

    def test_not_installed_gives_none(self):
        self.assertIsNone(archify.build({"installed": False}, []))

    def test_ids_are_generated_never_taken_from_data(self):
        ir = archify.build({**HS, "mcp_servers": [{"name": t, "type": t} for t in HOSTILE], "hooks": [{"event": t, "kind": t} for t in HOSTILE]}, [])
        self.assertEqual(archify.check(ir), [])
        for c in ir["components"]:
            self.assertRegex(c["id"], r"^c\d+$")

    def test_labels_are_one_line_capped_and_free_of_control_characters(self):
        ir = archify.build({**HS, "persona": HOSTILE[1], "version": HOSTILE[3], "mcp_servers": [{"name": t, "type": t} for t in HOSTILE]}, [{"label": HOSTILE[3], "detail": HOSTILE[1]}])
        for c in ir["components"]:
            for k in ("label", "sublabel", "tag"):
                v = c.get(k, "")
                self.assertNotRegex(v, r"[\x00-\x1f\x7f]")
                self.assertLessEqual(len(v), 36)
        self.assertEqual(json.loads(json.dumps(ir)), ir)

    def test_caps_events_and_servers_with_a_more_node(self):
        hs = {**HS, "hooks": [{"event": f"E{i:03}", "kind": "other"} for i in range(50)], "mcp_servers": [{"name": f"s{i}", "type": "stdio"} for i in range(50)]}
        ir = archify.build(hs, [])
        self.assertEqual(archify.check(ir), [])
        self.assertLessEqual(len(ir["components"]), 1 + 2 + (archify.MAX_EVENTS + 1) + (archify.MAX_SERVERS + 1))
        self.assertIn(f"{50 - archify.MAX_EVENTS} more events", {c["label"] for c in ir["components"]})
        self.assertIn(f"{50 - archify.MAX_SERVERS} more servers", {c["label"] for c in ir["components"]})

    def groups(self, ir):
        return [set(b["wraps"]) for b in ir["boundaries"]]

    def test_layout_has_no_fan_out_every_group_is_reached_by_one_connection(self):
        hs = {**HS, "hooks": [{"event": f"E{i}", "kind": "other"} for i in range(8)], "mcp_servers": [{"name": f"s{i}", "type": "stdio"} for i in range(8)]}
        ir = archify.build(hs, STORES)
        self.assertEqual(archify.check(ir), [])
        core = ir["components"][0]["id"]
        degree = {}
        for c in ir["connections"]:
            for end in (c["from"], c["to"]):
                degree[end] = degree.get(end, 0) + 1
        self.assertLessEqual(degree[core], 4, "the hub keeps one line per group")
        self.assertTrue(all(d == 1 for cid, d in degree.items() if cid != core))
        self.assertEqual(len(ir["boundaries"]), 4)
        grouped = set().union(*self.groups(ir))
        self.assertEqual(grouped, {c["id"] for c in ir["components"]} - {core}, "every non-hub component sits inside exactly one labelled group")
        self.assertEqual(sum(len(g) for g in self.groups(ir)), len(grouped))

    def test_hub_is_centered_on_the_hook_and_server_groups_so_those_lines_are_straight(self):
        hs = {**HS, "hooks": [{"event": f"E{i}", "kind": "other"} for i in range(5)], "mcp_servers": [{"name": f"s{i}", "type": "stdio"} for i in range(3)]}
        ir = archify.build(hs, STORES)
        pos = {c["id"]: (c["row"], c["col"]) for c in ir["components"]}
        core = ir["components"][0]["id"]
        by_target = {c["to"]: c for c in ir["connections"]}
        for k in ir["connections"]:
            if k["from"] == core and pos[k["to"]][0] != pos[core][0]:
                self.assertEqual(pos[k["to"]][1], pos[core][1], "vertical connections are straight")

    def test_no_two_components_share_a_cell_and_no_line_crosses_a_node_in_its_row(self):
        for n_hooks, n_servers in ((1, 1), (3, 2), (8, 8), (50, 50)):
            hs = {**HS, "hooks": [{"event": f"E{i:02}", "kind": "other"} for i in range(n_hooks)], "mcp_servers": [{"name": f"s{i}", "type": "stdio"} for i in range(n_servers)]}
            ir = archify.build(hs, STORES)
            cells = [(c["row"], c["col"]) for c in ir["components"]]
            self.assertEqual(len(cells), len(set(cells)), (n_hooks, n_servers))
            pos = {c["id"]: (c["row"], c["col"]) for c in ir["components"]}
            for k in ir["connections"]:
                (r1, c1), (r2, c2) = pos[k["from"]], pos[k["to"]]
                if r1 == r2:
                    between = [p for p in cells if p[0] == r1 and min(c1, c2) < p[1] < max(c1, c2)]
                    self.assertEqual(between, [], f"{k['id']} passes through a node")
            self.assertTrue(all(c["col"] < ir["layout"]["cols"] for c in ir["components"]))

    def test_hook_events_follow_the_session_lifecycle_then_alphabetical(self):
        hs = {**HS, "hooks": [{"event": e, "kind": "other"} for e in ("Stop", "Zeta", "PostToolUse", "Alpha", "SessionStart", "UserPromptSubmit")]}
        ir = archify.build(hs, [])
        row0 = sorted((c for c in ir["components"] if c["row"] == 0), key=lambda c: c["col"])
        self.assertEqual([c["label"] for c in row0], ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "Alpha", "Zeta"])

    def test_without_boundaries_every_member_keeps_its_own_line_as_a_fallback(self):
        ir = archify.build(HS, STORES, boundaries=False)
        self.assertEqual(ir["boundaries"], [])
        linked = {c["to"] for c in ir["connections"]}
        self.assertEqual(linked, {c["id"] for c in ir["components"]} - {ir["components"][0]["id"]})

    def test_check_rejects_what_the_schema_rejects(self):
        ir = archify.build(HS, STORES)
        bad = json.loads(json.dumps(ir))
        bad["components"][0]["type"] = "weird"
        bad["components"][1]["id"] = "1 bad id"
        bad["connections"][0]["to"] = "ghost"
        bad["boundaries"][0]["wraps"] = ["ghost"]
        self.assertGreaterEqual(len(archify.check(bad)), 4)
        self.assertTrue(archify.check({}))
        self.assertTrue(archify.check({**ir, "components": []}))


@unittest.skipUnless(NODE, "node is not installed")
class RenderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cli = Path(self.tmp.name, "fake.mjs")
        self.cli.write_text(FAKE)
        self.log = Path(self.tmp.name, "log")
        archify._CACHE.clear()
        self.addCleanup(archify._CACHE.clear)
        self.ir = archify.build(HS, STORES)

    def env(self, FAKE_MODE="", **kw):
        Path(self.tmp.name, "mode").write_text(FAKE_MODE)
        return mock.patch.dict("os.environ", kw)

    def calls(self):
        return [json.loads(x) for x in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_renders_validates_first_and_runs_with_a_scrubbed_environment_in_a_temp_dir(self):
        with self.env(SECRET_TOKEN="hunter2"):
            key, why = archify.render(self.ir, self.cli)
        self.assertEqual(why, "")
        self.assertRegex(key, r"^[0-9a-f]{64}$")
        self.assertIn(b"<svg", archify.cached(key))
        calls = self.calls()
        self.assertEqual([c["cmd"] for c in calls], ["validate", "render"])
        for c in calls:
            self.assertEqual(c["update"], "1")
            self.assertNotIn("SECRET_TOKEN", c["keys"])
            self.assertEqual(sorted(set(c["keys"]) - {"PATH", "HOME", "ARCHIFY_UPDATE_CHECK_DISABLED"}), [])
            self.assertIn("amauta-archify-", c["cwd"])
        self.assertFalse(Path(calls[0]["cwd"]).exists(), "the temp dir is removed")

    def test_cached_by_input_hash(self):
        with self.env():
            k1, _ = archify.render(self.ir, self.cli)
            k2, _ = archify.render(json.loads(json.dumps(self.ir)), self.cli)
            other = archify.build({**HS, "skills": 99}, STORES)
            k3, _ = archify.render(other, self.cli)
        self.assertEqual(k1, k2)
        self.assertNotEqual(k1, k3)
        self.assertEqual([c["cmd"] for c in self.calls()].count("render"), 2)

    def test_cache_is_bounded(self):
        with self.env():
            for i in range(archify.CACHE_SIZE + 3):
                archify.render(archify.build({**HS, "skills": i}, STORES), self.cli)
        self.assertLessEqual(len(archify._CACHE), archify.CACHE_SIZE)

    def test_failures_degrade_to_a_reason_and_never_raise(self):
        with self.env(FAKE_MODE="invalid"):
            key, why = archify.render(self.ir, self.cli)
        self.assertIsNone(key)
        self.assertIn("validation failed: bad layout", why)
        with self.env(FAKE_MODE="crash"):
            key, why = archify.render(self.ir, self.cli)
        self.assertIsNone(key)
        self.assertIn("render failed", why)
        self.assertIsNone(archify.render(self.ir, None)[0])
        self.assertIsNone(archify.render(self.ir, Path("/nonexistent/cli.mjs"))[0])
        with mock.patch("shutil.which", return_value=None):
            self.assertIn("not available", archify.render(self.ir, self.cli)[1])
        self.assertEqual(archify._CACHE, type(archify._CACHE)())

    def test_a_hung_renderer_is_killed_by_the_timeout(self):
        with self.env(FAKE_MODE="hang"), mock.patch.object(archify, "RENDER_TIMEOUT", 1):
            key, why = archify.render(self.ir, self.cli)
        self.assertIsNone(key)
        self.assertIn("could not run", why)

    def test_an_invalid_document_never_reaches_node(self):
        bad = json.loads(json.dumps(self.ir))
        bad["components"][0]["type"] = "nope"
        with self.env():
            key, why = archify.render(bad, self.cli)
        self.assertIsNone(key)
        self.assertIn("invalid diagram", why)
        self.assertEqual(self.calls(), [])

    def test_cached_only_answers_for_a_hash_it_rendered(self):
        for bad in (None, "", "../x", "A" * 64, "g" * 64, "a" * 63, "a" * 64):
            self.assertIsNone(archify.cached(bad))


@unittest.skipUnless(NODE, "node is not installed")
class RealCliTest(unittest.TestCase):
    def test_the_vendored_cli_validates_and_renders_the_generated_json_and_escapes_hostile_labels(self):
        cli = archify.find_cli()
        self.assertIsNotNone(cli)
        archify._CACHE.clear()
        hs = {**HS, "mcp_servers": [{"name": t, "type": "stdio"} for t in HOSTILE[:3]], "hooks": [{"event": "Stop", "kind": HOSTILE[0]}]}
        key, why = archify.render(archify.build(hs, STORES), cli)
        self.assertEqual(why, "")
        html = archify.cached(key).decode()
        self.assertNotIn('<img src=x onerror', html)
        self.assertEqual(len(re.findall(r"<script[ >]", html)), len(re.findall(r"</script>", html)), "no script tag was injected through a label")
        self.assertNotRegex(html, r"https?://(?!www\.w3\.org|github\.com/(JetBrains|tt-a1i)|openfontlicense\.org)")


class PortalViewTest(ApiBase):
    def setUp(self):
        super().setUp()
        archify._CACHE.clear()
        self.addCleanup(archify._CACHE.clear)

    def test_unavailable_cli_gives_a_reason_and_the_mermaid_fallback(self):
        with mock.patch.object(archify, "find_cli", return_value=None):
            d = self.get("/api/archify")
        self.assertFalse(d["available"])
        self.assertIn("flowchart", d["fallback"])
        self.assertIn("reason", d)
        self.assertNotIn("url", d)

    @unittest.skipUnless(NODE, "node is not installed")
    def test_available_returns_a_hash_url_and_still_the_fallback(self):
        with mock.patch.object(archify, "render", return_value=("a" * 64, "")):
            d = self.get("/api/archify")
        self.assertTrue(d["available"])
        self.assertEqual(d["url"], "/archify/" + "a" * 64 + ".html")
        self.assertIn("flowchart", d["fallback"])

    def test_a_refused_layout_is_retried_once_without_region_boundaries(self):
        seen = []

        def fake(ir, cli, node=None):
            seen.append(len(ir["boundaries"]))
            return (None, "container-border-run") if len(seen) == 1 else ("c" * 64, "")
        with mock.patch.object(archify, "render", side_effect=fake), mock.patch.object(archify, "find_cli", return_value=Path("/x")):
            d = self.get("/api/archify")
        self.assertTrue(d["available"])
        self.assertGreater(seen[0], 0)
        self.assertEqual(seen[1], 0)

    def test_both_attempts_failing_reports_the_reason_and_falls_back(self):
        with mock.patch.object(archify, "render", return_value=(None, "no luck")), mock.patch.object(archify, "find_cli", return_value=Path("/x")):
            d = self.get("/api/archify")
        self.assertEqual((d["available"], d["reason"]), (False, "no luck"))
        self.assertIn("flowchart", d["fallback"])

    def test_not_installed_has_nothing_to_draw(self):
        (self.cfg.state_dir / "state.json").unlink()
        d = self.get("/api/archify")
        self.assertEqual((d["available"], d["installed"]), (False, False))


class RouteTest(ServerBase):
    def setUp(self):
        super().setUp()
        archify._CACHE.clear()
        self.addCleanup(archify._CACHE.clear)
        self.key = "b" * 64
        archify._CACHE[self.key] = b"<!doctype html><script>1</script><svg></svg>"

    def test_serves_a_rendered_page_under_its_own_sandboxing_csp(self):
        status, h, body = self.request("GET", f"/archify/{self.key}.html")
        self.assertEqual(status, 200)
        self.assertIn("text/html", h["content-type"])
        csp = h["content-security-policy"]
        self.assertIn("sandbox allow-scripts", csp)
        self.assertNotIn("allow-same-origin", csp)
        self.assertIn("default-src 'none'", csp)
        self.assertIn("connect-src 'none'", csp)
        self.assertIn("frame-ancestors 'self'", csp)
        self.assertNotIn("'self'", csp.replace("frame-ancestors 'self'", ""))  # no script, style or other loads from this origin
        self.assertIn("script-src 'unsafe-inline'", csp)
        self.assertEqual(h["x-content-type-options"], "nosniff")
        self.assertEqual(body, archify._CACHE[self.key])

    def test_unknown_or_malformed_hashes_are_404_and_nothing_is_rendered_on_request(self):
        for p in ("/archify/" + "c" * 64 + ".html", "/archify/x.html", "/archify/../static/app.js", "/archify/" + self.key, "/archify/" + self.key + ".html/x"):
            self.assertEqual(self.request("GET", p)[0], 404, p)

    def test_host_check_applies(self):
        self.assertEqual(self.request("GET", f"/archify/{self.key}.html", host="evil.example")[0], 403)

    def test_the_portal_itself_keeps_script_src_self_and_only_gains_frame_src_self(self):
        _, h, _ = self.request("GET", "/")
        csp = h["content-security-policy"]
        self.assertIn("script-src 'self';", csp)
        self.assertIn("frame-src 'self'", csp)
        self.assertNotIn("sandbox", csp)
        self.assertIn("frame-ancestors 'none'", csp)
