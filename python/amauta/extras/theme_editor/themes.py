"""Custom portal themes: one JSON file per theme in `<state_dir>/themes/<slug>.json`.

Schema (closed): {"name": str <= 60, "base": "light" | "dark", "tokens": {<token>: <value>}}. The tokens are exactly the colors of docs/DESIGN.md; a
value is `oklch(L C H)` with numeric ranges or `#rrggbb`, nothing else (so no value can carry other CSS). Missing tokens fall back to the base
theme in the browser. The slug is a plain name (never a path), the directory is never a symlink, theme files are never followed when they are
links, at most MAX_THEMES exist, and every file is written atomically. Invalid files that were dropped in by hand are listed with an error and
never applied. Errors carry a stable `code` the client translates; `error` is the English fallback.
"""
from __future__ import annotations

import json
import os
import re
import stat
import tempfile
import threading
from pathlib import Path

DIR_NAME = "themes"
TOKENS = ("bg", "surface", "sidebar", "ink", "ink-muted", "line", "accent", "accent-soft", "warn", "ok", "c-input", "c-output", "c-cache-read", "c-cache-write")
MAX_THEMES = 50
MAX_FILE = 16384
MAX_NAME = 60
SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,39}")
_NUM = r"(?:\d+(?:\.\d+)?|\.\d+)"
OKLCH = re.compile(rf"oklch\(\s*({_NUM})\s+({_NUM})\s+({_NUM})\s*\)", re.IGNORECASE)
HEX = re.compile(r"#[0-9a-fA-F]{6}")
RANGES = ((0.0, 1.0), (0.0, 0.5), (0.0, 360.0))  # lightness, chroma, hue
_LOCK = threading.Lock()


class ThemeError(Exception):
    def __init__(self, message, status=400, code="theme.invalid", token=None):
        super().__init__(message)
        self.message, self.status, self.code, self.token = message, status, code, token

    def body(self):
        out = {"error": self.message, "code": self.code}
        if self.token:
            out["token"] = self.token
        return out


def valid_slug(value) -> bool:
    return isinstance(value, str) and SLUG.fullmatch(value) is not None


def check_value(token, value) -> str:
    """The normalized value (lower case, single spaces) or ThemeError."""
    if isinstance(value, str) and len(value) <= 40:
        if HEX.fullmatch(value):
            return value.lower()
        m = OKLCH.fullmatch(value.strip()) if value == value.strip() else None
        if m and all(lo <= float(g) <= hi for g, (lo, hi) in zip(m.groups(), RANGES)):
            return "oklch(" + " ".join(m.groups()) + ")"
    raise ThemeError(f"{token}: use oklch(L C H) with L 0-1, C 0-0.5, H 0-360, or #rrggbb", 400, "theme.value", token)


def check_theme(data, with_slug=False):
    """Validate {name, base, tokens} (plus slug when `with_slug`); returns the normalized theme without the slug."""
    keys = {"slug", "name", "base", "tokens"} if with_slug else {"name", "base", "tokens"}
    if not isinstance(data, dict) or set(data) != keys or not isinstance(data["tokens"], dict):
        raise ThemeError("a theme is an object with exactly " + ", ".join(sorted(keys)) + " (tokens is an object)", 400, "theme.shape")
    if with_slug and not valid_slug(data["slug"]):
        raise ThemeError("slug must be 1-40 characters: a-z, 0-9 and hyphens, not starting with a hyphen", 400, "theme.slug")
    name = data["name"]
    if not isinstance(name, str) or not name.strip() or len(name) > MAX_NAME or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise ThemeError(f"name must be 1-{MAX_NAME} characters without control characters", 400, "theme.name")
    if data["base"] not in ("light", "dark"):
        raise ThemeError("base must be light or dark", 400, "theme.base")
    tokens = {}
    for key, value in data["tokens"].items():
        if key not in TOKENS:
            raise ThemeError(f"unknown token: {str(key)[:40]}", 400, "theme.token", str(key)[:40])
        tokens[key] = check_value(key, value)
    return {"name": name.strip(), "base": data["base"], "tokens": tokens}


