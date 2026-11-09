"""Which files the privacy hook treats as data: tabular and database files outside test, fixture and example folders,
plus anything under the paths configured in `<state dir>/privacy.json` ({"paths": [...]})."""

import json
import os
from pathlib import Path, PurePath

DATA_EXT = {".csv", ".tsv", ".xlsx", ".xlsm", ".xls", ".parquet", ".feather", ".arrow", ".sav", ".dta", ".sas7bdat",
            ".rds", ".rdata", ".jsonl", ".ndjson", ".sqlite", ".sqlite3", ".db", ".mdb", ".accdb", ".dbf"}
SAFE_DIRS = {"test", "tests", "testdata", "fixture", "fixtures", "example", "examples", "sample", "samples"}
CONFIG = "privacy.json"


def configured(state_dir):
    """The configured paths (absolute strings); an unreadable or malformed file means none."""
    try:
        data = json.loads((Path(state_dir) / CONFIG).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    items = data.get("paths") if isinstance(data, dict) else None
    return [p for p in items if isinstance(p, str) and os.path.isabs(p)] if isinstance(items, list) else []


def _under(path, root):
    try:
        PurePath(os.path.normcase(path)).relative_to(os.path.normcase(root))
        return True
    except ValueError:
        return False


def is_data_file(path, conf):
    if not isinstance(path, str) or not path:
        return False
    if any(_under(path, root) for root in conf):
        return True
    p = PurePath(path)
    if p.suffix.lower() not in DATA_EXT:
        return False
    return not any(part.lower() in SAFE_DIRS for part in p.parts[:-1])
