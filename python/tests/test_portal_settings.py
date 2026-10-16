"""Settings editor endpoints: closed schema, write guard, preview/apply/undo flow, one-time tokens, and a real-installer round trip."""
import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from python.amauta.portal import server, settings as settings_mod
from python.amauta.portal.config import Config

REPO = Path(__file__).resolve().parents[2]
FAKE = '''import json, os, pathlib, sys, time
LOG = pathlib.Path({log!r}); STATE = pathlib.Path({state!r}); FLAGS = pathlib.Path({flags!r})
argv = sys.argv[1:]
with LOG.open("a") as f:
    f.write(json.dumps({{"argv": argv, "env": sorted(os.environ)}}) + "\\n")
BK = STATE.parent / "backups"
if argv[0] == "install" and "--dry-run" in argv:
    if (FLAGS / "slowdry").exists():
        time.sleep(1.5)
    if (FLAGS / "mutate_on_dry").exists():
        STATE.write_text(json.dumps({{"persona": "gentleman", "rdd_mode": "on"}}))
if argv[0] == "install" and "--dry-run" not in argv and (FLAGS / "hang").exists():
    (BK / "20261016T111111Z").mkdir(parents=True)
    import subprocess
    (FLAGS / "gpid").write_text(str(subprocess.Popen(["sleep", "300"]).pid))
    time.sleep(300)
if argv[0] == "install" and "--dry-run" not in argv and (FLAGS / "failbackup").exists():
    (BK / "20261016T222222Z").mkdir(parents=True)
    sys.stderr.write("half done\\n"); sys.exit(1)
if (FLAGS / "fail").exists():
    sys.stderr.write("boom: it broke\\n"); sys.exit(1)
if argv[0] == "install":
    if "--dry-run" in argv:
        print(json.dumps({{"dryRun": True, "changed": True, "files": ["output-styles/Neutral.md", "settings.json"], "removed": ["skills/archify/SKILL.md"], "skipped": [],
                          "state_changes": {{"persona": {{"from": "gentleman", "to": "neutral"}}}}, "backup": None}}))
    else:
        (FLAGS / "started").write_text("1")
        if (FLAGS / "slow").exists():
            time.sleep(1.5)
        st = json.loads(STATE.read_text()) if STATE.exists() else {{}}
        st["persona"] = argv[argv.index("--persona") + 1]
        st["rdd_mode"] = argv[argv.index("--review-mode") + 1]
        st["telemetry"] = "--no-telemetry" not in argv
        for m in ("sdd", "rea", "context7", "impeccable", "archify"):
            st[m] = "--with-" + m in argv
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(st))
        n = len(LOG.read_text().splitlines())
        print(json.dumps({{"dryRun": False, "changed": True, "files": ["settings.json"], "removed": [], "skipped": [], "state_changes": {{}},
                          "backup": "/state/backups/2026101{{}}T000000Z".format(n % 10)}}))
elif argv[0] == "restore":
    print(json.dumps({{"backup": argv[argv.index("--backup") + 1], "restored": ["/x/settings.json"]}}))
'''


def http_call(port, method, path, headers=None, body=None, host=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
    c.request(method, path, body=body, headers={"Host": host or f"127.0.0.1:{port}", **(headers or {})})
    r = c.getresponse()
    data = r.read()
    c.close()
    try:
        parsed = json.loads(data)
    except ValueError:
        parsed = None
    return r.status, parsed, dict((k.lower(), v) for k, v in r.getheaders())


class SettingsBase(unittest.TestCase):
    installer = None  # None = a fake one is written

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state_dir, self.home = self.root / "state", self.root / "claude"
        self.state_dir.mkdir()
        self.home.mkdir()
        self.flags = self.root / "flags"
        self.flags.mkdir()
        self.log = self.root / "calls.log"
        self.fake = self.root / "fake_installer.py"
        self.fake.write_text(FAKE.format(log=str(self.log), state=str(self.state_dir / "state.json"), flags=str(self.flags)))
        self.clock = [1000.0]
        self.cfg = Config(state_dir=self.state_dir, claude_home=self.home)
        installer = self.installer if self.installer is not None else [sys.executable, str(self.fake)]
        self.srv = server.make_server(self.cfg, port=0, installer=installer, clock=lambda: self.clock[0])
        self.addCleanup(self.srv.server_close)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.shutdown)
        self.port = self.srv.server_address[1]

    def hdr(self, **extra):
        return {"Content-Type": "application/json", "X-Portal-Token": self.srv.token, **extra}

    def post(self, path, body, headers=None, host=None, raw=None):
        data = raw if raw is not None else json.dumps(body)
        return http_call(self.port, "POST", path, headers=headers if headers is not None else self.hdr(), body=data, host=host)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def write_state(self, **kw):
        (self.state_dir / "state.json").write_text(json.dumps({"persona": "gentleman", "rdd_mode": "off", "telemetry": True, "sdd": False, "archify": False, **kw}))

    def preview(self, body):
        status, data, _ = self.post("/api/settings/preview", body)
        self.assertEqual(status, 200, data)
        return data


