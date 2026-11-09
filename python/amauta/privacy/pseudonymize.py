"""Keyed pseudonyms for CSV columns: each value becomes <COLUMN>_<12 hex> from HMAC-SHA256(key, column + 0x1f + value).
Same key, column and value give the same pseudonym, so joins still work. The 48-bit suffix can collide, and a
pseudonym is not anonymity: other columns may still identify a person.

The key is 32 random bytes in `<state dir>/privacy.key` (0600), created once and never printed. Rewritten over the `csv`
module from the corporate pseudonymizer (pandas), docs/intake/privacy.md.
"""

import csv
import hashlib
import hmac
import os
import re
import secrets
from pathlib import Path

KEY_FILE = "privacy.key"


def load_or_create_key(path):
    path = Path(path)
    try:
        key = path.read_bytes()
        if len(key) == 32:
            return key
    except FileNotFoundError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_bytes(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key)
    return key


def _tag(column):
    return re.sub(r"[^A-Za-z0-9]+", "_", column).strip("_").upper() or "COL"


def pseudonym(column, value, key):
    norm = re.sub(r"[\s\-]", "", value) if re.fullmatch(r"[\d\s\-+]+", value) else value.strip()
    digest = hmac.new(key, f"{column}\x1f{norm}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{_tag(column)}_{digest[:12]}"


def pseudonymize_csv(src, dst, columns, key):
    """Write `dst` with the named columns pseudonymized (empty cells stay empty); returns {rows, columns}."""
    with open(src, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader, [])
        missing = [c for c in columns if c not in header]
        if missing:
            raise ValueError(f"no such column: {', '.join(missing)}")
        idx = {header.index(c): c for c in columns}
        rows = 0
        with open(dst, "w", newline="", encoding="utf-8") as out:
            w = csv.writer(out)
            w.writerow(header)
            for row in reader:
                w.writerow([pseudonym(idx[i], x, key) if i in idx and x.strip() else x for i, x in enumerate(row)])
                rows += 1
    return {"rows": rows, "columns": list(columns)}
