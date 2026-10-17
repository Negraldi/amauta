import json
import os
import subprocess
import sys
from pathlib import Path

from python.amauta.portal import wikiexplain
from python.tests.test_portal_server import ServerBase
from python.tests.test_portal_wiki_harness import HarnessBase, write

ROOT = Path(__file__).resolve().parents[2]


class ExplainBase(HarnessBase):
    def request(self, kind="agent", ident="my-agent"):
        return wikiexplain.request(self.portal, {"kind": kind, "id": ident})

    def requests_file(self):
        return self.f["state"] / "wiki" / "requests.jsonl"

    def lines(self):
        p = self.requests_file()
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []

    def notes_dir(self):
        return self.f["state"] / "wiki" / "notes"

    def cli(self, *args, input=None):
        env = {**os.environ, "PYTHONPATH": str(ROOT / "python"), "AMAUTA_STATE_DIR": str(self.f["state"]), "AMAUTA_CLAUDE_HOME": str(self.f["home"])}
        return subprocess.run([sys.executable, "-P", "-m", "amauta.portal.wikiexplain", *args, "--repo", str(self.f["repo"])], capture_output=True, text=True, env=env, cwd=self.root, input=input, timeout=60)

    def write_note_file(self, text="## What it does\n\nIt reviews things.\n"):
        p = self.root / "note.md"
        p.write_text(text)
        return str(p)


