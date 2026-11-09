"""Profiles (plan D12, ADR 0007): a neutral `default` profile ships with amauta; a private organization profile lives in
the state directory and extends it; a project can override single files in `.amauta/profile/`. Precedence: project >
org > default. The selection is stored in the state directory, never in the repository. A privacy guard keeps
secrets, identifiers and personal contacts out of a profile and roles only in `people/`.
"""

import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from python.amauta.privacy import profiles
from python.tests import detector_fixtures as fx


def git_init(path):
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    return path


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.state = self.root / "state"
        self.repo = git_init(self.root / "repo")

    def cli(self, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            code = profiles.main([*args, "--state-dir", str(self.state)])
        return code, out.getvalue()


class ResolveTest(Base):
    def test_default_ships_every_file_and_is_used_without_a_selection(self):
        r = profiles.resolve(self.state, self.repo)
        self.assertEqual(r["profile"], "default")
        self.assertEqual(sorted(r["files"]), sorted(profiles.FILES))
        self.assertTrue(all(f["layer"] == "default" and Path(f["path"]).is_file() for f in r["files"].values()))

    def test_org_extends_default_and_the_project_overrides_single_files(self):
        profiles.create(self.state, "acme")
        (self.state / "profiles" / "acme" / "brand.md").write_text("# Brand\n\nPrimary color: teal.\n")
        (self.repo / "sub").mkdir()
        profiles.select(self.state, self.repo / "sub", "acme")
        (self.repo / ".amauta" / "profile").mkdir(parents=True)
        (self.repo / ".amauta" / "profile" / "glossary.md").write_text("# Glossary\n\nProject terms.\n")
        r = profiles.resolve(self.state, self.repo / "sub")
        self.assertEqual(r["profile"], "acme")
        self.assertEqual(r["files"]["brand.md"]["layer"], "org")
        self.assertEqual(r["files"]["glossary.md"]["layer"], "project")
        self.assertEqual(r["files"]["sources.md"]["layer"], "org", "created from the template")
        self.assertNotIn("acme", "".join(p.read_text() for p in self.repo.rglob("*") if p.is_file()), "the selection is not in the repo")

    def test_bad_names_and_unknown_profiles_are_refused(self):
        for bad in ("../x", "a/b", "", ".hidden", "default"):
            with self.assertRaises(ValueError, msg=bad):
                profiles.create(self.state, bad)
        with self.assertRaises(ValueError):
            profiles.select(self.state, self.repo, "missing")


class GuardTest(Base):
    def test_secrets_identifiers_and_contacts_are_errors_and_names_in_people_are_flagged(self):
        profiles.create(self.state, "acme")
        d = self.state / "profiles" / "acme"
        (d / "sources.md").write_text(f"# Sources\n\n- warehouse: sales mart\n- token = {'x' * 20}\n")
        (d / "people" / "roles.md").write_text(f"# Roles\n\n- Data owner: approves metric definitions\n- Maria Fernanda Lopez\n- contact: ana@example.org, {fx.mobile(1)}\n")
        found = profiles.check(self.state, "acme")
        kinds = {(f["file"], f["kind"]) for f in found}
        self.assertIn(("sources.md", "secret"), kinds)
        self.assertIn(("people/roles.md", "email"), kinds)
        self.assertIn(("people/roles.md", "phone"), kinds)
        self.assertIn(("people/roles.md", "person-name"), kinds)
        self.assertFalse(any(f["line"] == 3 for f in found if f["file"] == "people/roles.md"), "a role line is fine")
        self.assertNotIn("ana@example.org", json.dumps(found), "never echoes the value")
        self.assertEqual(profiles.check(self.state, "default"), [], "the shipped profile is clean")


class CliTest(Base):
    def test_new_use_show_list_check(self):
        self.assertEqual(self.cli("new", "acme")[0], 0)
        self.assertEqual(self.cli("use", "acme", "--cwd", str(self.repo))[0], 0)
        code, out = self.cli("show", "--cwd", str(self.repo), "--json")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["profile"], "acme")
        code, out = self.cli("list")
        self.assertIn("default", out)
        self.assertIn("acme", out)
        self.assertEqual(self.cli("check", "acme")[0], 0)
        (self.state / "profiles" / "acme" / "people" / "roles.md").write_text("- Juan Perez\n")
        self.assertEqual(self.cli("check", "acme")[0], 1)


if __name__ == "__main__":
    unittest.main()
