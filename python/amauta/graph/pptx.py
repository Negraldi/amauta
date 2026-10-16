"""PowerPoint (.pptx) to Markdown sidecars for the semantic pass. Standard library only (a .pptx is a ZIP of XML).

graphify converts .docx/.xlsx itself but not .pptx. This module mirrors graphify's sidecar contract so a deck joins the
semantic plan like any other document:

  graphify-out/converted/<stem>_<sha256(repo-relative posix path)[:8]>.md, rewritten only when the source is newer.

Slide text comes out in presentation order under `## Slide N`, with speaker notes under `### Notes`. The deck is only
read, never modified. Anything that is not a plain, small, well-formed deck is skipped: symlinks and special files,
oversized archives or members, DOCTYPE/ENTITY declarations in the XML.
"""
from __future__ import annotations

import hashlib
import os
import posixpath
import re
import stat
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

MAX_PPTX_BYTES = 100 * 1024 * 1024
MAX_XML_BYTES = 8 * 1024 * 1024
MAX_SLIDES = 2000
SKIP_DIRS = {".git", "graphify-out", "node_modules", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache"}
IGNORED_PLACEHOLDERS = {"sldNum", "dt", "ftr", "hdr", "sldImg"}

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
FORBIDDEN = re.compile(rb"<!\s*(DOCTYPE|ENTITY)", re.IGNORECASE)


class _Bad(Exception):
    pass


def _read_xml(z: zipfile.ZipFile, name: str):
    try:
        info = z.getinfo(name)
    except KeyError:
        return None
    if info.file_size > MAX_XML_BYTES:
        raise _Bad(f"{name} is too large")
    with z.open(info) as fh:
        data = fh.read(MAX_XML_BYTES + 1)
    if len(data) > MAX_XML_BYTES or FORBIDDEN.search(data):
        raise _Bad(f"{name} is not acceptable XML")
    try:
        return ET.fromstring(data)
    except ET.ParseError as err:
        raise _Bad(str(err)) from None


def _rels(z: zipfile.ZipFile, part: str) -> dict[str, tuple[str, str]]:
    """relationship id -> (type, absolute part name) for `part`."""
    folder, base = posixpath.split(part)
    root = _read_xml(z, posixpath.join(folder, "_rels", base + ".rels"))
    out = {}
    if root is not None:
        for rel in root.iter(f"{REL}Relationship"):
            target = rel.get("Target", "")
            if rel.get("TargetMode") == "External" or not target:
                continue
            absolute = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(folder, target))
            out[rel.get("Id", "")] = (rel.get("Type", ""), absolute)
    return out


def _paragraphs(root) -> list[str]:
    lines = []
    for shape in root.iter():
        if shape.tag not in (f"{P}sp", f"{P}graphicFrame"):
            continue
        ph = shape.find(f".//{P}nvPr/{P}ph")
        if ph is not None and ph.get("type") in IGNORED_PLACEHOLDERS:
            continue
        for para in shape.iter(f"{A}p"):
            parts = []
            for el in para.iter():
                if el.tag == f"{A}t":
                    parts.append(el.text or "")
                elif el.tag == f"{A}br":
                    parts.append(" ")
            text = "".join(parts).strip()
            if text:
                lines.append(text)
    return lines


def _slide_parts(z: zipfile.ZipFile) -> list[str]:
    names = set(z.namelist())
    ordered = []
    pres = _read_xml(z, "ppt/presentation.xml")
    if pres is not None:
        rels = _rels(z, "ppt/presentation.xml")
        for sld in pres.iter(f"{P}sldId"):
            target = rels.get(sld.get(f"{R}id", ""))
            if target and target[1] in names and target[1] not in ordered:
                ordered.append(target[1])
    if not ordered:
        found = [n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
        ordered = sorted(found, key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)))
    return ordered[:MAX_SLIDES]


def pptx_to_markdown(path: Path) -> str | None:
    """Markdown for the deck, or None when it cannot be read safely or holds no text."""
    try:
        with zipfile.ZipFile(path) as z:
            blocks = []
            for number, part in enumerate(_slide_parts(z), start=1):
                root = _read_xml(z, part)
                lines = _paragraphs(root) if root is not None else []
                block = [f"## Slide {number}", ""] + [f"- {line}" for line in lines]
                notes = next((t[1] for t in _rels(z, part).values() if t[0].endswith("/notesSlide")), None)
                note_root = _read_xml(z, notes) if notes else None
                note_lines = _paragraphs(note_root) if note_root is not None else []
                if note_lines:
                    block += ["", "### Notes", ""] + note_lines
                if lines or note_lines:
                    blocks.append("\n".join(block))
                # empty slides still consume a number so references stay stable
            if not blocks:
                return None
            return f"# {path.stem}\n\n" + "\n\n".join(blocks) + "\n"
    except (zipfile.BadZipFile, _Bad, OSError, RuntimeError, ValueError, NotImplementedError):
        return None


def sidecar_path(repo: Path, source: Path, out_dir: Path) -> Path:
    key = unicodedata.normalize("NFC", source.resolve().relative_to(repo.resolve()).as_posix())
    return out_dir / f"{source.stem}_{hashlib.sha256(key.encode()).hexdigest()[:8]}.md"


def find_decks(repo: Path, max_bytes: int = MAX_PPTX_BYTES) -> list[Path]:
    """Regular .pptx files below `repo` (symlinks and special files ignored, noise directories pruned)."""
    found = []
    for dirpath, dirs, names in os.walk(repo, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not os.path.islink(os.path.join(dirpath, d)))
        for name in sorted(names):
            if not name.lower().endswith(".pptx"):
                continue
            full = Path(dirpath) / name
            try:
                st = full.lstat()
            except OSError:
                continue
            if stat.S_ISREG(st.st_mode) and st.st_size <= max_bytes:
                found.append(full)
    return found


def sync_sidecars(repo: Path, max_bytes: int = MAX_PPTX_BYTES) -> list[Path]:
    """Create or refresh the Markdown sidecar of every deck; returns the sidecars that exist afterwards."""
    repo = Path(repo).resolve()
    out_dir = repo / "graphify-out" / "converted"
    sidecars = []
    for deck in find_decks(repo, max_bytes):
        target = sidecar_path(repo, deck, out_dir)
        try:
            if target.is_file() and not target.is_symlink() and target.stat().st_mtime >= deck.stat().st_mtime:
                sidecars.append(target)
                continue
        except OSError:
            pass
        text = pptx_to_markdown(deck)
        if text is None:
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        if target.is_symlink():
            continue
        target.write_text(f"<!-- converted from {deck.name} -->\n\n{text}", encoding="utf-8")
        sidecars.append(target)
    return sidecars
