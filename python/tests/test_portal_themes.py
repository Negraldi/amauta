import json
import os
import tempfile
import unittest
from pathlib import Path

from python.amauta.portal import themes
from python.tests.test_portal_server import ServerBase

LIGHT = {"name": "Paper", "base": "light", "tokens": {"bg": "oklch(0.98 0.01 90)", "accent": "#0a6e78"}}
TOKENS = ["bg", "surface", "sidebar", "ink", "ink-muted", "line", "accent", "accent-soft", "warn", "ok", "c-input", "c-output", "c-cache-read", "c-cache-write"]


def body(slug="paper", **over):
    return {"slug": slug, **{**LIGHT, **over}}


class ThemeStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)

    def snapshot(self):
        d = self.state / "themes"
        return sorted(p.name for p in d.iterdir()) if d.exists() else []

    def reject(self, status, data, code=None):
        before = self.snapshot()
        with self.assertRaises(themes.ThemeError) as ctx:
            themes.write_theme(self.state, data)
        self.assertEqual(ctx.exception.status, status, ctx.exception.message)
        if code:
            self.assertEqual(ctx.exception.code, code)
        self.assertEqual(self.snapshot(), before, "a rejected write leaves nothing behind")

    def test_the_allowed_tokens_are_exactly_the_design_table(self):
        self.assertEqual(list(themes.TOKENS), TOKENS)
        self.assertEqual(themes.list_themes(self.state), {"themes": [], "tokens": TOKENS, "max": 50})

    def test_a_valid_theme_is_written_atomically_and_listed(self):
        out = themes.write_theme(self.state, body(tokens={"bg": "OKLCH(0.98 0.01 90)".lower(), "accent": "#0A6E78"}))
        self.assertEqual(json.loads((self.state / "themes" / "paper.json").read_text()), {"name": "Paper", "base": "light", "tokens": {"bg": "oklch(0.98 0.01 90)", "accent": "#0a6e78"}})
        self.assertEqual([t["slug"] for t in out["themes"]], ["paper"])
        self.assertEqual(out["themes"][0]["tokens"]["accent"], "#0a6e78")
        self.assertEqual([p.name for p in (self.state / "themes").iterdir()], ["paper.json"], "no temp file is left")

    def test_update_replaces_and_empty_tokens_fall_back_to_the_base(self):
        themes.write_theme(self.state, body())
        out = themes.write_theme(self.state, body(name="Paper 2", base="dark", tokens={}))
        self.assertEqual(out["themes"], [{"slug": "paper", "name": "Paper 2", "base": "dark", "tokens": {}}])

    def test_every_token_is_accepted_and_unknown_ones_are_not(self):
        themes.write_theme(self.state, body(tokens={t: "#112233" for t in TOKENS}))
        self.reject(400, body("other", tokens={"bg": "#112233", "color": "#112233"}), "theme.token")
        self.reject(400, body("other", tokens={"--bg": "#112233"}), "theme.token")

    def test_only_oklch_and_hex_values_pass(self):
        for good in ("oklch(0.5 0.1 200)", "oklch(1 0 0)", "oklch(0 0 360)", "oklch(.5 .1 .5)", "#abcdef", "#ABCDEF", "oklch(0.5   0.1  200)"):
            themes.write_theme(self.state, body("good", tokens={"bg": good}))
        for bad in ("red", "#fff", "#abcdeg", "#abcdef00", "oklch(1 0)", "oklch(1 0 0 0)", "oklch(1.1 0 0)", "oklch(0.5 0.6 0)", "oklch(0.5 0.1 361)", "oklch(-1 0 0)",
                    "oklch(50% 0.1 200)", "oklch(0.5 0.1 200 / 0.5)", "rgb(1,2,3)", "url(http://x)", "var(--ink)", "oklch(0.5 0.1 200); color: red", "oklch(0.5 0.1 200)}", "", " ", "oklch(0.5,0.1,200)", "oklch(0.5 0.1 1e2)"):
            self.reject_value(bad)
        for odd in (5, None, ["#abcdef"], {"a": 1}, True):
            self.reject_value(odd)

    def reject_value(self, value):
        with self.assertRaises(themes.ThemeError, msg=repr(value)) as ctx:
            themes.write_theme(self.state, body("bad", tokens={"bg": value}))
        self.assertEqual((ctx.exception.status, ctx.exception.code), (400, "theme.value"), repr(value))
        self.assertFalse((self.state / "themes" / "bad.json").exists())

    def test_slug_is_confined_to_a_plain_name(self):
        for slug in ("../x", "a/b", "a\\b", "A", "a b", "", "-a", "a.json", "a" * 41, "..", ".", "é", "a\x00", None, 5, "con\n"):
            with self.assertRaises(themes.ThemeError, msg=repr(slug)) as ctx:
                themes.write_theme(self.state, body(slug))
            self.assertEqual((ctx.exception.status, ctx.exception.code), (400, "theme.slug"), repr(slug))
        themes.write_theme(self.state, body("a" * 40))
        themes.write_theme(self.state, body("0-9-a"))
        self.assertFalse((Path(self.tmp.name) / "x.json").exists())

    def test_name_base_and_shape_are_checked(self):
        self.reject(400, body("n", name=""), "theme.name")
        self.reject(400, body("n", name="x" * 61), "theme.name")
        self.reject(400, body("n", name=5), "theme.name")
        self.reject(400, body("n", name="line\nbreak"), "theme.name")
        themes.write_theme(self.state, body("ok", name="x" * 60))
        self.reject(400, body("n", base="blue"), "theme.base")
        self.reject(400, body("n", tokens=[]), "theme.shape")
        self.reject(400, {**body("n"), "extra": 1}, "theme.shape")
        self.reject(400, {"slug": "n", "name": "x", "base": "light"}, "theme.shape")
        self.reject(400, [], "theme.shape")

    def test_at_most_fifty_themes_but_updates_still_work(self):
        for i in range(50):
            themes.write_theme(self.state, body(f"t{i}"))
        with self.assertRaises(themes.ThemeError) as ctx:
            themes.write_theme(self.state, body("one-more"))
        self.assertEqual((ctx.exception.status, ctx.exception.code), (409, "theme.limit"))
        themes.write_theme(self.state, body("t7", name="Renamed"))
        self.assertEqual(len(themes.list_themes(self.state)["themes"]), 50)

    def test_invalid_files_are_listed_with_an_error_and_never_applied(self):
        d = self.state / "themes"
        d.mkdir()
        (d / "broken.json").write_text("{nope")
        (d / "unknown.json").write_text(json.dumps({"name": "U", "base": "dark", "tokens": {"bg": "red"}}))
        (d / "extra.json").write_text(json.dumps({"name": "U", "base": "dark", "tokens": {}, "x": 1}))
        (d / "huge.json").write_text(json.dumps({"name": "U", "base": "dark", "tokens": {}, "pad": "x" * 40000}))
        (d / "Not A Slug.json").write_text(json.dumps(LIGHT))
        (d / "notes.txt").write_text("hi")
        themes.write_theme(self.state, body("good"))
        by = {t["slug"]: t for t in themes.list_themes(self.state)["themes"]}
        self.assertEqual(sorted(by), ["broken", "extra", "good", "huge", "unknown"])
        for slug in ("broken", "extra", "huge", "unknown"):
            self.assertIn("error", by[slug], slug)
            self.assertTrue(by[slug]["code"].startswith("theme."), slug)
            self.assertNotIn("tokens", by[slug], slug)
        self.assertNotIn("error", by["good"])

    def test_a_symlinked_theme_file_is_never_read_written_or_deleted(self):
        outside = Path(self.tmp.name) / "outside.json"
        outside.write_text(json.dumps(LIGHT))
        d = self.state / "themes"
        d.mkdir()
        (d / "link.json").symlink_to(outside)
        listed = themes.list_themes(self.state)["themes"]
        self.assertEqual([("link", "error" in t) for t in listed], [("link", True)])
        for call in (lambda: themes.write_theme(self.state, body("link")), lambda: themes.delete_theme(self.state, "link")):
            with self.assertRaises(themes.ThemeError):
                call()
        self.assertEqual(json.loads(outside.read_text()), LIGHT)
        self.assertTrue((d / "link.json").is_symlink())

    def test_a_symlinked_themes_directory_is_refused(self):
        real = Path(self.tmp.name) / "elsewhere"
        real.mkdir()
        (self.state / "themes").symlink_to(real, target_is_directory=True)
        with self.assertRaises(themes.ThemeError):
            themes.write_theme(self.state, body())
        self.assertEqual(list(real.iterdir()), [])
        self.assertEqual(themes.list_themes(self.state)["themes"], [])

    def test_delete(self):
        themes.write_theme(self.state, body())
        self.assertEqual(themes.delete_theme(self.state, "paper")["themes"], [])
        self.assertFalse((self.state / "themes" / "paper.json").exists())
        for slug, status in (("paper", 404), ("../paper", 400), ("", 400), (5, 400)):
            with self.assertRaises(themes.ThemeError) as ctx:
                themes.delete_theme(self.state, slug)
            self.assertEqual(ctx.exception.status, status, repr(slug))