class ReadTest(SettingsBase):
    def test_defaults_without_a_state_file(self):
        status, data, _ = http_call(self.port, "GET", "/api/settings")
        self.assertEqual(status, 200)
        self.assertFalse(data["installed"])
        self.assertEqual(data["current"], {"persona": "gentleman", "review_mode": "off", "telemetry": "on", "modules": {m: "off" for m in ("sdd", "rea", "context7", "impeccable", "archify")}})
        self.assertEqual(data["allowed"]["persona"], ["gentleman", "neutral"])
        self.assertEqual(data["allowed"]["modules"], ["sdd", "rea", "context7", "impeccable", "archify"])
        self.assertEqual(data["undo"], {"available": False, "backup": None, "ts": None})

    def test_current_values_come_from_the_state_file(self):
        self.write_state(persona="neutral", rdd_mode="on", telemetry=False, sdd=True, rea=True)
        _, data, _ = http_call(self.port, "GET", "/api/settings")
        self.assertTrue(data["installed"])
        self.assertEqual(data["current"]["persona"], "neutral")
        self.assertEqual(data["current"]["review_mode"], "on")
        self.assertEqual(data["current"]["telemetry"], "off")
        self.assertEqual(data["current"]["modules"]["sdd"], "on")
        self.assertEqual(data["current"]["modules"]["rea"], "on")
        self.assertEqual(data["current"]["modules"]["archify"], "off")

    def test_wrong_host_is_refused(self):
        self.assertEqual(http_call(self.port, "GET", "/api/settings", host="evil.example")[0], 403)