class RequestTest(ExplainBase):
    def test_a_request_is_appended_with_kind_id_time_and_the_source_hash(self):
        out = self.request()
        (line,) = self.lines()
        self.assertEqual(set(line), {"kind", "id", "requested_at", "source_hash"})
        self.assertEqual((line["kind"], line["id"]), ("agent", "my-agent"))
        self.assertRegex(line["requested_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(line["source_hash"], wikiexplain.current_hash(self.portal, "agent", "my-agent"))
        self.assertEqual((out["kind"], out["id"], out["already"]), ("agent", "my-agent", False))

    def test_a_pending_request_is_not_duplicated(self):
        self.request()
        again = self.request()
        self.assertTrue(again["already"])
        self.assertEqual(len(self.lines()), 1)
        self.request("command", "do-it")
        self.assertEqual(len(self.lines()), 2)

    def test_every_component_kind_can_be_requested_and_others_cannot(self):
        ids = {"hook": self.hook_id("Stop", "amauta usage"), "mcp": "projsrv", "agent": "my-agent", "command": "do-it", "plugin": "plug", "outputstyle": "terse", "tool": "Bash"}
        for kind, ident in ids.items():
            self.assertFalse(self.request(kind, ident)["already"], kind)
        for kind in ("skill", "memory", "session", "feature", "node", "project", "nope"):
            with self.assertRaises(wikiexplain.ExplainError) as ctx:
                self.request(kind, "x")
            self.assertEqual(ctx.exception.status, 400, kind)

    def test_unknown_components_bad_ids_and_bad_bodies_are_refused(self):
        for body, status in (({"kind": "agent", "id": "nope"}, 404), ({"kind": "agent", "id": "../../etc/passwd"}, 404), ({"kind": "agent", "id": "x" * 300}, 400), ({"kind": "agent"}, 400),
                             ({"kind": 1, "id": "a"}, 400), ({"kind": "agent", "id": 5}, 400), ({"kind": "agent", "id": "my-agent", "extra": 1}, 400), ("x", 400), ([], 400), ({"kind": "agent", "id": ""}, 400)):
            with self.assertRaises(wikiexplain.ExplainError) as ctx:
                wikiexplain.request(self.portal, body)
            self.assertEqual(ctx.exception.status, status, body)
        self.assertEqual(self.lines(), [])

    def test_the_queue_is_capped(self):
        write(self.requests_file(), "".join(json.dumps({"kind": "tool", "id": f"T{i}", "requested_at": "2026-10-01T00:00:00Z", "source_hash": "h"}) + "\n" for i in range(wikiexplain.MAX_REQUESTS)))
        with self.assertRaises(wikiexplain.ExplainError) as ctx:
            self.request()
        self.assertEqual(ctx.exception.status, 409)

    def test_malformed_lines_are_ignored_and_pending_is_deduplicated(self):
        good = {"kind": "agent", "id": "my-agent", "requested_at": "2026-10-01T00:00:00Z", "source_hash": "h"}
        write(self.requests_file(), "not json\n" + json.dumps(good) + "\n" + json.dumps(good) + "\n" + json.dumps({"kind": "skill", "id": "x"}) + "\n[1]\n" + json.dumps({"kind": "agent", "id": 3}) + "\n")
        self.assertEqual(wikiexplain.pending(self.portal), [good])

    def test_the_wiki_directory_and_files_must_not_be_links(self):
        target = self.root / "elsewhere"
        target.mkdir()
        (self.f["state"] / "wiki" / "x").parent.mkdir(parents=True, exist_ok=True)
        (self.f["state"] / "wiki" / "requests.jsonl").symlink_to(target / "r.jsonl")
        with self.assertRaises(wikiexplain.ExplainError):
            self.request()
        self.assertFalse((target / "r.jsonl").exists())


class PageTest(ExplainBase):
    def explain(self, kind="agent", ident="my-agent"):
        return self.page(kind, ident)["explain"]

    def test_a_component_page_has_an_explain_block_and_shows_pending(self):
        self.assertEqual(self.explain(), {"pending": None, "note": None})
        self.request()
        ex = self.explain()
        self.assertEqual(ex["pending"]["requested_at"], self.lines()[0]["requested_at"])
        self.assertIsNone(ex["note"])

    def test_tools_and_servers_have_it_too_and_skills_and_sessions_do_not(self):
        self.assertIn("explain", self.page("tool", "Bash"))
        self.assertIn("explain", self.page("mcp", "engram"))
        self.assertNotIn("explain", self.page("skill", "work-unit-commits"))
        self.assertNotIn("explain", self.page("session", "s1"))

    def test_a_written_note_replaces_the_request_and_renders_without_frontmatter(self):
        self.request()
        res = self.cli("write", "--kind", "agent", "--id", "my-agent", "--file", self.write_note_file())
        self.assertEqual(res.returncode, 0, res.stderr)
        ex = self.explain()
        self.assertIsNone(ex["pending"])
        self.assertEqual(ex["note"]["body_md"].strip(), "## What it does\n\nIt reviews things.")
        self.assertFalse(ex["note"]["stale"])
        self.assertRegex(ex["note"]["written_at"], r"^\d{4}-\d\d-\d\dT")

    def test_changing_the_component_makes_its_note_stale(self):
        self.cli("write", "--kind", "agent", "--id", "my-agent", "--file", self.write_note_file())
        write(self.f["home"] / "agents" / "my-agent.md", "---\nname: my-agent\ndescription: Changed\n---\nNew body\n")
        self.portal._harness_cache = None
        self.assertTrue(self.explain()["note"]["stale"])

    def test_catalog_counts_pending_requests(self):
        self.assertEqual(self.catalog()["pending"], 0)
        self.request()
        self.request("tool", "Bash")
        self.assertEqual(self.catalog()["pending"], 2)


class CliTest(ExplainBase):
    def test_list_returns_pending_requests_with_the_source_material(self):
        self.request()
        res = self.cli("list")
        self.assertEqual(res.returncode, 0, res.stderr)
        out = json.loads(res.stdout)
        (item,) = out["pending"]
        self.assertEqual((item["kind"], item["id"]), ("agent", "my-agent"))
        self.assertIn("You review things", json.dumps(item["source"]))
        self.assertEqual(item["source_hash"], item["current_hash"])
        self.assertTrue(item["title"])

    def test_list_never_contains_secrets_from_server_configs(self):
        self.request("mcp", "projsrv")
        out = self.cli("list").stdout
        self.assertNotIn("SECRET-ENV", out)
        self.assertNotIn("sk-ant-api03-abcdefghijklmnop", out)
        self.assertIn("X_TOKEN", out)

    def test_write_stores_the_note_with_hash_and_time_and_removes_only_that_request(self):
        self.request()
        self.request("command", "do-it")
        res = self.cli("write", "--kind", "agent", "--id", "my-agent", "--file", self.write_note_file())
        self.assertEqual(res.returncode, 0, res.stderr)
        path = self.notes_dir() / "agent" / "my-agent.md"
        text = path.read_text()
        self.assertTrue(text.startswith("---\n"))
        self.assertIn(f"source_hash: {wikiexplain.current_hash(self.portal, 'agent', 'my-agent')}", text)
        self.assertRegex(text, r"written_at: \d{4}-\d\d-\d\dT")
        self.assertIn("It reviews things.", text)
        self.assertEqual([(x["kind"], x["id"]) for x in self.lines()], [("command", "do-it")])
        self.assertEqual(json.loads(res.stdout)["note"], str(path))

    def test_ids_with_separators_stay_inside_the_notes_directory(self):
        res = self.cli("write", "--kind", "agent", "--id", "repo/proj-agent", "--file", self.write_note_file())
        self.assertEqual(res.returncode, 0, res.stderr)
        files = [p for p in self.notes_dir().rglob("*") if p.is_file()]
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].parent, self.notes_dir() / "agent")
        self.assertNotIn("/", files[0].name)
        self.assertTrue(files[0].resolve().is_relative_to(self.notes_dir().resolve()))

    def test_bad_input_is_refused_and_writes_nothing(self):
        note = self.write_note_file()
        for args in (("--kind", "skill", "--id", "x"), ("--kind", "agent", "--id", "nope"), ("--kind", "agent", "--id", "../../escape"), ("--kind", "../x", "--id", "my-agent"), ("--kind", "agent", "--id", "")):
            res = self.cli("write", *args, "--file", note)
            self.assertNotEqual(res.returncode, 0, args)
        big = self.root / "big.md"
        big.write_text("x" * (wikiexplain.MAX_NOTE + 1))
        self.assertNotEqual(self.cli("write", "--kind", "agent", "--id", "my-agent", "--file", str(big)).returncode, 0)
        self.assertNotEqual(self.cli("write", "--kind", "agent", "--id", "my-agent", "--file", str(self.root / "missing.md")).returncode, 0)
        self.assertNotEqual(self.cli("write", "--kind", "agent", "--id", "my-agent", "--file", str(self.root)).returncode, 0)
        self.assertFalse(self.notes_dir().exists() and list(self.notes_dir().rglob("*.md")))

    def test_a_note_can_be_read_from_stdin_and_a_symlinked_notes_dir_is_refused(self):
        res = self.cli("write", "--kind", "tool", "--id", "Bash", "--file", "-", input="From stdin.\n")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("From stdin.", (self.notes_dir() / "tool" / "Bash.md").read_text())
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir()
        (self.notes_dir() / "agent").symlink_to(elsewhere, target_is_directory=True)
        self.assertNotEqual(self.cli("write", "--kind", "agent", "--id", "my-agent", "--file", self.write_note_file()).returncode, 0)
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_the_module_never_reaches_for_the_network_or_a_model(self):
        import re
        src = Path(wikiexplain.__file__).read_text()
        imports = re.findall(r"^\s*(?:import|from)\s+([\w.]+)", src, re.M)
        for banned in ("urllib", "socket", "ssl", "http", "requests", "anthropic", "subprocess", "asyncio", "ftplib", "smtplib"):
            self.assertFalse([m for m in imports if m == banned or m.startswith(banned + ".")], banned)
        self.assertNotIn("os.system", src)
        self.assertNotIn("Popen", src)


