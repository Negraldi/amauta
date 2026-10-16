import contextlib
import io
import json
import unittest

from python.amauta.graph import semantic_plan as sp

from .test_semantic_plan import Base


class CacheSymlinkTest(Base):
    def test_plan_replaces_a_symlinked_cache_file_instead_of_writing_through_it(self):
        self.doc("docs/a.md")
        victim = self.repo.parent / "victim.txt"
        victim.write_text("keep me")
        out = self.repo / "graphify-out"
        out.mkdir(exist_ok=True)
        link = sp.cached_file(self.repo)
        link.symlink_to(victim)
        buf, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
            code = sp.main(["plan", "--repo", str(self.repo), "--graphify-bin", str(self.fake.exe), "--skip-update"])
        self.assertEqual(code, 0, err.getvalue())
        self.assertEqual(victim.read_text(), "keep me", "the symlink target outside the repo is untouched")
        self.assertFalse(link.is_symlink())
        json.loads(link.read_text())


if __name__ == "__main__":
    unittest.main()
