"""The memory guard (plan D3, ADR 0007): always on, applied by the store to every text it persists.

Secret-like text is refused with one fixed message that names neither the text nor the field. Personal identifiers
(cedula, RUC, cards, IBAN, phones, e-mail) are replaced by placeholders; the caller learns how many of each kind,
never which values. Adapted from the corporate memory guard (docs/intake/privacy.md).
"""

from ..detectors import scan, secretlike

SECRET_REJECTED = "rejected: secret-like content"
PERSONAL = tuple(k for k in scan.KINDS if k != "secret")


class GuardError(ValueError):
    """A text looked like a secret; nothing was written."""


def clean(*texts):
    """(cleaned texts, counts per kind). Raises GuardError before any redaction when any text holds a secret."""
    if any(t and secretlike.contains_secret(t) for t in texts):
        raise GuardError(SECRET_REJECTED)
    out, total = [], {}
    for t in texts:
        if not t:
            out.append(t)
            continue
        redacted, counts = scan.redact(t, set(PERSONAL))
        out.append(redacted)
        for k, n in counts.items():
            total[k] = total.get(k, 0) + n
    return out, total


def describe(counts):
    """"2 cedula, 1 email redacted" for a tool reply; empty when nothing was."""
    return ", ".join(f"{n} {k}" for k, n in sorted(counts.items())) + " redacted" if counts else ""
