"""`python3 -P -m amauta.extras.pbir` (also `amauta py amauta.extras.pbir`): lint | diff | dictionary | layout | refs |
rename | theme.

lint MODEL               DAX and model rules as warnings (exit 0: they are review prompts)
diff OLD NEW             tables, columns and measures added, removed or changed between two models
dictionary MODEL         a Markdown data dictionary
layout REPORT            visuals outside the page, overlapping or too small (exit 1 when any)
refs REPORT MODEL        field references in the report (fields, filters, sorts) the model lacks (exit 1 when any)
rename REPORT --table T --from OLD --to NEW [--apply]   structural rename in the visuals; a dry run unless --apply
theme --name N (--colors C,... | --brand FILE | --profile) --out FILE.json [--background C] [--foreground C] [--force]
                         a report theme file to import in Desktop; never written over an existing file without --force

MODEL is a model.bim file or a *.SemanticModel folder; REPORT is a *.Report folder.
"""

import argparse
import json
import sys

from . import layout, lint, model, refs, rename, theme


def main(argv=None):
    p = argparse.ArgumentParser(prog="amauta py amauta.extras.pbir",
                                description="PBIR tools for Power BI projects (local, read-only by default).")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("lint").add_argument("model")
    d = sub.add_parser("diff")
    d.add_argument("old")
    d.add_argument("new")
    sub.add_parser("dictionary").add_argument("model")
    sub.add_parser("layout").add_argument("report")
    f = sub.add_parser("refs")
    f.add_argument("report")
    f.add_argument("model")
    r = sub.add_parser("rename")
    r.add_argument("report")
    r.add_argument("--table", required=True)
    r.add_argument("--from", dest="old", required=True)
    r.add_argument("--to", dest="new", required=True)
    r.add_argument("--apply", action="store_true")
    _theme_args(sub.add_parser("theme"))
    a = p.parse_args(argv)
    try:
        return _run(a)
    except (OSError, ValueError) as e:
        print(f"amauta pbir: {e}", file=sys.stderr)
        return 2


def _theme_args(t):
    t.add_argument("--name", required=True)
    src = t.add_mutually_exclusive_group(required=True)
    src.add_argument("--colors", help="comma-separated #rrggbb data colors")
    src.add_argument("--brand", help="a brand file with a '- data colors: ...' line")
    src.add_argument("--profile", action="store_true", help="the brand.md of the profile selected for this project")
    t.add_argument("--background")
    t.add_argument("--foreground")
    t.add_argument("--out", required=True)
    t.add_argument("--force", action="store_true")


def _theme(a):
    if a.colors:
        colors = [c.strip() for c in a.colors.split(",") if c.strip()]
    else:
        colors = theme.brand_colors(a.brand or theme.profile_brand())
    t = theme.build(a.name, colors, a.background, a.foreground)
    print(f"wrote {theme.write(t, a.out, a.force)} ({len(t['dataColors'])} data colors)")
    ratio = theme.contrast(a.background, a.foreground) if a.background and a.foreground else None
    if ratio is not None and ratio < 4.5:
        print(f"warning: foreground on background has contrast {ratio:.1f}, below 4.5")
    return 0


def _run(a):
    if a.cmd == "lint":
        for f in lint.lint(model.load(a.model)):
            print(f"{f['object']}: warning {f['rule']}: {f['message']}")
        return 0
    if a.cmd == "diff":
        print(json.dumps(model.diff(model.load(a.old), model.load(a.new)), indent=1))
        return 0
    if a.cmd == "dictionary":
        print(model.dictionary(model.load(a.model)), end="")
        return 0
    if a.cmd == "layout":
        found = layout.audit(a.report)
        for f in found:
            print(f"{f['page']}: {f['kind']}: {', '.join(f['visuals'])}")
        return 1 if found else 0
    if a.cmd == "refs":
        found = refs.audit(a.report, model.load(a.model))
        for f in found:
            print(f"{f['where']}: {f['place']} {f['ref']}: {f['problem']}")
        return 1 if found else 0
    if a.cmd == "theme":
        return _theme(a)
    changes = (rename.apply if a.apply else rename.plan)(a.report, a.table, a.old, a.new)
    verb = "renamed" if a.apply else "would rename"
    for c in changes:
        print(f"{c['page']}/{c['visual']}: {verb} {c['count']} reference{'' if c['count'] == 1 else 's'}")
    if not changes:
        print("no reference to rename")
    return 0


if __name__ == "__main__":
    sys.exit(main())
