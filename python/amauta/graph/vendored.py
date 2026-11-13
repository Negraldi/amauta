"""Which graph files are someone else's code: hidden from the portal's default node list, never from search or walks.

Generic signals for any repository: a dependency or vendored folder name anywhere in the path, and minified file names. On top
of them a repository may say what it vendors: `.gitattributes` lines with linguist-vendored (GitHub's convention; the last
matching line wins and `-linguist-vendored` or `=false` keeps a path visible), and the folders its NOTICE file names (the
place third-party attributions live), when such a folder exists."""
from __future__ import annotations

import os
import re
from fnmatch import fnmatchcase
from pathlib import Path

VENDORED_DIRS = frozenset({"node_modules", "bower_components", "jspm_packages", "web_modules", "vendor", "vendored", "third_party",
                           "third-party", "thirdparty", "3rdparty", "site-packages", ".venv", "venv", "pods", "carthage"})
MINIFIED = re.compile(r"(\.|-)min\.(js|mjs|cjs|css)(\.map)?$")
MAX_RULE_FILE = 65536
NOTICE_FILES = ("NOTICE", "NOTICE.md", "NOTICE.txt")
NOTICE_DIR = re.compile(r"(?<![\w./:-])([\w.-]+(?:/[\w.-]+)*)/(?![\w/])")


def is_vendored(path):
    """True for a file under a dependency or vendored folder, or a minified bundle (no repository rules)."""
    if not path:
        return False
    parts = str(path).replace("\\", "/").lower().split("/")
    return bool(MINIFIED.search(parts[-1])) or any(p in VENDORED_DIRS for p in parts[:-1])


def _read(path: Path) -> str:
    try:
        if path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_RULE_FILE:
            return path.read_text(errors="replace")
    except OSError:
        pass
    return ""


def _attributes(repo: Path):
    """[(pattern, vendored)] from linguist-vendored lines of the repository's .gitattributes, in file order."""
    rules = []
    for line in _read(repo / ".gitattributes").splitlines():
        fields = line.split()
        if not fields or fields[0].startswith("#"):
            continue
        for attr in fields[1:]:
            if attr in ("linguist-vendored", "linguist-vendored=true"):
                rules.append((fields[0].lstrip("/"), True))
            elif attr in ("-linguist-vendored", "linguist-vendored=false", "!linguist-vendored"):
                rules.append((fields[0].lstrip("/"), False))
    return rules


def _notice_dirs(repo: Path):
    text = "\n".join(_read(repo / name) for name in NOTICE_FILES)
    found = {m.group(1).lstrip("./") for m in NOTICE_DIR.finditer(text)}
    return sorted(d for d in found if d and ".." not in d.split("/") and (repo / d).is_dir() and not (repo / d).is_symlink())


def _matches(rel: str, pattern: str) -> bool:
    if "/" in pattern.rstrip("/"):
        return fnmatchcase(rel, pattern) or (pattern.endswith("/**") and rel.startswith(pattern[:-2]))
    return fnmatchcase(rel.rsplit("/", 1)[-1], pattern)


def rule_for(repo):
    """A predicate file path -> vendored for one repository (its key is its resolved path); paths may be absolute or relative."""
    root = Path(repo)
    attrs, dirs, prefix = _attributes(root), _notice_dirs(root), str(root).rstrip(os.sep) + os.sep

    def vendored(path):
        if not path:
            return False
        rel = str(path)
        rel = (rel[len(prefix):] if rel.startswith(prefix) else rel).replace("\\", "/").removeprefix("./")
        verdict = None
        for pattern, value in attrs:
            if _matches(rel, pattern):
                verdict = value
        if verdict is not None:
            return verdict
        return any(rel.startswith(d + "/") for d in dirs) or is_vendored(rel)

    return vendored
