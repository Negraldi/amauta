"""Extension registry (ADR 0009): extras are found by listing python/amauta/extras/ and are never imported statically."""
import tempfile
import unittest
from pathlib import Path

from python.amauta import extensions


class RegistryTest(unittest.TestCase):
    def test_points_are_collected_from_every_extra_package_in_a_directory(self):
        with tempfile.TemporaryDirectory() as d:
            for name, body in (("alpha", 'POINTS = {"demo.value": lambda x: x + 1}'), ("beta", 'POINTS = {"demo.value": lambda x: x * 10}'),
                               ("not_a_package", None)):
                p = Path(d) / name
                p.mkdir()
                if body is not None:
                    (p / "__init__.py").write_text(body)
            reg = extensions.Registry(Path(d), "fake_extras_pkg")
            self.assertEqual(sorted(reg.names()), ["alpha", "beta"])
            self.assertEqual(sorted(reg.collect("demo.value", 2)), [3, 20])
            self.assertIn(reg.call("demo.value", 2), (3, 20))
            self.assertEqual(reg.call("missing.point", 2, default="none"), "none")

    def test_a_missing_directory_or_a_broken_extra_gives_no_points(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "broken").mkdir()
            (Path(d) / "broken" / "__init__.py").write_text("raise RuntimeError('boom')")
            self.assertEqual(extensions.Registry(Path(d), "fake_extras_pkg2").names(), [])
        self.assertEqual(extensions.Registry(Path("/nonexistent-amauta-extras"), "x").collect("a"), [])

    def test_the_installed_registry_reads_python_amauta_extras(self):
        self.assertTrue(str(extensions.REGISTRY.root).endswith("extras"))
