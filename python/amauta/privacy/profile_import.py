"""Profile import and harvest (plan D13, ADR 0007): turn existing material into a draft profile the user reviews.

import:  an agent archive laid out as `rules/*.md` and `skills/<name>/{SKILL.md, references/*.md, templates/*}`.
         Text goes to the profile file its kind suggests (by file name: design and themes to brand, DAX, metrics and
         glossaries to the glossary, sources and catalogs to sources, the rest to conventions); a Power BI theme gives
         the palette; templates are copied to `assets/templates/`; code is skipped.
harvest: the user's own projects: Power BI themes, semantic-model measures (model.bim), and convention documents
         (CONTRIBUTING, STYLE, CONVENTIONS). Data files are never opened.

Both write `<state dir>/profiles/<name>.draft/` with a REVIEW.md (source -> destination, skipped files, guard findings
by file, line and kind, never the text). `accept` installs a draft only when the guard finds nothing. Runs locally;
nothing is sent anywhere.
"""

import json
import os
import re
import shutil
import time
from pathlib import Path

from . import profiles

ROUTES = (("brand.md", ("design", "visual", "layout", "brand", "theme", "style_guide", "palette")),
          ("glossary.md", ("dax", "glossary", "metric", "kpi", "measure", "definition", "statement")),
          ("sources.md", ("source", "catalog", "lineage", "dataset")))
CODE = {".py", ".js", ".mjs", ".ts", ".ps1", ".sh", ".bat", ".cmd", ".exe", ".dll", ".pyc"}
DATA = {".csv", ".tsv", ".xlsx", ".xls", ".parquet", ".db", ".sqlite", ".pbix", ".pbit"}
CONVENTION_DOCS = re.compile(r"^(contributing|style|styleguide|style-guide|conventions?)(\.[a-z]+)?\.md$", re.I)


def _draft(state, name):
    profiles._org_dir(state, name)  # validates the name
    d = Path(state) / "profiles" / f"{name}.draft"
    if d.exists():
        shutil.rmtree(d)
    shutil.copytree(profiles.DEFAULT, d)
    (d / "profile.json").write_text(json.dumps({"name": name, "description": "Draft: review REVIEW.md, then accept.",
                                                "extends": "default"}, indent=2) + "\n", encoding="utf-8")
    return d


def _append(d, target, title, text):
    with open(d / target, "a", encoding="utf-8") as f:
        f.write(f"\n\n## {title}\n\n{text.strip()}\n")


def _route(path):
    stem = path.stem.lower()
    return next((target for target, words in ROUTES if any(w in stem for w in words)), "conventions.md")


def _palette(theme):
    keys = [k for k in ("name", "background", "foreground", "tableAccent") if isinstance(theme.get(k), str)]
    lines = [f"- {k}: {theme[k]}" for k in keys]
    lines.append("- data colors: " + ", ".join(c for c in theme.get("dataColors", []) if isinstance(c, str)))
    return "\n".join(lines)


def _theme(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and isinstance(data.get("dataColors"), list) else None


def _finish(d, moves, skipped):
    findings = profiles.check_dir(d)
    lines = ["# Review this draft before `amauta profile accept`", "",
             "Edit the files in this folder. Move people to `people/roles.md` as roles only.", "", "## Sources", ""]
    lines += [f"- {src} -> {dst}" for src, dst in moves] or ["- none"]
    lines += ["", "## Skipped", ""] + ([f"- {s}" for s in skipped] or ["- none"])
    lines += ["", "## Guard findings (fix them; accept refuses while any remain)", ""]
    lines += [f"- {f['file']}:{f['line']}: {f['kind']}" for f in findings] or ["- none"]
    (d / "REVIEW.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return d


def import_archive(state, name, archive):
    a, d = Path(archive), _draft(state, name)
    moves, skipped = [], []
    for f in sorted(p for p in a.rglob("*") if p.is_file()):
        rel = f.relative_to(a).as_posix()
        if f.suffix.lower() in CODE or f.suffix.lower() in DATA or "__pycache__" in rel:
            skipped.append(f"{rel}: skipped ({'code' if f.suffix.lower() in CODE or '__pycache__' in rel else 'data'})")
        elif "templates" in f.parts:
            theme = _theme(f) if f.suffix.lower() == ".json" else None
            if theme:
                _append(d, "brand.md", f"Theme {f.name}", _palette(theme))
                moves.append((rel, "brand.md"))
            dest = d / "assets" / "templates" / f.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dest)
            moves.append((rel, f"assets/templates/{f.name}"))
        elif f.suffix.lower() in (".md", ".txt"):
            target = "conventions.md" if f.name == "SKILL.md" or "rules" in f.parts else _route(f)
            text = f.read_text(encoding="utf-8", errors="replace")
            _append(d, target, f"From {rel}", re.sub(r"^---\n.*?\n---\n", "", text, flags=re.S))
            moves.append((rel, target))
        else:
            skipped.append(f"{rel}: skipped (unknown kind)")
    return _finish(d, moves, skipped)


def _measures(model):
    m = model.get("model", model)
    for t in m.get("tables", []):
        for x in t.get("measures", []):
            expr = x.get("expression", "")
            yield f"{t.get('name')}[{x.get('name')}]", " ".join(("\n".join(expr) if isinstance(expr, list) else expr).split())


def harvest(state, name, roots):
    d = _draft(state, name)
    moves, skipped = [], []
    for root in map(Path, roots):
        for f in sorted(p for p in root.rglob("*") if p.is_file() and ".git" not in p.parts):
            rel = f"{root.name}/{f.relative_to(root).as_posix()}"
            if f.suffix.lower() in DATA:
                skipped.append(f"{rel}: skipped (data, never opened)")
            elif f.name == "model.bim":
                model = json.loads(f.read_text(encoding="utf-8-sig"))
                rows = [f"- `{k}` = `{v}` (owner: to be named; status: harvested, not approved)" for k, v in _measures(model)]
                if rows:
                    _append(d, "glossary.md", f"Measures in {rel}", "\n".join(rows))
                    moves.append((rel, "glossary.md"))
            elif f.suffix.lower() == ".json" and (theme := _theme(f)):
                _append(d, "brand.md", f"Theme {f.name}", _palette(theme))
                moves.append((f.name, "brand.md"))
            elif CONVENTION_DOCS.match(f.name):
                _append(d, "conventions.md", f"From {rel}", f.read_text(encoding="utf-8", errors="replace"))
                moves.append((rel, "conventions.md"))
    return _finish(d, moves, skipped)


def accept(state, name):
    """Install `<name>.draft` as the profile; the previous version is kept as `<name>.bak-<time>`."""
    target = profiles._org_dir(state, name)
    d = target.parent / f"{name}.draft"
    if not d.is_dir():
        raise ValueError(f"no draft for {name!r} (amauta profile import|harvest {name} ...)")
    findings = profiles.check_dir(d)
    if findings:
        raise ValueError(f"the draft still has guard findings ({len(findings)}); see {d / 'REVIEW.md'} and run accept again")
    (d / "REVIEW.md").unlink(missing_ok=True)
    if target.exists():
        os.replace(target, target.parent / f"{name}.bak-{time.strftime('%Y%m%dT%H%M%S')}")
    os.replace(d, target)
    return target
