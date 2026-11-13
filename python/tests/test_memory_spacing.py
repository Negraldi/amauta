"""The unspaced-text detector: two real bodies saved without spaces are caught; ordinary notes are left alone."""
import unittest

from python.amauta.memory import spacing

# Real bodies saved by one agent session (2026-11). The first is quoted as stored; the second sample was only 21 letters,
# below the length floor on purpose, so it is tested both alone (not judged) and as the start of a body of the same style.
REAL_LONG = ("AvoidableRootROpreflight requestedper-parentworldreadsagainstLIVEglobalowner_fold/folded_cells.sqlite. "
             "Globalcells_parentindexiscreatedONLYatENDparallel_assembly")
REAL_SHORT = "Useronmobilecan'tseeHTML"
SHORT_STYLE = (REAL_SHORT + "artifacts;sendplaintextsummariesinsteadandlinkthefileonlywhenasked.Usemarkdowntables"
               "sparinglybecausetheyoverflowonnarrowscreens.")

NEGATIVE = {
    "english prose": ("The portal reads memories from the own store and never from the engram database. When the store is "
                      "missing, the page explains how to create it and links to the install guide."),
    "spanish prose": ("La memoria guarda decisiones, hallazgos y convenciones del proyecto. Cuando una nota se actualiza con el "
                      "mismo tema, el servidor incrementa la revisión y conserva la fecha de creación original."),
    "terse note": "Use WAL. Readers never block. Checked on 2026-11-09 with two writers and one reader; no busy errors seen.",
    "markdown table": ("| Route | Page | Notes |\n|---|---|---|\n| #/memory | Memory browser | lists observations |\n"
                       "| #/lint | Quality | conservative checks |\n| #/node | Graph node | neighbours and file |"),
    "bullet list of paths": ("Files touched:\n- python/amauta/portal/static/page-memory.js\n- python/amauta/portal/wikilint.py\n"
                             "- python/amauta/memory/server.py\n- test/helpers/portalboot.js\n- docs/memory-and-usage.md"),
    "json snippet": ('{"title":"Use WAL","content":"journal_mode=WAL for readers","type":"decision",'
                     '"topic_key":"decision/wal","project":"demo","scope":"project"}'),
    "stack trace": ('Traceback (most recent call last):\n  File "/home/dev/amauta/python/amauta/memory/server.py", line 180, '
                    'in handle\n    text = _run(store, tool["name"], args)\nKeyError: \'content\''),
    "title-only note": "Session closed",
    "chinese sentence": ("内存服务器把每条笔记保存在本地数据库中，标题和正文都会经过隐私检查，然后才写入磁盘。"
                         "如果发现密钥，整条笔记会被拒绝。"),
    "one long path": ("/home/developer/projects/amauta-portal-redesign/python/amauta/portal/static/i18n/"
                      "server-strings/spanish-translations/srv-es.json"),
    "fenced code": ("Fix:\n```python\ndef handle(store,msg):return _result(msg.get('id'),{'content':[{'type':'text','text':"
                    "_run(store,msg['params']['name'],msg['params']['arguments'])}]})\n```\nThe server now keeps going."),
    "url heavy": ("See https://example.com/docs/memory/guard-and-redaction-rules-for-observations-and-prompts and "
                  "https://example.com/adr/0007-memory-guard-always-on-for-every-store-write for the details."),
    "identifier list": ("Renamed: AuthenticationMiddleware, UserRepositoryImplementation, parse_observation_payload, "
                        "MemoryStoreConnectionFactory and getUserProfileByIdentifier."),
    "german compounds": ("Die Speicherverwaltungsschicht schreibt jede Notiz in die lokale Datenbank. Die "
                         "Datenschutzprüfung entfernt personenbezogene Kennungen vor dem Speichern."),
}


class UnspacedTest(unittest.TestCase):
    def test_real_bodies_saved_without_spaces_are_caught(self):
        self.assertTrue(spacing.looks_unspaced(REAL_LONG))
        self.assertTrue(spacing.looks_unspaced(SHORT_STYLE))

    def test_the_short_real_sample_alone_is_too_short_to_judge(self):
        self.assertFalse(spacing.looks_unspaced(REAL_SHORT))

    def test_ordinary_notes_are_not_flagged(self):
        for name, text in NEGATIVE.items():
            with self.subTest(name):
                self.assertFalse(spacing.looks_unspaced(text), spacing.measure(text))

    def test_empty_and_none(self):
        self.assertFalse(spacing.looks_unspaced(""))
        self.assertFalse(spacing.looks_unspaced(None))

    def test_measure_reports_the_numbers_it_judged(self):
        m = spacing.measure(REAL_LONG)
        self.assertGreaterEqual(m["letters"], spacing.MIN_LETTERS)
        self.assertGreaterEqual(m["letters_per_word"], spacing.MIN_LETTERS_PER_WORD)
        self.assertGreaterEqual(m["long_run_share"], spacing.MIN_LONG_RUN_SHARE)


if __name__ == "__main__":
    unittest.main()