class LintTest(ExplainBase):
    def category(self):
        return next(c for c in self.get("/api/wiki/lint")["categories"] if c["id"] == "stale_notes")

    def test_stale_and_orphaned_notes_are_flagged_and_fresh_ones_are_not(self):
        self.cli("write", "--kind", "agent", "--id", "my-agent", "--file", self.write_note_file())
        self.cli("write", "--kind", "command", "--id", "do-it", "--file", self.write_note_file())
        self.assertEqual(self.category()["count"], 0)
        write(self.f["home"] / "agents" / "my-agent.md", "---\nname: my-agent\ndescription: Changed\n---\nNew\n")
        (self.f["home"] / "commands" / "do-it.md").unlink()
        self.portal._harness_cache = None
        items = {(i["kind"], i["id"]): i["detail"] for i in self.category()["items"]}
        self.assertEqual(set(items), {("agent", "my-agent"), ("command", "do-it")})
        self.assertIn("changed", items[("agent", "my-agent")])
        self.assertIn("no longer", items[("command", "do-it")])


class ExplainHttpTest(ServerBase):
    def post(self, data, token=True, origin=None, ctype="application/json", raw=None, extra=None):
        h = {"Content-Type": ctype, **(extra or {})}
        if token:
            h["X-Portal-Token"] = self.token()
        if origin:
            h["Origin"] = origin
        return self.request("POST", "/api/harness/explain", headers=h, body=raw if raw is not None else json.dumps(data).encode())

    def queue(self):
        p = self.cfg.state_dir / "wiki" / "requests.jsonl"
        return p.read_text().splitlines() if p.exists() else []

    def test_a_guarded_request_is_queued_once(self):
        status, _, data = self.post({"kind": "tool", "id": "Bash"})
        self.assertEqual(status, 200, data)
        self.assertEqual(json.loads(data)["already"], False)
        self.assertEqual(json.loads(self.post({"kind": "tool", "id": "Bash"})[2])["already"], True)
        self.assertEqual(len(self.queue()), 1)
        page = json.loads(self.request("GET", "/api/wiki/page?kind=tool&id=Bash")[2])
        self.assertTrue(page["explain"]["pending"])

    def test_the_guards_refuse_without_writing(self):
        body = {"kind": "tool", "id": "Bash"}
        for kw, status in (({"token": False}, 403), ({"origin": "http://evil.example"}, 403), ({"extra": {"Sec-Fetch-Site": "cross-site"}}, 403), ({"ctype": "text/plain"}, 415), ({"raw": b"not json"}, 400), ({"raw": b"[1]"}, 400)):
            self.assertEqual(self.post(body, **kw)[0], status, kw)
        self.assertEqual(self.post({**body, "pad": "x" * 3000})[0], 413)
        self.assertEqual(self.post({"kind": "tool", "id": "Nope"})[0], 404)
        self.assertEqual(self.post({"kind": "skill", "id": "x"})[0], 400)
        self.assertEqual(self.request("POST", "/api/harness/explain", headers={"Host": "evil.example", "Content-Type": "application/json"}, body=b"{}")[0], 403)
        self.assertEqual(self.queue(), [])

    def test_other_verbs_are_not_a_request(self):
        self.assertEqual(self.request("GET", "/api/harness/explain")[0], 404)
        self.assertEqual(self.request("DELETE", "/api/harness/explain")[0], 405)
