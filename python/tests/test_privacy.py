"""The data-security pillar (plan D4, ADR 0007): the privacy hook asks before a data file is read and warns about
secrets in prompts (never denies), and `amauta privacy scan|redact|pseudonymize` works on local files.

All data is generated (detector_fixtures). Reports carry counts, kinds and column names, never values.
"""

import csv
import io
import json
import os
import stat
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from python.amauta.privacy import columns, hook, paths, pseudonymize
from python.amauta.privacy.__main__ import main
from python.tests import detector_fixtures as fx


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.state = self.root / "state"
        self.state.mkdir()
        self.people = self.root / "work" / "clientes.csv"
        self.people.parent.mkdir()
        write_csv(self.people, [["id_cliente", "nombre", "cedula", "ciudad", "monto"]]
                  + [[str(i), f"Persona {i}", fx.cedula(i), "Quito", str(i * 10)] for i in range(1, 21)])


class DataFileTest(Base):
    def test_data_files_outside_test_fixture_and_example_paths(self):
        for p in ("/w/datos/ventas.csv", "/w/x.parquet", "/w/a.xlsx", "/w/b.sav", "/w/c.jsonl", "/w/base.sqlite"):
            self.assertTrue(paths.is_data_file(p, []), p)
        for p in ("/w/tests/x.csv", "/w/fixtures/y.parquet", "/w/examples/z.xlsx", "/w/src/app.py", "/w/README.md"):
            self.assertFalse(paths.is_data_file(p, []), p)

    def test_configured_paths_count_whatever_the_extension(self):
        conf = [str(self.root / "work")]
        self.assertTrue(paths.is_data_file(str(self.root / "work" / "notes.txt"), conf))
        self.assertFalse(paths.is_data_file(str(self.root / "other" / "notes.txt"), conf))
        (self.state / "privacy.json").write_text(json.dumps({"paths": conf}))
        self.assertEqual(paths.configured(self.state), conf)


class HookTest(Base):
    def run_hook(self, payload):
        out = io.StringIO()
        with redirect_stdout(out):
            code = hook.run(json.dumps(payload), self.state)
        self.assertEqual(code, 0)
        return json.loads(out.getvalue()) if out.getvalue().strip() else None

    def test_reading_a_data_file_asks_and_never_denies(self):
        d = self.run_hook({"hook_event_name": "PreToolUse", "tool_name": "Read", "tool_input": {"file_path": str(self.people)}})
        spec = d["hookSpecificOutput"]
        self.assertEqual(spec["permissionDecision"], "ask")
        self.assertIn("clientes.csv", spec["permissionDecisionReason"])
        self.assertIsNone(self.run_hook({"hook_event_name": "PreToolUse", "tool_name": "Read", "tool_input": {"file_path": "/w/app.py"}}))
        self.assertIsNone(self.run_hook({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "ls"}}))

    def test_a_secret_in_a_prompt_only_warns_and_never_echoes(self):
        secret = "AKIA" + "Q" * 16
        d = self.run_hook({"hook_event_name": "UserPromptSubmit", "prompt": f"usa esta clave {secret}"})
        self.assertNotIn("decision", d)
        self.assertIn("secret", d["systemMessage"])
        self.assertNotIn(secret, json.dumps(d))
        self.assertIsNone(self.run_hook({"hook_event_name": "UserPromptSubmit", "prompt": "hola"}))

    def test_bad_input_fails_open(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(hook.run("not json", self.state), 0)
        self.assertEqual(out.getvalue(), "")


class ColumnsTest(Base):
    def test_name_tokens_and_values_flag_columns_without_values(self):
        found = {f["column"]: f["reasons"] for f in columns.detect_csv(self.people)}
        self.assertIn("name_person_name", found["nombre"])
        self.assertIn("value_cedula", found["cedula"])
        self.assertIn("name_id", found["id_cliente"])
        self.assertNotIn("ciudad", found, "ciudad is not the ci token")
        self.assertNotIn("monto", found)
        self.assertNotIn(fx.cedula(1), json.dumps(found))


class PseudonymizeTest(Base):
    def test_keyed_deterministic_and_nulls_kept(self):
        key = pseudonymize.load_or_create_key(self.state / "privacy.key")
        self.assertEqual(stat.S_IMODE(os.stat(self.state / "privacy.key").st_mode) & 0o077, 0, "key is private")
        self.assertEqual(pseudonymize.load_or_create_key(self.state / "privacy.key"), key, "created once")
        a = pseudonymize.pseudonym("cedula", fx.cedula(1), key)
        self.assertEqual(a, pseudonymize.pseudonym("cedula", fx.cedula(1), key))
        self.assertRegex(a, r"^CEDULA_[0-9a-f]{12}$")
        self.assertNotEqual(a, pseudonymize.pseudonym("cedula", fx.cedula(1), b"other key" * 4))
        out = self.root / "out.csv"
        report = pseudonymize.pseudonymize_csv(self.people, out, ["cedula", "nombre"], key)
        with open(out, encoding="utf-8") as f:
            rows = list(csv.reader(f))
        self.assertEqual(rows[0], ["id_cliente", "nombre", "cedula", "ciudad", "monto"])
        self.assertTrue(all(r[2].startswith("CEDULA_") and r[1].startswith("NOMBRE_") for r in rows[1:]))
        self.assertEqual(rows[1][3], "Quito")
        self.assertEqual(report["rows"], 20)
        with self.assertRaises(ValueError):
            pseudonymize.pseudonymize_csv(self.people, out, ["missing"], key)


class CliTest(Base):
    def cli(self, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            code = main(list(args))
        return code, out.getvalue()

    def test_scan_reports_counts_and_columns_never_values(self):
        note = self.root / "work" / "nota.txt"
        note.write_text(f"llamar a {fx.mobile(3)}\ncedula {fx.cedula(3)}\n")
        code, text = self.cli("scan", str(note), str(self.people), "--json")
        self.assertEqual(code, 1, "findings exit 1")
        report = json.loads(text)
        self.assertEqual(report[0]["counts"], {"phone": 1, "cedula": 1})
        self.assertEqual([f["line"] for f in report[0]["findings"]], [1, 2])
        self.assertIn("cedula", [c["column"] for c in report[1]["columns"]])
        self.assertNotIn(fx.cedula(3), text)
        self.assertNotIn(fx.cedula(1), text)

    def test_redact_writes_a_new_file_and_pseudonymize_uses_the_state_key(self):
        note = self.root / "work" / "nota.txt"
        note.write_text(f"cedula {fx.cedula(3)}\n")
        code, _ = self.cli("redact", str(note), "-o", str(self.root / "nota.redacted.txt"))
        self.assertEqual(code, 0)
        self.assertEqual((self.root / "nota.redacted.txt").read_text(), "cedula [REDACTED_CEDULA]\n")
        self.assertIn(fx.cedula(3), note.read_text(), "the source is never changed")
        code, text = self.cli("pseudonymize", str(self.people), "--columns", "cedula", "-o", str(self.root / "p.csv"),
                              "--state-dir", str(self.state))
        self.assertEqual(code, 0, text)
        self.assertTrue((self.state / "privacy.key").exists())
        self.assertNotIn(fx.cedula(1), (self.root / "p.csv").read_text())


if __name__ == "__main__":
    unittest.main()
