"""T19e: the instruction blocks amauta writes to CLAUDE.md and AGENTS.md are catalog entries of their own kind
("instructions"), with the files and runtimes they are written to, what the block is for and its size."""
import json

from python.tests.test_portal_wiki_codex import CodexBase
from python.tests.test_portal_wiki_harness import HarnessBase, write

GUIDANCE = "## CodeGraph\n\nFor structural questions use CodeGraph first.\n\nSecond paragraph."
PERSONA = "Persona text, no heading.\n\nMore."
CLAUDE_MD = (f"# Mine\n\n<!-- amauta:codegraph-guidance -->\n{GUIDANCE}\n<!-- /amauta:codegraph-guidance -->\n"
             f"<!-- amauta:persona -->\n{PERSONA}\n<!-- /amauta:persona -->\n"
             "<!-- amauta:tiny -->\n## Only heading\n<!-- /amauta:tiny -->\n<!-- amauta:half -->\nno close\n")
AGENTS_MD = (f"<!-- amauta:codegraph-guidance -->\n{GUIDANCE}\n<!-- /amauta:codegraph-guidance -->\n"
             "<!-- amauta:orchestrator -->\nOrchestrate.\n<!-- /amauta:orchestrator -->\n")


class BlocksBase(CodexBase):
    def setUp(self):
        super().setUp()
        write(self.f["home"] / "CLAUDE.md", CLAUDE_MD)
        write(self.codex / "AGENTS.md", AGENTS_MD)


class InstructionBlocksCatalogTest(BlocksBase):
    def test_blocks_are_the_last_group_with_their_runtimes(self):
        cat = self.catalog()
        group = cat["groups"][-1]
        self.assertEqual((group["kind"], group["label"]), ("instructions", "Instruction blocks"))
        runtimes = {i["id"]: i["runtimes"] for i in group["items"]}
        self.assertEqual(runtimes, {"codegraph-guidance": ["claude", "codex"], "persona": ["claude"], "tiny": ["claude"],
                                    "orchestrator": ["codex"]})
        self.assertNotIn("half", runtimes, "a block without its closing marker is not listed")
        self.assertEqual(cat["total"], sum(len(g["items"]) for g in cat["groups"]))

    def test_the_description_is_the_first_paragraph_and_never_a_heading(self):
        items = self.items("instructions")
        self.assertEqual(items["codegraph-guidance"]["description"], "For structural questions use CodeGraph first.")
        self.assertEqual(items["persona"]["description"], "Persona text, no heading.")
        self.assertIsNone(items["tiny"]["description"], "a heading is not a description")

    def test_the_item_page_says_where_it_is_written_and_how_big_it_is(self):
        pg = self.page("instructions", "codegraph-guidance")
        self.assertEqual(pg["title"], "codegraph-guidance")
        self.assertEqual(pg["body_md"], "## CodeGraph\n\nSecond paragraph.", "the paragraph that is the description is not said twice")
        m = self.meta(pg)
        self.assertEqual(m["Runtime"], "Claude Code, Codex")
        self.assertEqual(m["Size in CLAUDE.md (characters)"], str(len(GUIDANCE)))
        self.assertEqual(m["Size in AGENTS.md (characters)"], str(len(GUIDANCE)))
        self.assertEqual(pg["summary"]["description"], "For structural questions use CodeGraph first.")
        written = next(s for s in pg["sections"] if s["heading"] == "Configured in")
        self.assertEqual([i["label"] for i in written["items"]], [str(self.f["home"] / "CLAUDE.md"), str(self.codex / "AGENTS.md")])
        self.assertEqual([i["value"] for i in written["items"]], ["Your Claude home", "Your Codex home"])
        self.assertNotIn("explain", pg)

    def test_a_block_in_one_file_has_one_size_row_and_one_runtime(self):
        pg = self.page("instructions", "persona")
        m = self.meta(pg)
        self.assertEqual(m["Runtime"], "Claude Code")
        self.assertEqual(m["Size in CLAUDE.md (characters)"], str(len(PERSONA)))
        self.assertNotIn("Size in AGENTS.md (characters)", m)
        self.assertEqual(self.meta(self.page("instructions", "orchestrator"))["Runtime"], "Codex")

    def test_an_unknown_block_is_a_404_and_blocks_are_searchable(self):
        self.assertEqual(self.status("/api/wiki/page", kind="instructions", id="nope"), 404)
        found = self.get("/api/wiki/search", q="CodeGraph")
        hits = [i for g in found["groups"] for i in g["items"] if i["kind"] == "instructions"]
        self.assertEqual([h["id"] for h in hits], ["codegraph-guidance"])

    def test_a_symlinked_instruction_file_is_not_read(self):
        target = self.root / "elsewhere.md"
        write(target, "<!-- amauta:evil -->\nx\n<!-- /amauta:evil -->\n")
        (self.f["home"] / "CLAUDE.md").unlink()
        (self.f["home"] / "CLAUDE.md").symlink_to(target)
        self.assertNotIn("evil", self.items("instructions"))
        self.assertNotIn("persona", self.items("instructions"))

    def test_fixed_texts_have_a_spanish_entry(self):
        from python.tests.test_portal_i18n import catalog, covered
        keys = catalog()
        pg = self.page("instructions", "codegraph-guidance")
        texts = ["Instruction blocks"] + [m["label"] for m in pg["meta"]] + [pg["summary"]["source"], pg["summary"]["when"]]
        self.assertEqual(sorted(t for t in texts if t and not covered(t, keys)), [])
        json.dumps(pg)


