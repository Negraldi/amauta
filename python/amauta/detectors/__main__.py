"""`python3 -P -m amauta.detectors secrets FILE`: secret-like runs in one text file as JSON [{line, col, message}].

Used by the checks engine (plan D7). Never prints the matched text. Binary files (a NUL byte in the first 8 KiB) and
files over 1 MiB are skipped.
"""

import json
import sys

from . import secretlike

MAX_BYTES = 1 << 20


def secrets_in(path):
    with open(path, "rb") as f:
        data = f.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or b"\0" in data[:8192]:
        return []
    out = []
    for n, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
        for start, _ in secretlike.spans(line):
            out.append({"line": n, "col": start + 1, "message": "secret-like value (an API key, token or private key); "
                                                               "move it out of the code and rotate it if it is real"})
    return out


def main(argv):
    if len(argv) != 2 or argv[0] != "secrets":
        print("usage: python3 -P -m amauta.detectors secrets FILE", file=sys.stderr)
        return 2
    try:
        print(json.dumps(secrets_in(argv[1])))
    except OSError as e:
        print(f"cannot read: {e.strerror}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
