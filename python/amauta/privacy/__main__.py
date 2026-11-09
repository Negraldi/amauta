"""`python3 -P -m amauta.privacy` (also `amauta privacy`): hook | scan | redact | pseudonymize.

scan:          per file, the kinds found with line numbers (text) or the identifier columns (CSV, TSV); exit 1 when
               anything was found, so it can gate a commit. Never prints a value.
redact:        writes a copy with [REDACTED_<KIND>] placeholders; the source file is never changed.
pseudonymize:  writes a copy of a CSV with keyed pseudonyms in the named columns (key in the state directory).
hook:          the privacy hook (reads the hook JSON on stdin; see hook.py).
"""

import argparse
import json
import sys
from pathlib import Path

from .. import paths as amauta_paths
from ..detectors import scan as dscan
from . import columns, hook, pseudonymize

TABULAR = {".csv", ".tsv"}


def _scan_file(path):
    p = Path(path)
    if p.suffix.lower() in TABULAR:
        return {"file": str(p), "columns": columns.detect_csv(p)}
    findings, counts = [], {}
    with open(p, encoding="utf-8", errors="replace") as f:
        for n, line in enumerate(f, 1):
            for hit in dscan.scan(line):
                findings.append({"line": n, "kind": hit["kind"]})
                counts[hit["kind"]] = counts.get(hit["kind"], 0) + 1
    return {"file": str(p), "findings": findings, "counts": counts}


def _print_text(report):
    for r in report:
        for c in r.get("columns", []):
            print(f"{r['file']}: column {c['column']}: {', '.join(c['reasons'])}")
        for f in r.get("findings", []):
            print(f"{r['file']}:{f['line']}: {f['kind']}")


def cmd_scan(a):
    report = [_scan_file(f) for f in a.files]
    print(json.dumps(report, indent=1)) if a.json else _print_text(report)
    return 1 if any(r.get("columns") or r.get("findings") for r in report) else 0


def cmd_redact(a):
    src, dst = Path(a.file), Path(a.output)
    if dst.resolve() == src.resolve():
        print("amauta privacy: the output must be a new file; the source is never changed", file=sys.stderr)
        return 2
    text, counts = dscan.redact(src.read_text(encoding="utf-8", errors="replace"))
    dst.write_text(text, encoding="utf-8")
    print(f"{dst}: " + (", ".join(f"{n} {k}" for k, n in sorted(counts.items())) + " redacted" if counts else "nothing to redact"))
    return 0


def cmd_pseudonymize(a):
    state = Path(a.state_dir) if a.state_dir else amauta_paths.state_dir()
    key = pseudonymize.load_or_create_key(state / pseudonymize.KEY_FILE)
    try:
        r = pseudonymize.pseudonymize_csv(a.file, a.output, [c for c in a.columns.split(",") if c], key)
    except ValueError as e:
        print(f"amauta privacy: {e}", file=sys.stderr)
        return 2
    print(f"{a.output}: {r['rows']} rows, columns pseudonymized: {', '.join(r['columns'])}")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(prog="amauta privacy", description="Local privacy tools; nothing leaves this machine.")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scan", help="report identifiers and secrets (counts, lines, columns; never values)")
    s.add_argument("files", nargs="+")
    s.add_argument("--json", action="store_true")
    r = sub.add_parser("redact", help="write a redacted copy of a text file")
    r.add_argument("file")
    r.add_argument("-o", "--output", required=True)
    ps = sub.add_parser("pseudonymize", help="write a copy of a CSV with keyed pseudonyms in some columns")
    ps.add_argument("file")
    ps.add_argument("--columns", required=True, help="comma-separated column names")
    ps.add_argument("-o", "--output", required=True)
    ps.add_argument("--state-dir")
    sub.add_parser("hook", help="the privacy hook (hook JSON on stdin)")
    a = p.parse_args(argv)
    if a.cmd == "hook":
        return hook.run(sys.stdin.read(), amauta_paths.state_dir())
    return {"scan": cmd_scan, "redact": cmd_redact, "pseudonymize": cmd_pseudonymize}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
