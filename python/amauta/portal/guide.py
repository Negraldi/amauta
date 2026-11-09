"""The guide (odd/tasks/portal-guide.md): Markdown pages that explain each part of amauta, shipped with the portal in
`guide/<lang>/<slug>.md`. Each page has five sections (what it is made of, how the parts relate, how you use it,
scripts and commands, how it works) and Mermaid diagrams, rendered by the portal's safe Markdown subset.

A request names a slug and a language; the slug must be one of SLUGS (it is never joined into a path as given), and a
language without that page falls back to English. Read-only.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent / "guide"
SLUGS = ("overview", "kernel", "install", "odd", "portal", "data-security", "code-security", "pipelines", "siblings",
         "extras")
LANGS = ("en", "es")


def _lang(q):
    lang = str((q or {}).get("lang") or "en")
    return lang if lang in LANGS else "en"


def _read(slug, lang):
    for code in (lang, "en"):
        f = ROOT / code / f"{SLUGS[SLUGS.index(slug)]}.md"  # the name comes from SLUGS, never from the request
        if f.is_file():
            return code, f.read_text(encoding="utf-8")
    from .api import NotFound  # here, not at the top: api imports this module
    raise NotFound(f"no guide page {slug}")


def _title(markdown):
    return next((line[2:].strip() for line in markdown.splitlines() if line.startswith("# ")), "")


def index(portal, q):
    lang = _lang(q)
    return {"lang": lang, "pages": [{"slug": s, "title": _title(_read(s, lang)[1])} for s in SLUGS]}


def page(portal, q):
    slug = str((q or {}).get("slug") or "")
    if slug not in SLUGS:
        from .api import NotFound
        raise NotFound("no such guide page")
    lang, text = _read(slug, _lang(q))
    return {"slug": slug, "lang": lang, "title": _title(text), "markdown": text}
