"""Checksum validators for identifiers: Ecuadorian cedula and RUC (natural, juridical, public), Luhn cards, IBAN,
email and Ecuadorian phones. Pure functions over strings; spaces and dashes are ignored where people write them.

Adapted from the corporate privacy guard (docs/intake/privacy.md); juridical and public RUC and IBAN are additions.
"""

import re

_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_MOBILE = re.compile(r"^(?:09|\+5939)\d{8}$")
_LANDLINE = re.compile(r"^0[2-7]\d{7}$")
_IBAN = re.compile(r"^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$")
_CEDULA = (2, 1, 2, 1, 2, 1, 2, 1, 2)
_JURIDICAL = (4, 3, 2, 7, 6, 5, 4, 3, 2)
_PUBLIC = (3, 2, 7, 6, 5, 4, 3, 2)


def compact(value):
    return re.sub(r"[\s\-]", "", value)


def _digits(value, length):
    s = compact(value)
    return s if s.isascii() and s.isdigit() and len(s) == length else None


def _province_ok(s):
    return 1 <= int(s[:2]) <= 24 or s[:2] == "30"


def is_cedula(value):
    s = _digits(value, 10)
    if not s or not _province_ok(s) or int(s[2]) >= 6:
        return False
    total = sum(p - 9 if p > 9 else p for p in (int(d) * c for d, c in zip(s, _CEDULA)))
    return (10 - total % 10) % 10 == int(s[9])


def _mod11_ok(body, check, coeffs):
    r = 11 - sum(int(d) * c for d, c in zip(body, coeffs)) % 11
    return r != 10 and (0 if r == 11 else r) == int(check)


def is_ruc(value):
    """13 digits: a cedula plus an establishment (natural person), or the juridical (third digit 9) or public-sector
    (third digit 6) forms with their modulo-11 check digit. Establishment 000 does not exist."""
    s = _digits(value, 13)
    if not s or not _province_ok(s):
        return False
    if s[2] == "9":
        return _mod11_ok(s[:9], s[9], _JURIDICAL) and s[10:] != "000"
    if s[2] == "6":
        return _mod11_ok(s[:8], s[8], _PUBLIC) and s[9:] != "0000"
    return is_cedula(s[:10]) and s[10:] != "000"


def luhn(digits):
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch) * (2 if i % 2 else 1)
        total += d - 9 if d > 9 else d
    return total % 10 == 0


def is_card(value):
    s = compact(value)
    return s.isascii() and s.isdigit() and 13 <= len(s) <= 19 and luhn(s)


def is_iban(value):
    """ISO 13616: country, two check digits, then the account; valid when the rearranged number modulo 97 is 1."""
    s = compact(value).upper()
    if not _IBAN.match(s):
        return False
    return int("".join(str(int(c, 36)) for c in s[4:] + s[:4])) % 97 == 1


def is_email(value):
    return bool(_EMAIL.match(value.strip()))


def is_ec_phone(value):
    s = compact(value.strip())
    return bool(_MOBILE.match(s) or _LANDLINE.match(s))
