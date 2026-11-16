"""Settings reach the Codex target too: preview, apply and undo pass the Codex home and skills dir when a Codex home
exists, show the Codex changes, and never name a path outside a sandboxed Claude home."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from python.amauta.portal import server, settings as settings_mod
from python.amauta.portal.config import Config
from python.tests.test_portal_settings import REPO, SettingsBase, http_call

WRAP = '''import json, subprocess, sys
r = subprocess.run([sys.executable, {inner!r}, *sys.argv[1:]], capture_output=True, text=True)
sys.stderr.write(r.stderr)
if r.returncode != 0 or "--codex-home" not in sys.argv:
    sys.stdout.write(r.stdout); sys.exit(r.returncode)
out = json.loads(r.stdout.strip().splitlines()[-1])
dry = "--dry-run" in sys.argv
out["codex"] = {{"dryRun": dry, "changed": True, "files": ["AGENTS.md", "hooks.json"], "removed": [], "skipped": [],
                "backup": None if dry else "/state/backups/20261113T000000Z-001"}}
print(json.dumps(out))
'''


class CodexTargetsTest(SettingsBase):
    def setUp(self):
        super().setUp()
        inner = self.root / "inner_installer.py"
        inner.write_text(self.fake.read_text())
        self.fake.write_text(WRAP.format(inner=str(inner)))

    def argv_of(self, dry):
        return [c["argv"] for c in self.calls() if ("--dry-run" in c["argv"]) == dry][-1]

    def test_without_a_codex_home_only_claude_is_targeted(self):
        self.preview({"persona": "neutral"})
        argv = self.argv_of(True)
        self.assertNotIn("--codex-home", argv)
        self.assertNotIn("--codex-skills-dir", argv)

    def test_a_codex_home_inside_the_sandbox_is_previewed_applied_and_undone(self):
        codex = self.home / ".codex"
        codex.mkdir()
        self.write_state()
        data = self.preview({"persona": "neutral"})
        argv = self.argv_of(True)
        self.assertEqual(argv[argv.index("--codex-home") + 1], str(codex))
        self.assertEqual(argv[argv.index("--codex-skills-dir") + 1], str(codex / ".agents" / "skills"))
        self.assertEqual(data["plan"]["codex"]["files"], ["AGENTS.md", "hooks.json"])
        status, res, _ = self.post("/api/settings/apply", {"apply_token": data["apply_token"], "confirm": True})
        self.assertEqual(status, 200, res)
        self.assertEqual(res["codex"]["backup"], "20261113T000000Z-001")
        self.assertIn("--codex-home", self.argv_of(False))
        entry = json.loads((self.state_dir / "portal-settings.log").read_text().splitlines()[-1])
        self.assertEqual(entry["codex_backup"], "20261113T000000Z-001")
        status, uprev, _ = self.post("/api/settings/undo/preview", {})
        self.assertEqual(status, 200, uprev)
        self.assertEqual(uprev["plan"]["codex"]["files"], ["AGENTS.md", "hooks.json"])
        status, undone, _ = self.post("/api/settings/undo", {"apply_token": uprev["apply_token"], "confirm": True})
        self.assertEqual(status, 200, undone)
        argv = self.argv_of(False)
        self.assertEqual((argv[argv.index("--persona") + 1], argv[argv.index("--codex-home") + 1]), ("gentleman", str(codex)))


class SandboxPinTest(unittest.TestCase):
    """A custom Claude home with no explicit Codex home: no argv entry may point outside the sandbox."""

    def test_custom_claude_home_keeps_every_codex_path_inside_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home, state = root / "sandbox" / ".claude", root / "sandbox" / "state"
            (home / ".codex").mkdir(parents=True)
            fake_home = root / "realhome"
            (fake_home / ".codex").mkdir(parents=True)
            env = {"HOME": str(fake_home), "CODEX_HOME": str(fake_home / ".codex"), "PATH": os.environ.get("PATH", "")}
            with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(Path, "home", return_value=fake_home):
                s = settings_mod.Settings(Config(state_dir=state, claude_home=home), installer=["installer"])
                argv = s._argv(settings_mod.validate({}, s.current()), dry_run=True)
            paths = [a.split("=", 1)[-1] for a in argv[1:] if os.sep in a]
            self.assertIn(str(home / ".codex"), paths)
            for p in paths:
                self.assertTrue(Path(p).is_relative_to(root / "sandbox"), f"{p} is outside the sandbox")


@unittest.skipUnless(shutil.which("node"), "node is required for the real-installer round trip")
class RealInstallerCodexRoundTrip(unittest.TestCase):
    def test_persona_change_reaches_agents_md_and_undo_restores_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home, state, cj = root / "home" / ".claude", root / "state", root / "home" / "claude.json"
            codex = home / ".codex"
            codex.mkdir(parents=True)
            sandbox = {"AMAUTA_CLAUDE_HOME": str(home), "AMAUTA_CLAUDE_JSON": str(cj), "AMAUTA_STATE_DIR": str(state)}
            subprocess.run(["node", str(REPO / "bin" / "amauta.js"), "install"], env={**os.environ, **sandbox}, check=True, capture_output=True)
            agents_before = (codex / "AGENTS.md").read_bytes()
            with mock.patch.dict(os.environ, sandbox):
                srv = server.make_server(Config(state_dir=state, claude_home=home), port=0)
                threading.Thread(target=srv.serve_forever, daemon=True).start()
                try:
                    port = srv.server_address[1]
                    hdr = {"Content-Type": "application/json", "X-Portal-Token": srv.token}
                    st, prev, _ = http_call(port, "POST", "/api/settings/preview", hdr, json.dumps({"persona": "neutral"}))
                    self.assertEqual(st, 200, prev)
                    self.assertIn("AGENTS.md", prev["plan"]["codex"]["files"])
                    self.assertEqual(agents_before, (codex / "AGENTS.md").read_bytes(), "dry run wrote nothing")
                    st, res, _ = http_call(port, "POST", "/api/settings/apply", hdr, json.dumps({"apply_token": prev["apply_token"], "confirm": True}))
                    self.assertEqual(st, 200, res)
                    self.assertNotEqual(agents_before, (codex / "AGENTS.md").read_bytes())
                    self.assertTrue((state / "backups" / res["codex"]["backup"]).is_dir())
                    st, uprev, _ = http_call(port, "POST", "/api/settings/undo/preview", hdr, "{}")
                    self.assertEqual(st, 200, uprev)
                    st, undone, _ = http_call(port, "POST", "/api/settings/undo", hdr, json.dumps({"apply_token": uprev["apply_token"], "confirm": True}))
                    self.assertEqual(st, 200, undone)
                    self.assertEqual(agents_before, (codex / "AGENTS.md").read_bytes())
                finally:
                    srv.shutdown()
                    srv.server_close()


if __name__ == "__main__":
    unittest.main()