class GuardTest(SettingsBase):
    PATHS = ("/api/settings/preview", "/api/settings/apply", "/api/settings/undo/preview", "/api/settings/undo")
    GOOD = {"/api/settings/preview": {"persona": "neutral"}, "/api/settings/apply": {"apply_token": "x", "confirm": True},
            "/api/settings/undo/preview": {}, "/api/settings/undo": {"apply_token": "x", "confirm": True}}

    def each(self):
        for p in self.PATHS:
            yield p, self.GOOD[p]

    def test_only_post_is_accepted(self):
        for p in self.PATHS:
            for method in ("GET", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"):
                status, _, h = http_call(self.port, method, p, headers=self.hdr())
                self.assertEqual(status, 405, (method, p))
                self.assertIn("POST", h.get("allow", ""))
        self.assertEqual(self.calls(), [])

    def test_wrong_host(self):
        for p, body in self.each():
            self.assertEqual(self.post(p, body, host="evil.example")[0], 403, p)
            self.assertEqual(self.post(p, body, host=f"127.0.0.1:{self.port + 1}")[0], 403, p)
        self.assertEqual(self.calls(), [])

    def test_cross_origin(self):
        for p, body in self.each():
            self.assertEqual(self.post(p, body, headers=self.hdr(Origin="http://evil.example"))[0], 403, p)
            self.assertEqual(self.post(p, body, headers=self.hdr(Origin="null"))[0], 403, p)
            self.assertEqual(self.post(p, body, headers=self.hdr(**{"Sec-Fetch-Site": "cross-site"}))[0], 403, p)
            self.assertEqual(self.post(p, body, headers=self.hdr(**{"Sec-Fetch-Site": "same-site"}))[0], 403, p)
        self.assertEqual(self.calls(), [])

    def test_missing_or_invalid_token(self):
        for p, body in self.each():
            self.assertEqual(self.post(p, body, headers={"Content-Type": "application/json"})[0], 403, p)
            self.assertEqual(self.post(p, body, headers={"Content-Type": "application/json", "X-Portal-Token": "nope"})[0], 403, p)
            self.assertEqual(self.post(p, body, headers={"Content-Type": "application/json", "X-Portal-Token": ""})[0], 403, p)
        self.assertEqual(self.calls(), [])

    def test_same_origin_with_token_is_accepted_past_the_guard(self):
        status, _, _ = self.post("/api/settings/preview", {}, headers=self.hdr(Origin=f"http://127.0.0.1:{self.port}", **{"Sec-Fetch-Site": "same-origin"}))
        self.assertEqual(status, 200)

    def test_content_type_must_be_json(self):
        for p, body in self.each():
            for ctype in ("application/x-www-form-urlencoded", "text/plain", "multipart/form-data; boundary=x", ""):
                h = {"X-Portal-Token": self.srv.token}
                if ctype:
                    h["Content-Type"] = ctype
                self.assertEqual(self.post(p, body, headers=h)[0], 415, (p, ctype))
        self.assertEqual(self.post("/api/settings/preview", {}, headers=self.hdr(**{"Content-Type": "application/json; charset=utf-8"}))[0], 200)
        self.assertEqual(self.calls() and len(self.calls()), 1)

    def test_oversized_body(self):
        for p, _ in self.each():
            status, data, _ = self.post(p, None, raw=json.dumps({"persona": "x" * 5000}))
            self.assertEqual(status, 413, p)
        self.assertEqual(self.calls(), [])

    def test_not_json_or_not_an_object(self):
        for p, _ in self.each():
            for raw in ("{", "", "[]", "\"neutral\"", "null", "42", "\xff"):
                self.assertEqual(self.post(p, None, raw=raw)[0], 400, (p, raw))
        self.assertEqual(self.calls(), [])

    def test_unknown_key_and_bad_values_never_reach_the_installer(self):
        bad = [
            {"deny": ["Bash(*)"]}, {"settings": {"outputStyle": "x"}}, {"persona": "neutral", "extra": 1}, {"__proto__": {}},
            {"persona": "hacker"}, {"persona": "neutral; rm -rf ~"}, {"persona": "../../etc"}, {"persona": 1}, {"persona": None}, {"persona": ["neutral"]},
            {"review_mode": "maybe"}, {"review_mode": True}, {"telemetry": "yes"}, {"telemetry": 0},
            {"modules": ["sdd"]}, {"modules": {"sdd": "yes"}}, {"modules": {"sdd": True}}, {"modules": {"gentle-ai": "on"}}, {"modules": {"sdd": "on", "--force": "on"}},
            {"repair": "yes"}, {"repair": 1},
        ]
        for body in bad:
            status, data, _ = self.post("/api/settings/preview", body)
            self.assertEqual(status, 400, body)
            self.assertIn("error", data)
        self.assertEqual(self.calls(), [])

    def test_apply_and_undo_bodies_are_closed_too(self):
        for p, body in (("/api/settings/apply", {"apply_token": "x", "confirm": True, "persona": "neutral"}), ("/api/settings/apply", {"apply_token": "x"}),
                        ("/api/settings/apply", {"confirm": True}), ("/api/settings/apply", {"apply_token": 5, "confirm": True}),
                        ("/api/settings/undo", {}), ("/api/settings/undo", {"confirm": True}), ("/api/settings/undo", {"apply_token": "x", "confirm": "yes"}),
                        ("/api/settings/undo", {"apply_token": "x", "confirm": True, "backup": "../x"}), ("/api/settings/undo/preview", {"backup": "../x"}),
                        ("/api/settings/undo/preview", {"confirm": True})):
            self.assertEqual(self.post(p, body)[0], 400, (p, body))
        self.assertEqual(self.calls(), [])


class FlowTest(SettingsBase):
    def setUp(self):
        super().setUp()
        self.write_state()

    def test_preview_runs_a_dry_run_with_exact_flags_and_a_scrubbed_environment(self):
        with mock.patch.dict(os.environ, {"SUPER_SECRET_TOKEN": "s3cret"}):
            data = self.preview({"persona": "neutral", "review_mode": "on", "telemetry": "off", "modules": {"sdd": "on", "archify": "on"}})
        (call,) = self.calls()
        argv = call["argv"]
        self.assertEqual(argv[:2], ["install", "--json"])
        self.assertIn("--dry-run", argv)
        self.assertEqual(argv[argv.index("--persona") + 1], "neutral")
        self.assertEqual(argv[argv.index("--review-mode") + 1], "on")
        self.assertIn("--no-telemetry", argv)
        for m, on in (("sdd", True), ("archify", True), ("rea", False), ("context7", False), ("impeccable", False)):
            self.assertIn(f"--with-{m}" if on else f"--without-{m}", argv)
            self.assertNotIn(f"--without-{m}" if on else f"--with-{m}", argv)
        self.assertEqual(argv[argv.index("--claude-home") + 1], str(self.home))
        self.assertEqual(argv[argv.index("--state-dir") + 1], str(self.state_dir))
        self.assertNotIn("SUPER_SECRET_TOKEN", call["env"])
        self.assertIn("PATH", call["env"])
        self.assertEqual({c["key"]: (c["from"], c["to"]) for c in data["changes"]}, {"persona": ("gentleman", "neutral"), "review_mode": ("off", "on"), "telemetry": ("on", "off"),
                                                                                    "module:sdd": ("off", "on"), "module:archify": ("off", "on")})
        self.assertEqual(data["plan"]["files"], ["output-styles/Neutral.md", "settings.json"])
        self.assertEqual(data["plan"]["removed"], ["skills/archify/SKILL.md"])
        self.assertEqual(data["expires_in"], 300)
        self.assertGreaterEqual(len(data["apply_token"]), 32)
        self.assertEqual(json.loads((self.state_dir / "state.json").read_text())["persona"], "gentleman", "preview writes nothing")

    def test_missing_keys_keep_their_current_value(self):
        self.write_state(persona="neutral", sdd=True)
        self.preview({"review_mode": "on"})
        argv = self.calls()[0]["argv"]
        self.assertEqual(argv[argv.index("--persona") + 1], "neutral")
        self.assertIn("--with-sdd", argv)

    def test_installer_failure_on_preview_gives_no_token(self):
        (self.flags / "fail").write_text("1")
        status, data, _ = self.post("/api/settings/preview", {"persona": "neutral"})
        self.assertEqual(status, 502)
        self.assertIn("boom", data["detail"])
        self.assertNotIn("apply_token", data)

    def apply(self, token, confirm=True):
        return self.post("/api/settings/apply", {"apply_token": token, "confirm": confirm})

    def test_apply_runs_the_real_install_with_the_previewed_flags_and_logs_it(self):
        token = self.preview({"persona": "neutral", "modules": {"sdd": "on"}})["apply_token"]
        status, data, _ = self.apply(token)
        self.assertEqual(status, 200, data)
        self.assertTrue(data["ok"])
        self.assertRegex(data["backup"], r"^2026101\dT000000Z$")  # an id, not a path
        self.assertTrue(data["undo_available"])
        argv = self.calls()[-1]["argv"]
        self.assertNotIn("--dry-run", argv)
        self.assertEqual(argv[argv.index("--persona") + 1], "neutral")
        self.assertIn("--with-sdd", argv)
        entries = [json.loads(line) for line in (self.state_dir / "portal-settings.log").read_text().splitlines()]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["action"], "apply")
        self.assertEqual(entries[0]["backup"], data["backup"])
        self.assertEqual(entries[0]["to"]["persona"], "neutral")
        self.assertNotIn(token, json.dumps(entries))
        self.assertNotIn(self.srv.token, json.dumps(entries))
        self.assertEqual(self.describe()["current"]["persona"], "neutral")

    def describe(self):
        return http_call(self.port, "GET", "/api/settings")[1]

    def test_apply_requires_confirm_and_a_known_token(self):
        token = self.preview({"persona": "neutral"})["apply_token"]
        self.assertEqual(self.apply(token, confirm=False)[0], 400)
        self.assertEqual(self.apply("not-a-token")[0], 400)
        self.assertEqual([c for c in self.calls() if "--dry-run" not in c["argv"]], [])
        self.assertEqual(self.apply(token)[0], 200, "a refused confirm does not burn the token")

    def test_token_is_one_time(self):
        token = self.preview({"persona": "neutral"})["apply_token"]
        self.assertEqual(self.apply(token)[0], 200)
        status, data, _ = self.apply(token)
        self.assertEqual(status, 400)
        self.assertIn("preview", data["error"])
        self.assertEqual(len([c for c in self.calls() if "--dry-run" not in c["argv"]]), 1)

    def test_token_expires_after_five_minutes(self):
        token = self.preview({"persona": "neutral"})["apply_token"]
        self.clock[0] += 299
        token2 = self.preview({"persona": "neutral"})["apply_token"]
        self.clock[0] += 2
        status, data, _ = self.apply(token)
        self.assertEqual(status, 400)
        self.assertIn("expired", data["error"])
        self.assertEqual(self.apply(token2)[0], 200, "a newer preview is still inside its own window")

    def test_apply_is_refused_when_the_state_changed_since_the_preview(self):
        token = self.preview({"persona": "neutral"})["apply_token"]
        self.write_state(rdd_mode="on")  # someone ran `amauta install` / review mode in a terminal
        status, data, _ = self.apply(token)
        self.assertEqual(status, 409)
        self.assertIn("preview again", data["error"])
        self.assertEqual([c for c in self.calls() if "--dry-run" not in c["argv"]], [])
        self.assertEqual(self.apply(token)[0], 400, "the stale token is gone")

    def test_concurrent_apply_is_serialised(self):
        (self.flags / "slow").write_text("1")
        t1 = self.preview({"persona": "neutral"})["apply_token"]
        t2 = self.preview({"persona": "neutral", "review_mode": "on"})["apply_token"]
        first = {}
        th = threading.Thread(target=lambda: first.update(r=self.apply(t1)))
        th.start()
        deadline = time.time() + 10
        while not (self.flags / "started").exists() and time.time() < deadline:
            time.sleep(0.02)
        status, data, _ = self.apply(t2)
        th.join()
        self.assertEqual(first["r"][0], 200)
        self.assertEqual(status, 409)
        self.assertIn("another change", data["error"])
        self.assertEqual(len([c for c in self.calls() if "--dry-run" not in c["argv"]]), 1)

    def test_installer_failure_on_apply_is_reported_and_not_logged(self):
        token = self.preview({"persona": "neutral"})["apply_token"]
        (self.flags / "fail").write_text("1")
        status, data, _ = self.apply(token)
        self.assertEqual(status, 502)
        self.assertIn("boom", data["detail"])
        self.assertFalse((self.state_dir / "portal-settings.log").exists())

    def undo_preview(self):
        return self.post("/api/settings/undo/preview", {})

    def undo(self, token, confirm=True):
        return self.post("/api/settings/undo", {"apply_token": token, "confirm": confirm})

    def installs(self):
        return [c["argv"] for c in self.calls() if c["argv"][0] == "install"]

    def test_undo_without_a_portal_apply_is_refused(self):
        status, data, _ = self.undo_preview()
        self.assertEqual(status, 409)
        self.assertIn("no portal change", data["error"])
        self.assertEqual(self.installs(), [])

    def test_undo_previews_then_reruns_install_with_the_logged_previous_values(self):
        applied = self.apply(self.preview({"persona": "neutral", "modules": {"sdd": "on"}})["apply_token"])[1]
        d = self.describe()["undo"]
        self.assertTrue(d["available"])
        n_before = len(self.installs())
        status, prev, _ = self.undo_preview()
        self.assertEqual(status, 200, prev)
        self.assertEqual({c["key"]: (c["from"], c["to"]) for c in prev["changes"]}, {"persona": ("neutral", "gentleman"), "module:sdd": ("on", "off")})
        dry = self.installs()[n_before:]
        self.assertEqual(len(dry), 1)
        self.assertIn("--dry-run", dry[0])
        self.assertEqual(dry[0][dry[0].index("--persona") + 1], "gentleman")
        self.assertIn("--without-sdd", dry[0])
        self.assertEqual(self.describe()["current"]["persona"], "neutral", "the preview changed nothing")
        status, res, _ = self.undo(prev["apply_token"])
        self.assertEqual(status, 200, res)
        self.assertTrue(res["ok"])
        self.assertNotEqual(res["backup"], applied["backup"], "undo makes its own fresh backup")
        real = self.installs()[-1]
        self.assertNotIn("--dry-run", real)
        self.assertEqual(real[real.index("--persona") + 1], "gentleman")
        self.assertIn("--without-sdd", real)
        self.assertEqual([c for c in self.calls() if c["argv"][0] == "restore"], [], "the portal never restores snapshots")
        self.assertEqual(self.describe()["current"]["persona"], "gentleman")
        log = [json.loads(line) for line in (self.state_dir / "portal-settings.log").read_text().splitlines()]
        self.assertEqual([e["action"] for e in log], ["apply", "undo"])
        self.assertEqual(log[1]["backup"], res["backup"])
        self.assertFalse(self.describe()["undo"]["available"])
        self.assertEqual(self.undo_preview()[0], 409, "an apply can be undone once")

    def test_undo_token_is_single_use_and_not_interchangeable_with_apply(self):
        self.apply(self.preview({"persona": "neutral"})["apply_token"])
        utoken = self.undo_preview()[1]["apply_token"]
        self.assertEqual(self.apply(utoken)[0], 400, "an undo token cannot be applied as a plain change")
        utoken = self.undo_preview()[1]["apply_token"]
        self.assertEqual(self.undo(utoken)[0], 200)
        self.assertEqual(self.undo(utoken)[0], 400)
        ptoken = self.preview({"persona": "neutral"})["apply_token"]
        self.assertEqual(self.undo(ptoken)[0], 400, "an apply token cannot undo")

    def test_undo_is_refused_when_the_settings_changed_after_the_apply(self):
        self.apply(self.preview({"persona": "neutral"})["apply_token"])
        self.write_state(persona="gentleman", rdd_mode="on")
        n = len(self.installs())
        status, data, _ = self.undo_preview()
        self.assertEqual(status, 409)
        self.assertIn("changed", data["error"])
        self.assertEqual(len(self.installs()), n)

    def test_undo_is_refused_when_the_state_moved_between_preview_and_confirm(self):
        self.apply(self.preview({"persona": "neutral"})["apply_token"])
        token = self.undo_preview()[1]["apply_token"]
        self.write_state(persona="neutral", rdd_mode="on")
        n = len(self.installs())
        status, data, _ = self.undo(token)
        self.assertEqual(status, 409)
        self.assertIn("preview again", data["error"])
        self.assertEqual(len(self.installs()), n)

    def test_undo_needs_confirm(self):
        self.apply(self.preview({"persona": "neutral"})["apply_token"])
        token = self.undo_preview()[1]["apply_token"]
        n = len(self.installs())
        self.assertEqual(self.undo(token, confirm=False)[0], 400)
        self.assertEqual(len(self.installs()), n)

    def test_claude_json_is_passed_as_one_token(self):
        with mock.patch.dict(os.environ, {"AMAUTA_CLAUDE_JSON": "/sandbox/claude.json"}):
            self.preview({"persona": "neutral"})
        argv = self.calls()[0]["argv"]
        self.assertIn("--claude-json=/sandbox/claude.json", argv)
        self.assertNotIn("--claude-json", argv)

    def test_a_killed_apply_kills_the_whole_group_and_logs_the_partial_backup(self):
        token = self.preview({"persona": "neutral"})["apply_token"]
        (self.flags / "hang").write_text("1")
        with mock.patch.object(settings_mod, "APPLY_TIMEOUT", 2):
            status, data, _ = self.apply(token)
        self.assertEqual(status, 504)
        self.assertEqual(data.get("backup"), "20261016T111111Z")
        gpid = int((self.flags / "gpid").read_text())
        deadline = time.time() + 5
        alive = True
        while alive and time.time() < deadline:
            try:
                os.kill(gpid, 0)
                st = Path(f"/proc/{gpid}/stat").read_text().split()[2] if Path(f"/proc/{gpid}/stat").exists() else "Z"
                alive = st != "Z"
            except OSError:
                alive = False
            time.sleep(0.05)
        self.assertFalse(alive, "the grandchild was killed with the group")
        log = [json.loads(line) for line in (self.state_dir / "portal-settings.log").read_text().splitlines()]
        self.assertEqual(len(log), 1)
        self.assertEqual((log[0]["action"], log[0]["backup"], log[0]["status"]), ("apply_failed", "20261016T111111Z", "timeout"))
        self.assertFalse(self.describe()["undo"]["available"], "a failed run is visible but not an undo target")

    def test_a_failed_apply_that_made_a_backup_is_logged(self):
        token = self.preview({"persona": "neutral"})["apply_token"]
        (self.flags / "failbackup").write_text("1")
        status, data, _ = self.apply(token)
        self.assertEqual(status, 502)
        self.assertEqual(data.get("backup"), "20261016T222222Z")
        log = [json.loads(line) for line in (self.state_dir / "portal-settings.log").read_text().splitlines()]
        self.assertEqual((log[0]["action"], log[0]["backup"], log[0]["status"]), ("apply_failed", "20261016T222222Z", "failed"))

    def test_preview_is_refused_when_the_state_changes_during_the_dry_run(self):
        (self.flags / "mutate_on_dry").write_text("1")
        status, data, _ = self.post("/api/settings/preview", {"persona": "neutral"})
        self.assertEqual(status, 409)
        self.assertIn("preview again", data["error"])
        self.assertNotIn("apply_token", data)

    def test_parallel_previews_are_capped_at_two(self):
        (self.flags / "slowdry").write_text("1")
        results = []
        threads = [threading.Thread(target=lambda: results.append(self.post("/api/settings/preview", {"persona": "neutral"})[0])) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(results), [200, 200, 429, 429])

    def test_lock_busy_message_says_to_preview_again(self):
        (self.flags / "slow").write_text("1")
        t1 = self.preview({"persona": "neutral"})["apply_token"]
        t2 = self.preview({"persona": "neutral", "review_mode": "on"})["apply_token"]
        th = threading.Thread(target=lambda: self.apply(t1))
        th.start()
        deadline = time.time() + 10
        while not (self.flags / "started").exists() and time.time() < deadline:
            time.sleep(0.02)
        status, data, _ = self.apply(t2)
        th.join()
        self.assertEqual(status, 409)
        self.assertIn("preview again", data["error"])
        self.assertEqual(self.apply(t2)[0], 400, "the token was consumed")