class ThemeHttpTest(ServerBase):
    def post(self, path, data, token=True, origin=None, ctype="application/json", raw=None, extra=None):
        h = {"Content-Type": ctype, **(extra or {})}
        if token:
            h["X-Portal-Token"] = self.token()
        if origin:
            h["Origin"] = origin
        return self.request("POST", path, headers=h, body=raw if raw is not None else json.dumps(data).encode())

    def themes_dir(self):
        return self.cfg.state_dir / "themes"

    def test_get_lists_the_themes_and_the_token_names(self):
        status, h, data = self.request("GET", "/api/themes")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data), {"themes": [], "tokens": TOKENS, "max": 50})
        self.assertEqual(self.post("/api/themes", body())[0], 200)
        self.assertEqual(json.loads(self.request("GET", "/api/themes")[2])["themes"][0]["name"], "Paper")

    def test_a_guarded_write_creates_updates_and_deletes(self):
        status, _, data = self.post("/api/themes", body())
        self.assertEqual(status, 200, data)
        self.assertEqual(json.loads(data)["themes"][0]["slug"], "paper")
        self.assertEqual(self.post("/api/themes", body(name="Renamed"))[0], 200)
        self.assertEqual(json.loads((self.themes_dir() / "paper.json").read_text())["name"], "Renamed")
        status, _, data = self.post("/api/themes/delete", {"slug": "paper"})
        self.assertEqual((status, json.loads(data)["themes"]), (200, []))
        self.assertEqual(self.post("/api/themes/delete", {"slug": "paper"})[0], 404)

    def refused(self, path, status, data=None, **kw):
        s, _, out = self.post(path, data, **kw)
        self.assertEqual(s, status, out)
        self.assertFalse(self.themes_dir().exists() and list(self.themes_dir().iterdir()), "a refused request writes nothing")
        return json.loads(out)

    def test_the_request_guards_apply_to_both_writes(self):
        for path in ("/api/themes", "/api/themes/delete"):
            self.refused(path, 403, body(), token=False)
            self.refused(path, 403, body(), origin="http://evil.example")
            self.refused(path, 403, body(), extra={"Sec-Fetch-Site": "cross-site"})
            self.refused(path, 415, body(), ctype="text/plain")
            self.refused(path, 400, raw=b"not json")
            self.refused(path, 400, [body()])
            self.assertEqual(self.request("POST", path, headers={"Host": "evil.example", "Content-Type": "application/json"}, body=b"{}")[0], 403)

    def test_bad_values_and_big_bodies_are_rejected_with_a_code(self):
        out = self.refused("/api/themes", 400, body(tokens={"bg": "url(http://evil)"}))
        self.assertEqual((out["code"], out["token"]), ("theme.value", "bg"))
        self.assertIn("error", out)
        self.refused("/api/themes", 413, raw=json.dumps(body(name="x", tokens={"bg": "#112233"}) | {"pad": "x" * 20000}).encode())
        self.refused("/api/themes", 400, body("../escape"))
        self.assertFalse((Path(self.tmp.name) / "escape.json").exists())

    def test_other_verbs_stay_refused_and_get_is_not_a_write(self):
        self.assertEqual(self.request("DELETE", "/api/themes/delete")[0], 405)
        self.assertEqual(self.request("PUT", "/api/themes")[0], 405)
        self.assertEqual(self.request("GET", "/api/themes/delete")[0], 404)

    def test_static_files_are_served(self):
        self.assertEqual(self.request("GET", "/static/theme.js")[0], 200)


if __name__ == "__main__":
    unittest.main()
