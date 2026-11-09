"""Generated identifiers for the detector tests (plan D2): every value is computed from a seed, none is real.

Each generator returns a value with a valid check digit; `broken()` flips the last digit so the same shape fails.
"""

import random

_CEDULA = (2, 1, 2, 1, 2, 1, 2, 1, 2)
_RUC_JURIDICAL = (4, 3, 2, 7, 6, 5, 4, 3, 2)
_RUC_PUBLIC = (3, 2, 7, 6, 5, 4, 3, 2)


def _mod10(digits):
    total = 0
    for d, c in zip(digits, _CEDULA):
        p = d * c
        total += p - 9 if p > 9 else p
    return (10 - total % 10) % 10


def _mod11(digits, coeffs):
    r = 11 - sum(d * c for d, c in zip(digits, coeffs)) % 11
    return 0 if r == 11 else r  # 10 has no digit: callers retry


def cedula(seed=1):
    rng = random.Random(seed)
    digits = [*divmod(rng.randint(1, 24), 10), rng.randint(0, 5), *(rng.randint(0, 9) for _ in range(6))]
    return "".join(map(str, digits)) + str(_mod10(digits))


def ruc_natural(seed=1):
    return cedula(seed) + "001"


def ruc_juridical(seed=1):
    rng = random.Random(seed)
    while True:
        digits = [*divmod(rng.randint(1, 24), 10), 9, *(rng.randint(0, 9) for _ in range(6))]
        check = _mod11(digits, _RUC_JURIDICAL)
        if check < 10:
            return "".join(map(str, digits)) + str(check) + "001"


def ruc_public(seed=1):
    rng = random.Random(seed)
    while True:
        digits = [*divmod(rng.randint(1, 24), 10), 6, *(rng.randint(0, 9) for _ in range(5))]
        check = _mod11(digits, _RUC_PUBLIC)
        if check < 10:
            return "".join(map(str, digits)) + str(check) + "0001"


def card(seed=1, length=16):
    rng = random.Random(seed)
    body = [4] + [rng.randint(0, 9) for _ in range(length - 2)]
    total = 0
    for i, d in enumerate(reversed(body)):
        if i % 2 == 0:
            d *= 2
            d = d - 9 if d > 9 else d
        total += d
    return "".join(map(str, body)) + str((10 - total % 10) % 10)


def iban(seed=1, country="DE", length=22):
    rng = random.Random(seed)
    bban = "".join(str(rng.randint(0, 9)) for _ in range(length - 4))
    numeric = "".join(str(int(c, 36)) for c in bban + country + "00")
    return f"{country}{98 - int(numeric) % 97:02d}{bban}"


def mobile(seed=1):
    rng = random.Random(seed)
    return "09" + str(rng.randint(6, 9)) + "".join(str(rng.randint(0, 9)) for _ in range(7))


def broken(value):
    """The same value with its last digit changed: the check digit no longer matches."""
    return value[:-1] + str((int(value[-1]) + 1) % 10)