def tree(root: Path) -> dict:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


@unittest.skipUnless(shutil.which("node"), "node is required for the real-installer round trip")
class RealInstallerRoundTrip(unittest.TestCase):
    def test_preview_apply_undo_with_the_real_installer_in_a_sandbox(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home, state, cj = root / "home" / ".claude", root / "state", root / "home" / "claude.json"
            home.mkdir(parents=True)
            env = {**os.environ, "AMAUTA_CLAUDE_HOME": str(home), "AMAUTA_CLAUDE_JSON": str(cj), "AMAUTA_STATE_DIR": str(state)}
            subprocess.run(["node", str(REPO / "bin" / "amauta.js"), "install"], env=env, check=True, capture_output=True)
            with mock.patch.dict(os.environ, {"AMAUTA_CLAUDE_HOME": str(home), "AMAUTA_CLAUDE_JSON": str(cj), "AMAUTA_STATE_DIR": str(state)}):
                srv = server.make_server(Config(state_dir=state, claude_home=home), port=0)
                threading.Thread(target=srv.serve_forever, daemon=True).start()
                try:
                    port = srv.server_address[1]
                    hdr = {"Content-Type": "application/json", "X-Portal-Token": srv.token}
                    before = tree(home), cj.read_bytes(), (state / "state.json").read_bytes()
                    st, cur, _ = http_call(port, "GET", "/api/settings")
                    self.assertEqual((st, cur["current"]["persona"], cur["current"]["review_mode"]), (200, "gentleman", "off"))
                    want = {"persona": "neutral", "review_mode": "on", "telemetry": "off", "modules": {"archify": "on"}}
                    st, prev, _ = http_call(port, "POST", "/api/settings/preview", hdr, json.dumps(want))
                    self.assertEqual(st, 200, prev)
                    self.assertTrue(prev["plan"]["changed"])
                    self.assertIn("output-styles/gentleman.md", prev["plan"]["files"])
                    self.assertEqual(before, (tree(home), cj.read_bytes(), (state / "state.json").read_bytes()), "dry run wrote nothing")
                    st, res, _ = http_call(port, "POST", "/api/settings/apply", hdr, json.dumps({"apply_token": prev["apply_token"], "confirm": True}))
                    self.assertEqual(st, 200, res)
                    self.assertTrue((state / "backups" / res["backup"]).is_dir())
                    s = json.loads((state / "state.json").read_text())
                    self.assertEqual((s["persona"], s["rdd_mode"], s["telemetry"], s["archify"]), ("neutral", "on", False, True))
                    self.assertTrue((home / "skills" / "archify" / "SKILL.md").is_file())
                    self.assertEqual(json.loads((home / "settings.json").read_text())["outputStyle"], "Neutral")
                    self.assertEqual(http_call(port, "GET", "/api/settings")[1]["current"]["modules"]["archify"], "on")
                    # Newer edits made by hand after the apply must survive the undo.
                    cj_data = json.loads(cj.read_text()); cj_data["dummyKey"] = {"keep": True}; cj.write_text(json.dumps(cj_data))
                    st_data = json.loads((home / "settings.json").read_text()); st_data["dummySetting"] = 1; (home / "settings.json").write_text(json.dumps(st_data))
                    st, uprev, _ = http_call(port, "POST", "/api/settings/undo/preview", hdr, "{}")
                    self.assertEqual(st, 200, uprev)
                    self.assertIn("persona", {c["key"] for c in uprev["changes"]})
                    st, undone, _ = http_call(port, "POST", "/api/settings/undo", hdr, json.dumps({"apply_token": uprev["apply_token"], "confirm": True}))
                    self.assertEqual(st, 200, undone)
                    self.assertNotEqual(undone["backup"], res["backup"])
                    self.assertTrue((state / "backups" / undone["backup"]).is_dir())
                    s = json.loads((state / "state.json").read_text())
                    self.assertEqual((s["persona"], s["rdd_mode"], s["telemetry"], s["archify"]), ("gentleman", "off", True, False))
                    self.assertEqual(json.loads(cj.read_text())["dummyKey"], {"keep": True})
                    now_settings = json.loads((home / "settings.json").read_text())
                    self.assertEqual(now_settings["dummySetting"], 1)
                    self.assertEqual(now_settings["outputStyle"], "Gentleman")
                    self.assertFalse((home / "skills" / "archify").exists())
                    self.assertEqual(http_call(port, "POST", "/api/settings/undo/preview", hdr, "{}")[0], 409)
                    # Turning a module off again goes through the installer too.
                    st, prev, _ = http_call(port, "POST", "/api/settings/preview", hdr, json.dumps({"modules": {"sdd": "on"}}))
                    http_call(port, "POST", "/api/settings/apply", hdr, json.dumps({"apply_token": prev["apply_token"], "confirm": True}))
                    self.assertTrue((home / "skills" / "sdd-apply").is_dir())
                    st, prev, _ = http_call(port, "POST", "/api/settings/preview", hdr, json.dumps({"modules": {"sdd": "off"}}))
                    self.assertIn("skills/sdd-apply/SKILL.md", prev["plan"]["removed"])
                    http_call(port, "POST", "/api/settings/apply", hdr, json.dumps({"apply_token": prev["apply_token"], "confirm": True}))
                    self.assertFalse((home / "skills" / "sdd-apply").exists())
                finally:
                    srv.shutdown()
                    srv.server_close()


if __name__ == "__main__":
    unittest.main()
