"""Identifier columns in a CSV file by two signals: column-name tokens (Spanish and English) and value validators over
a bounded sample. Findings carry the column name, the reasons and a ratio, never a value.

Rewritten over the `csv` module from the corporate detector (pandas), docs/intake/privacy.md.
"""

import csv
import re
import unicodedata

from ..detectors import validators as v

THRESHOLD = 0.6  # share of non-empty sampled values one validator must accept
SAMPLE_ROWS = 500
NAME_TOKENS = {
    "cedula": {"cedula", "ci"}, "ruc": {"ruc"}, "passport": {"pasaporte", "passport"}, "dni": {"dni"},
    "id": {"id", "identificacion", "identification"},
    "person_name": {"nombre", "nombres", "apellido", "apellidos", "name", "firstname", "lastname", "fullname"},
    "email": {"email", "correo", "mail"}, "phone": {"telefono", "celular", "phone", "mobile"},
    "address": {"direccion", "address"}, "account": {"cuenta", "account", "iban"}, "card": {"tarjeta", "card"},
}
_BY_TOKEN = {t: cat for cat, tokens in NAME_TOKENS.items() for t in tokens}
VALIDATORS = {"cedula": v.is_cedula, "ruc": v.is_ruc, "email": v.is_email, "phone": v.is_ec_phone, "card": v.is_card,
              "iban": v.is_iban}


def name_categories(name):
    """Whole tokens only, accents and case ignored: `numero_ci` matches cedula, `ciudad` does not."""
    plain = "".join(c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c)).lower()
    return {_BY_TOKEN[t] for t in re.split(r"[^a-z0-9]+", plain) if t in _BY_TOKEN}


def detect_rows(header, rows):
    findings = []
    for i, name in enumerate(header):
        reasons = [f"name_{c}" for c in sorted(name_categories(name))]
        values = [r[i].strip() for r in rows if i < len(r) and r[i].strip()]
        best = 0.0
        for kind, check in VALIDATORS.items():
            ratio = sum(1 for x in values if check(x)) / len(values) if values else 0.0
            best = max(best, ratio)
            if values and ratio >= THRESHOLD:
                reasons.append(f"value_{kind}")
        if reasons:
            findings.append({"column": name, "reasons": reasons, "ratio": round(best, 4)})
    return findings


def detect_csv(path, sample=SAMPLE_ROWS):
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        sniff = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sniff, delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(f, dialect)
        header = next(reader, [])
        rows = [r for _, r in zip(range(sample), reader)]
    return detect_rows(header, rows)
