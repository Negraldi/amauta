"""The detector catalog (plan D2, ADR 0007): validators, secrets and one text scan with one finding format.

Every identifier is generated (detector_fixtures); a finding never carries the matched value.
"""

import unittest

from python.amauta.detectors import scan, secretlike, validators as v
from python.tests import detector_fixtures as fx

SEEDS = range(1, 41)


class ValidatorTest(unittest.TestCase):
    def test_cedula(self):
        for s in SEEDS:
            self.assertTrue(v.is_cedula(fx.cedula(s)), fx.cedula(s))
            self.assertFalse(v.is_cedula(fx.broken(fx.cedula(s))))
        self.assertFalse(v.is_cedula("123456789"))      # length
        self.assertFalse(v.is_cedula("2560000000"))     # province 25
        self.assertFalse(v.is_cedula("０９１２３４５６７８"))  # non-ASCII digits

    def test_ruc_natural_juridical_and_public(self):
        for s in SEEDS:
            for make in (fx.ruc_natural, fx.ruc_juridical, fx.ruc_public):
                self.assertTrue(v.is_ruc(make(s)), (make.__name__, make(s)))
            self.assertFalse(v.is_ruc(fx.cedula(s) + "000"))  # establishment 000 does not exist
        bad = fx.ruc_juridical(3)
        self.assertFalse(v.is_ruc(bad[:9] + str((int(bad[9]) + 1) % 10) + bad[10:]), "juridical check digit")

    def test_card_iban_email_phone(self):
        for s in SEEDS:
            self.assertTrue(v.is_card(fx.card(s)))
            self.assertFalse(v.is_card(fx.broken(fx.card(s))))
            self.assertTrue(v.is_iban(fx.iban(s)), fx.iban(s))
            self.assertFalse(v.is_iban(fx.broken(fx.iban(s))))
            self.assertTrue(v.is_ec_phone(fx.mobile(s)))
        self.assertTrue(v.is_iban(" ".join(fx.iban(5)[i:i + 4] for i in range(0, 22, 4))), "grouped by four")
        self.assertTrue(v.is_ec_phone("+593 " + fx.mobile(2)[1:]))
        self.assertTrue(v.is_ec_phone("022345678"))
        self.assertFalse(v.is_ec_phone("0812345678"))
        self.assertTrue(v.is_email("ana.perez@example.org"))
        self.assertFalse(v.is_email("not an email@"))


class SecretTest(unittest.TestCase):
    CASES = ["sk-ant-" + "A1b2C3d4" * 4, "Bearer " + "x" * 30, "-----BEGIN RSA PRIVATE KEY-----", "AKIA" + "Q" * 16,
             "ghp_" + "a1" * 18, "xoxb-" + "1" * 12 + "-abcdef", "AIza" + "B" * 35, "password = hunter2hunter2"]

    def test_known_secret_shapes(self):
        for text in self.CASES:
            self.assertTrue(secretlike.contains_secret(f"before {text} after"), text)
        for text in ("password = short", "the token is in the vault", "sk-short", "Bearer of bad news"):
            self.assertFalse(secretlike.contains_secret(text), text)


class ScanTest(unittest.TestCase):
    def test_one_finding_format_with_offsets_and_no_values(self):
        c, e = fx.cedula(7), "ana@example.org"
        text = f"cliente {c} escribe a {e}"
        found = scan.scan(text)
        self.assertEqual([f["kind"] for f in found], ["cedula", "email"])
        for f in found:
            self.assertEqual(set(f), {"kind", "start", "end"})
        self.assertEqual(text[found[0]["start"]:found[0]["end"]], c)

    def test_every_kind_is_found_and_redacted(self):
        parts = {"cedula": fx.cedula(2), "ruc": fx.ruc_juridical(2), "card": fx.card(2), "iban": fx.iban(2),
                 "phone": fx.mobile(2), "email": "x.y@example.com", "secret": "AKIA" + "Z" * 16}
        text = " | ".join(parts.values())
        out, counts = scan.redact(text)
        self.assertEqual(counts, {k: 1 for k in scan.KINDS})
        for kind, value in parts.items():
            self.assertNotIn(value, out, kind)
            self.assertIn(f"[REDACTED_{kind.upper()}]", out)

    def test_no_partial_match_inside_longer_numbers_or_words(self):
        c = fx.cedula(9)
        for text in (c + "4", "ID" + c, "1" + c, c.replace(c[4], c[4] + "x", 1)):
            self.assertEqual([f for f in scan.scan(text) if f["kind"] == "cedula"], [], text)
        self.assertEqual(scan.scan(fx.broken(fx.cedula(9))), [])

    def test_kinds_filter_and_counts(self):
        text = f"{fx.cedula(1)} {fx.cedula(2)} a@b.co"
        self.assertEqual([f["kind"] for f in scan.scan(text, kinds={"email"})], ["email"])
        self.assertEqual(scan.counts(scan.scan(text)), {"cedula": 2, "email": 1})


if __name__ == "__main__":
    unittest.main()


class SecretsCliTest(unittest.TestCase):
    def test_lines_and_columns_without_the_value_and_binary_skipped(self):
        import tempfile
        from pathlib import Path
        from python.amauta.detectors import __main__ as cli
        with tempfile.TemporaryDirectory() as tmp:
            text = Path(tmp) / "a.cfg"
            text.write_text("x = 1\nkey = " + "AKIA" + "Z" * 16 + "\n")
            found = cli.secrets_in(text)
            self.assertEqual([(f["line"], f["col"]) for f in found], [(2, 7)])
            self.assertNotIn("AKIA", str(found))
            binary = Path(tmp) / "b.bin"
            binary.write_bytes(b"\0AKIA" + b"Z" * 16)
            self.assertEqual(cli.secrets_in(binary), [])
