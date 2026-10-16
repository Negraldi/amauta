import hashlib
import json
import os
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

from python.amauta.graph import pptx
from python.tests.test_semantic_plan import Base

NS = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def shape(paras, ph=None):
    nv = f'<p:nvPr><p:ph type="{ph}"/></p:nvPr>' if ph else "<p:nvPr/>"
    body = "".join("<a:p>" + "".join(f"<a:r><a:t>{t}</a:t></a:r>" for t in (p if isinstance(p, list) else [p])) + "</a:p>" for p in paras)
    return f'<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/>{nv}</p:nvSpPr><p:txBody><a:bodyPr/>{body}</p:txBody></p:sp>'


def slide_xml(*shapes):
    return f'<?xml version="1.0"?><p:sld {NS}><p:cSld><p:spTree>{"".join(shapes)}</p:spTree></p:cSld></p:sld>'


def notes_xml(*shapes):
    return f'<?xml version="1.0"?><p:notes {NS}><p:cSld><p:spTree>{"".join(shapes)}</p:spTree></p:cSld></p:notes>'


def rels(*pairs):
    items = "".join(f'<Relationship Id="{i}" Type="x/{t}" Target="{target}"/>' for i, t, target in pairs)
    return f'<?xml version="1.0"?><Relationships xmlns="{REL_NS}">{items}</Relationships>'


