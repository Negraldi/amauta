"""One scan over free text for every detector kind, and redaction by placeholder.

A finding is {"kind", "start", "end"}: offsets into the text, never the text itself. Overlaps keep the first finding
(secrets win, then emails, IBANs and numbers). Numbers are matched as whole runs so a valid cedula inside a longer
number or word is never reported (adapted from the corporate redactor, docs/intake/privacy.md).
"""

import re

from . import secretlike
from . import validators as v

KINDS = ("secret", "email", "iban", "ruc", "cedula", "card", "phone")
_EMAIL = re.compile(r"(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_IBAN = re.compile(r"(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![A-Za-z0-9])")
_NUMBER = re.compile(r"(?<![\w+])(\+?\d[\d \-]{5,23}\d)(?![\w])")


def _number_kind(raw):
    s = v.compact(raw)
    if v.is_ruc(s):
        return "ruc"
    if v.is_cedula(s):
        return "cedula"
    if v.is_card(s):
        return "card"
    if v.is_ec_phone(s):
        return "phone"
    return None


def _numbers(text):
    for m in _NUMBER.finditer(text):
        kind = _number_kind(m.group(1))
        if kind:
            yield kind, m.start(1), m.end(1)
            continue
        for part in re.finditer(r"\S+", m.group(1)):  # separate identifiers in one run, never split a digit sequence
            kind = _number_kind(part.group(0))
            if kind:
                yield kind, m.start(1) + part.start(), m.start(1) + part.end()


def _candidates(text):
    yield from (("secret", a, b) for a, b in secretlike.spans(text))
    yield from (("email", m.start(), m.end()) for m in _EMAIL.finditer(text) if v.is_email(m.group(0)))
    yield from (("iban", m.start(), m.end()) for m in _IBAN.finditer(text) if v.is_iban(m.group(0)))
    yield from _numbers(text)


def scan(text, kinds=None):
    """Findings in text order; `kinds` limits the result (overlaps are resolved over all kinds first)."""
    taken, out = [], []
    for kind, start, end in _candidates(text or ""):
        if any(start < b and a < end for a, b in taken):
            continue
        taken.append((start, end))
        out.append({"kind": kind, "start": start, "end": end})
    out.sort(key=lambda f: f["start"])
    return [f for f in out if kinds is None or f["kind"] in kinds]


def counts(findings):
    out = {}
    for f in findings:
        out[f["kind"]] = out.get(f["kind"], 0) + 1
    return out


def redact(text, kinds=None):
    """(text with [REDACTED_<KIND>] placeholders, counts per kind). The counts never include values."""
    findings = scan(text, kinds)
    out = text
    for f in reversed(findings):
        out = out[:f["start"]] + f"[REDACTED_{f['kind'].upper()}]" + out[f["end"]:]
    return out, counts(findings)
