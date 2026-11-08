"""Profiles (plan D12, ADR 0007): what an organization's work looks like (brand, conventions, glossary, sources, roles)
without putting it in any repository.

Layers, first match wins per file: the project (`<repo>/.amauta/profile/<file>`), the selected organization profile
(`<state dir>/profiles/<name>/<file>`), the shipped `default` (`assets/profiles/default/`). The selection is kept per
git root in `<state dir>/profiles/selection.json`, on this machine only. `check` is the privacy guard: secrets and
identifiers are errors, and `people/` holds roles, never names or contacts. Nothing is synced or published.

CLI: `amauta profile list | new NAME | use NAME [--cwd DIR] | show [--cwd DIR] [--json] | check NAME |
import NAME ARCHIVE | harvest NAME --from DIR... | accept NAME` (import and harvest: profile_import.py).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from .. import paths as amauta_paths
from ..detectors import scan

FILES = ("brand.md", "conventions.md", "glossary.md", "sources.md", "people/roles.md")
DEFAULT = Path(__file__).resolve().parents[3] / "assets" / "profiles" / "default"
NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")
# A list item that is only two to four capitalized words reads as a person's name, not a role ("- Data owner: ...").
PERSON = re.compile(r"^\s*[-*]\s+((?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+){1,3}[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)\s*$")


def _org_dir(state, name):
    if not NAME.match(name or "") or name == "default":
        raise ValueError(f"invalid profile name: {name!r} (lowercase letters, digits, '-' and '_'; not 'default')")
    return Path(state) / "profiles" / name


def git_root(cwd):
    r = subprocess.run(["git", "-C", str(cwd), "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return str(Path(r.stdout.strip()).resolve()) if r.returncode == 0 and r.stdout.strip() else None


def _selection_file(state):
    return Path(state) / "profiles" / "selection.json"


def _selections(state):
    try:
        data = json.loads(_selection_file(state).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def create(state, name):
    """A new organization profile from the default files; an existing one is left as it is."""
    d = _org_dir(state, name)
    if not d.exists():
        shutil.copytree(DEFAULT, d)
        meta = {"name": name, "description": "Organization profile (private, on this machine).", "extends": "default"}
        (d / "profile.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        (d / "assets").mkdir(exist_ok=True)
    return d


def select(state, cwd, name):
    root = git_root(cwd)
    if root is None:
        raise ValueError(f"{cwd} is not inside a git repository")
    if name != "default" and not _org_dir(state, name).is_dir():
        raise ValueError(f"no profile named {name!r} (amauta profile new {name})")
    sel = _selections(state)
    sel.pop(root, None) if name == "default" else sel.__setitem__(root, name)
    _selection_file(state).parent.mkdir(parents=True, exist_ok=True)
    tmp = _selection_file(state).with_suffix(".tmp")
    tmp.write_text(json.dumps(sel, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, _selection_file(state))
    return root


def resolve(state, cwd):
    root = git_root(cwd)
    name = _selections(state).get(root, "default") if root else "default"
    org = _org_dir(state, name) if name != "default" else None
    files = {}
    for rel in FILES:
        project = Path(root) / ".amauta" / "profile" if root else None
        for layer, base in (("project", project), ("org", org), ("default", DEFAULT)):
            if base is not None and (base / rel).is_file():
                files[rel] = {"layer": layer, "path": str(base / rel)}
                break
    return {"profile": name, "project": root, "files": files}


def check(state, name):
    """Privacy findings for one profile: [{file, line, kind}], never the matched text."""
    return check_dir(DEFAULT if name == "default" else _org_dir(state, name))


def check_dir(d):
    found = []
    texts = (p for p in Path(d).rglob("*") if p.is_file() and p.suffix in (".md", ".txt", ".json", ".csv") and p.name != "REVIEW.md")
    for f in sorted(texts):
        rel = f.relative_to(d).as_posix()
        for n, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            found += [{"file": rel, "line": n, "kind": hit["kind"]} for hit in scan.scan(line)]
            if rel.startswith("people/") and PERSON.match(line):
                found.append({"file": rel, "line": n, "kind": "person-name"})
    return found


def main(argv=None):
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--state-dir")
    p = argparse.ArgumentParser(prog="amauta profile", description="Organization profiles kept on this machine.")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", parents=[common])
    sub.add_parser("new", parents=[common]).add_argument("name")
    u = sub.add_parser("use", parents=[common])
    u.add_argument("name")
    u.add_argument("--cwd", default=".")
    s = sub.add_parser("show", parents=[common])
    s.add_argument("--cwd", default=".")
    s.add_argument("--json", action="store_true")
    sub.add_parser("check", parents=[common]).add_argument("name")
    i = sub.add_parser("import", parents=[common], help="a draft from an agent archive (rules/, skills/)")
    i.add_argument("name")
    i.add_argument("archive")
    h = sub.add_parser("harvest", parents=[common], help="a draft from your projects (themes, measures, conventions)")
    h.add_argument("name")
    h.add_argument("--from", dest="roots", action="append", required=True)
    sub.add_parser("accept", parents=[common], help="install a reviewed draft").add_argument("name")
    a = p.parse_args(argv)
    state = Path(a.state_dir) if a.state_dir else amauta_paths.state_dir()
    try:
        return _run(a, state)
    except ValueError as e:
        print(f"amauta profile: {e}", file=sys.stderr)
        return 2


def _run(a, state):
    if a.cmd in ("import", "harvest", "accept"):
        from . import profile_import as imp  # imports this module: loaded only when needed
        if a.cmd == "accept":
            print(f"{imp.accept(state, a.name)}  (installed; amauta profile use {a.name} in a project)")
        else:
            d = imp.import_archive(state, a.name, a.archive) if a.cmd == "import" else imp.harvest(state, a.name, a.roots)
            print(f"draft: {d}\nreview: {d / 'REVIEW.md'}\nthen: amauta profile accept {a.name}")
        return 0
    if a.cmd == "list":
        org = sorted(p.name for p in (state / "profiles").glob("*") if p.is_dir()) if (state / "profiles").is_dir() else []
        print("\n".join(["default (shipped)", *org]))
    elif a.cmd == "new":
        print(f"{create(state, a.name)}  (private; edit its files, then: amauta profile check {a.name})")
    elif a.cmd == "use":
        print(f"{select(state, a.cwd, a.name)}: profile {a.name}")
    elif a.cmd == "show":
        r = resolve(state, a.cwd)
        lines = [f"profile: {r['profile']}"] + [f"{k}: {v['path']} ({v['layer']})" for k, v in r["files"].items()]
        print(json.dumps(r, indent=1) if a.json else "\n".join(lines))
    else:
        found = check(state, a.name)
        for f in found:
            print(f"{f['file']}:{f['line']}: {f['kind']}")
        print(f"{len(found)} finding{'' if len(found) == 1 else 's'}")
        return 1 if found else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