def _dir(state_dir) -> Path:
    return Path(state_dir) / DIR_NAME


def _plain_dir(d: Path) -> bool:
    try:
        return stat.S_ISDIR(os.lstat(d).st_mode)
    except OSError:
        return False


def _files(d: Path):
    """Slugs of the regular `<slug>.json` entries (symlinks included so they can be reported), sorted, bounded."""
    out = []
    if not _plain_dir(d):
        return out
    try:
        names = sorted(os.listdir(d))
    except OSError:
        return out
    for name in names:
        if name.endswith(".json") and valid_slug(name[:-5]):
            out.append(name[:-5])
    return out[:MAX_THEMES]


def _read(path: Path):
    try:
        st = os.lstat(path)
    except OSError:
        return {"error": "file is not readable", "code": "theme.unreadable"}
    if stat.S_ISLNK(st.st_mode):
        return {"error": "symbolic links are ignored", "code": "theme.symlink"}
    if not stat.S_ISREG(st.st_mode):
        return {"error": "not a regular file", "code": "theme.symlink"}
    if st.st_size > MAX_FILE:
        return {"error": f"file is larger than {MAX_FILE} bytes", "code": "theme.toolarge"}
    try:
        theme = check_theme(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return {"error": "file is not valid JSON", "code": "theme.json"}
    except ThemeError as err:
        return err.body()
    return theme


def list_themes(state_dir) -> dict:
    d = _dir(state_dir)
    items = []
    for slug in _files(d):
        res = _read(d / f"{slug}.json")
        items.append({"slug": slug, **res})
    return {"themes": items, "tokens": list(TOKENS), "max": MAX_THEMES}


def _ensure_dir(state_dir) -> Path:
    d = _dir(state_dir)
    if os.path.lexists(d) and not _plain_dir(d):
        raise ThemeError("the themes directory is not a plain directory", 400, "theme.dir")
    try:
        d.mkdir(parents=True, exist_ok=True)
    except OSError:
        raise ThemeError("could not create the themes directory", 500, "theme.write") from None
    return d


def write_theme(state_dir, data) -> dict:
    theme = check_theme(data, with_slug=True)
    slug = data["slug"]
    with _LOCK:
        d = _ensure_dir(state_dir)
        target = d / f"{slug}.json"
        if os.path.lexists(target):
            if not stat.S_ISREG(os.lstat(target).st_mode):
                raise ThemeError("that theme file is a link or not a regular file", 400, "theme.symlink")
        elif len(_files(d)) >= MAX_THEMES:
            raise ThemeError(f"at most {MAX_THEMES} themes", 409, "theme.limit")
        fd, tmp = tempfile.mkstemp(prefix=".theme-", suffix=".tmp", dir=d)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(theme, fh, indent=2, ensure_ascii=False)
                fh.write("\n")
            os.replace(tmp, target)
        except OSError:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise ThemeError("could not write the theme", 500, "theme.write") from None
    return list_themes(state_dir)


def delete_theme(state_dir, slug) -> dict:
    if not valid_slug(slug):
        raise ThemeError("slug must be 1-40 characters: a-z, 0-9 and hyphens", 400, "theme.slug")
    with _LOCK:
        d = _dir(state_dir)
        target = d / f"{slug}.json"
        try:
            mode = os.lstat(target).st_mode if _plain_dir(d) else None
        except OSError:
            mode = None
        if mode is None:
            raise ThemeError("no such theme", 404, "theme.notfound")
        if not stat.S_ISREG(mode):
            raise ThemeError("that theme file is a link or not a regular file", 400, "theme.symlink")
        try:
            os.unlink(target)
        except OSError:
            raise ThemeError("could not delete the theme", 500, "theme.write") from None
    return list_themes(state_dir)