LISTY = "- Never add a thing.\n- Never agree with a claim.\n\nAfter."
HEADED = "## Rules\n\n- First rule.\n- Second rule."


class InstructionBlocksReviewTest(BlocksBase):
    """T19h F5: Runtime row, every file as an origin, no repeated paragraph, no glued bullets."""

    def setUp(self):
        super().setUp()
        write(self.f["home"] / "CLAUDE.md", CLAUDE_MD + f"<!-- amauta:listy -->\n{LISTY}\n<!-- /amauta:listy -->\n"
              f"<!-- amauta:headed -->\n{HEADED}\n<!-- /amauta:headed -->\n")

    def test_the_summary_names_every_file_the_block_is_written_to(self):
        both = self.page("instructions", "codegraph-guidance")["summary"]["origins"]
        self.assertEqual(both, [{"source": "Your Claude home", "path": str(self.f["home"] / "CLAUDE.md")},
                                {"source": "Your Codex home", "path": str(self.codex / "AGENTS.md")}])
        self.assertEqual(len(self.page("instructions", "persona")["summary"]["origins"]), 1)

    def test_every_page_has_a_runtime_row(self):
        for ident in ("codegraph-guidance", "persona", "tiny", "orchestrator", "listy", "headed"):
            self.assertIn("Runtime", self.meta(self.page("instructions", ident)), ident)

    def test_a_block_without_prose_has_no_description_and_the_page_omits_it(self):
        items = self.items("instructions")
        self.assertIsNone(items["listy"]["description"])
        self.assertIsNone(items["headed"]["description"], "never the bare heading")
        self.assertIsNone(self.page("instructions", "headed")["summary"]["description"])
        self.assertEqual(self.page("instructions", "listy")["body_md"], LISTY, "a list description is not a paragraph to drop")

    def test_the_description_paragraph_leaves_the_body_only_when_it_is_the_description(self):
        self.assertEqual(self.page("instructions", "persona")["body_md"], "More.")
        self.assertEqual(self.page("instructions", "tiny")["body_md"], "## Only heading")


class NoCodexBlocksTest(HarnessBase):
    def test_without_a_codex_home_blocks_belong_to_claude_code(self):
        write(self.f["home"] / "CLAUDE.md", CLAUDE_MD)
        items = self.items("instructions")
        self.assertEqual(set(items), {"codegraph-guidance", "persona", "tiny"})
        self.assertTrue(all(i["runtimes"] == ["claude"] for i in items.values()))

    def test_no_instruction_files_means_no_group(self):
        self.assertNotIn("instructions", [g["kind"] for g in self.catalog()["groups"]])
