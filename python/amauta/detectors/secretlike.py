"""Secret-like text: API keys, tokens and private keys. Matching never reports the text, only that it matched.

Patterns adapted from the corporate memory guard (docs/intake/privacy.md), plus GitHub, Slack and Google key shapes.
"""

import re

PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*[\"']?[^\s\"']{12,}", re.IGNORECASE),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})"),
    re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}"),
)


def spans(text):
    """(start, end) of every secret-like run, in text order."""
    return sorted((m.start(), m.end()) for p in PATTERNS for m in p.finditer(text))


def contains_secret(text):
    return any(p.search(text) for p in PATTERNS)