def make_pptx(path: Path, order=("rId2", "rId1")):
    """Two slides whose presentation order is the REVERSE of their file numbering; slide file 1 carries speaker notes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    sld_ids = "".join(f'<p:sldId id="{256 + i}" r:id="{r}"/>' for i, r in enumerate(order))
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("ppt/presentation.xml", f'<?xml version="1.0"?><p:presentation {NS}><p:sldIdLst>{sld_ids}</p:sldIdLst></p:presentation>')
        z.writestr("ppt/_rels/presentation.xml.rels", rels(("rId1", "slide", "slides/slide1.xml"), ("rId2", "slide", "slides/slide2.xml")))
        z.writestr("ppt/slides/slide1.xml", slide_xml(shape(["Quarterly plan"], "title"), shape([["Revenue ", "grows"], "Costs fall"]), shape(["7"], "sldNum")))
        z.writestr("ppt/slides/_rels/slide1.xml.rels", rels(("rId1", "notesSlide", "../notesSlides/notesSlide1.xml")))
        z.writestr("ppt/notesSlides/notesSlide1.xml", notes_xml(shape([""], "sldImg"), shape(["Say hello first"], "body"), shape(["1"], "sldNum")))
        z.writestr("ppt/slides/slide2.xml", slide_xml(shape(["Appendix"], "title"), shape(["Raw tables &amp; data"])))
    return path


class PptxToMarkdownTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def test_slides_follow_presentation_order_with_notes(self):
        text = pptx.pptx_to_markdown(make_pptx(self.dir / "deck.pptx"))
        self.assertLess(text.index("## Slide 1"), text.index("## Slide 2"))
        slide1, slide2 = text.split("## Slide 2")
        self.assertIn("Appendix", slide1)  # presentation order puts file slide2.xml first
        self.assertIn("Raw tables & data", slide1)
        self.assertIn("Quarterly plan", slide2)
        self.assertIn("Revenue grows", slide2)
        self.assertIn("Costs fall", slide2)
        self.assertIn("Say hello first", slide2)
        self.assertIn("Notes", slide2)
        self.assertNotIn("Notes", slide1)

    def test_slide_numbers_and_image_placeholders_are_not_text(self):
        text = pptx.pptx_to_markdown(make_pptx(self.dir / "deck.pptx"))
        self.assertNotRegex(text, r"(?m)^[-* ]*7$")

    def test_corrupt_or_hostile_files_yield_none(self):
        bad = self.dir / "bad.pptx"
        bad.write_bytes(b"not a zip")
        self.assertIsNone(pptx.pptx_to_markdown(bad))
        evil = self.dir / "evil.pptx"
        with zipfile.ZipFile(evil, "w") as z:
            z.writestr("ppt/slides/slide1.xml", '<!DOCTYPE x [<!ENTITY a "boom">]><p:sld xmlns:p="p" xmlns:a="a"><a:t>&a;</a:t></p:sld>')
        self.assertIsNone(pptx.pptx_to_markdown(evil))

    def test_oversized_member_is_refused(self):
        big = self.dir / "big.pptx"
        with zipfile.ZipFile(big, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("ppt/slides/slide1.xml", slide_xml(shape(["x" * (pptx.MAX_XML_BYTES + 10)])))
        self.assertIsNone(pptx.pptx_to_markdown(big))

    def test_without_presentation_xml_falls_back_to_numeric_order(self):
        p = self.dir / "min.pptx"
        with zipfile.ZipFile(p, "w") as z:
            z.writestr("ppt/slides/slide10.xml", slide_xml(shape(["ten"])))
            z.writestr("ppt/slides/slide2.xml", slide_xml(shape(["two"])))
        text = pptx.pptx_to_markdown(p)
        self.assertLess(text.index("two"), text.index("ten"))


class SidecarTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name).resolve() / "repo"
        self.repo.mkdir()

    def test_name_is_stem_plus_sha256_of_relative_path(self):
        src = make_pptx(self.repo / "talks" / "deck.pptx")
        (side,) = pptx.sync_sidecars(self.repo)
        expected = hashlib.sha256(b"talks/deck.pptx").hexdigest()[:8]
        self.assertEqual(side, self.repo / "graphify-out" / "converted" / f"deck_{expected}.md")
        self.assertTrue(side.read_text().startswith("<!-- converted from deck.pptx -->"))
        self.assertTrue(src.exists())

    def test_rewritten_only_when_the_source_is_newer(self):
        src = make_pptx(self.repo / "deck.pptx")
        (side,) = pptx.sync_sidecars(self.repo)
        side.write_text("marker")
        os.utime(side, (time.time() + 100, time.time() + 100))
        pptx.sync_sidecars(self.repo)
        self.assertEqual(side.read_text(), "marker")
        os.utime(src, (time.time() + 500, time.time() + 500))
        pptx.sync_sidecars(self.repo)
        self.assertIn("Quarterly plan", side.read_text())

    def test_only_regular_files_inside_the_repo_and_not_in_skipped_dirs(self):
        make_pptx(self.repo / "ok.pptx")
        make_pptx(self.repo / "node_modules" / "x" / "dep.pptx")
        make_pptx(self.repo / ".git" / "h.pptx")
        make_pptx(self.repo / "graphify-out" / "old.pptx")
        outside = make_pptx(Path(self.tmp.name) / "outside.pptx")
        (self.repo / "link.pptx").symlink_to(outside)
        (self.repo / "linkdir").symlink_to(Path(self.tmp.name), target_is_directory=True)
        os.mkfifo(self.repo / "fifo.pptx")
        names = [p.name for p in pptx.sync_sidecars(self.repo)]
        self.assertEqual(len(names), 1)
        self.assertTrue(names[0].startswith("ok_"))

    def test_oversized_source_is_skipped(self):
        make_pptx(self.repo / "huge.pptx")
        self.assertEqual(pptx.sync_sidecars(self.repo, max_bytes=10), [])

    def test_deck_without_text_makes_no_sidecar(self):
        with zipfile.ZipFile(self.repo / "empty.pptx", "w") as z:
            z.writestr("ppt/slides/slide1.xml", slide_xml())
        self.assertEqual(pptx.sync_sidecars(self.repo), [])


class PlanIncludesPptxTest(Base):
    def test_pptx_sidecar_is_planned_as_a_document(self):
        make_pptx(self.repo / "slides" / "deck.pptx")
        self.doc("docs/a.md")
        summary, plan = self.plan()
        files = [f for c in plan["chunks"] for f in c["files"]]
        side = [f for f in files if f.endswith(".md") and "converted" in f]
        self.assertEqual(len(side), 1)
        self.assertTrue(Path(side[0]).read_text().count("## Slide") == 2)
        self.assertIn(side[0], plan["all_files"])
        self.assertEqual(summary["files"], 2)

    def test_unchanged_pptx_keeps_one_sidecar_across_plans(self):
        make_pptx(self.repo / "deck.pptx")
        self.plan()
        before = {p: p.stat().st_mtime_ns for p in (self.repo / "graphify-out" / "converted").iterdir()}
        self.plan()
        after = {p: p.stat().st_mtime_ns for p in (self.repo / "graphify-out" / "converted").iterdir()}
        self.assertEqual(before, after)
        self.assertEqual(len(after), 1)


if __name__ == "__main__":
    unittest.main()
