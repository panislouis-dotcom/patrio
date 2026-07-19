"""Decimal quantizers matching PostgreSQL numeric ROUND (half away from zero)."""
from decimal import Decimal, ROUND_HALF_UP

_CENT = Decimal("0.01")
_PESO = Decimal("1")
_FRAC4 = Decimal("0.0001")


def to_decimal(value) -> Decimal:
    """Coerce int/float/str/Decimal/None to Decimal via str() (float-repr safe)."""
    if value is None:
        return Decimal(0)
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def money(value) -> Decimal:
    """2 decimal places (cents)."""
    return to_decimal(value).quantize(_CENT, rounding=ROUND_HALF_UP)


def money0(value) -> Decimal:
    """Whole pesos — matches SQL ROUND(x, 0) on cost totals."""
    return to_decimal(value).quantize(_PESO, rounding=ROUND_HALF_UP)


def frac4(value) -> Decimal:
    """4 decimal places — matches SQL ROUND(x, 4) on ratio metrics."""
    return to_decimal(value).quantize(_FRAC4, rounding=ROUND_HALF_UP)


def pct2(value) -> Decimal:
    """2 decimal places — matches SQL ROUND(x, 2) on percentage metrics."""
    return to_decimal(value).quantize(_CENT, rounding=ROUND_HALF_UP)
