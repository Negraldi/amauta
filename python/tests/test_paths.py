"""Home resolution agrees with the Node installer (src/install/paths.js): the Codex home order and the sandbox rule."""
import unittest
from pathlib import Path

from python.amauta import paths
from python.amauta.portal import __main__ as portal_main

HOME = Path("/fake/home")


class CodexHomeTest(unittest.TestCase):
    def test_amauta_codex_home_beats_codex_home_beats_the_default(self):
        env = {"AMAUTA_CODEX_HOME": "/a/codex", "CODEX_HOME": "/b/codex"}
        self.assertEqual(paths.codex_home(env, home=HOME), Path("/a/codex"))
        self.assertEqual(paths.codex_home({"CODEX_HOME": "/b/codex"}, home=HOME), Path("/b/codex"))
        self.assertEqual(paths.codex_home({}, home=HOME), HOME / ".codex")

    def test_empty_values_count_as_unset(self):
        self.assertEqual(paths.codex_home({"CODEX_HOME": "", "AMAUTA_CODEX_HOME": ""}, home=HOME), HOME / ".codex")

    def test_a_custom_claude_home_keeps_codex_inside_it_and_ignores_codex_home(self):
        env = {"AMAUTA_CLAUDE_HOME": "/sandbox/.claude", "CODEX_HOME": "/real/codex"}
        self.assertEqual(paths.codex_home(env, home=HOME), Path("/sandbox/.claude/.codex"))
        self.assertEqual(paths.codex_home({"CODEX_HOME": "/real/codex"}, home=HOME, claude_home="/t/.claude"), Path("/t/.claude/.codex"))
        explicit = {"AMAUTA_CLAUDE_HOME": "/sandbox/.claude", "AMAUTA_CODEX_HOME": "/x/codex"}
        self.assertEqual(paths.codex_home(explicit, home=HOME), Path("/x/codex"))


class PortalConfigTest(unittest.TestCase):
    def test_portal_claude_home_flag_sandboxes_the_codex_home(self):
        args = portal_main.build_parser().parse_args(["--claude-home", "/t/.claude"])
        cfg = portal_main.build_config(args, env={"CODEX_HOME": "/real/codex"}, home=HOME)
        self.assertEqual(Path(cfg.codex_home), Path("/t/.claude/.codex"))

    def test_portal_codex_home_flag_wins(self):
        args = portal_main.build_parser().parse_args(["--claude-home", "/t/.claude", "--codex-home", "/c"])
        self.assertEqual(Path(portal_main.build_config(args, env={}, home=HOME).codex_home), Path("/c"))


if __name__ == "__main__":
    unittest.main()
