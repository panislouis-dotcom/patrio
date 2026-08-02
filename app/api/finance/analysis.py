"""Pure numerical primitives for the analyzer. Float-based on purpose:
IRR/NPV/amortization/CAGR are iterative/fractional-power models where float
is the correct tool. Callers coerce money to float at the boundary."""
import math
from datetime import date
from typing import Optional


def parse_date(value) -> Optional[date]:
    """Coerce a date input to a date. Month granularity is a first-class input
    here (the UI has always sent YYYY-MM for facts nobody knows to the day), so
    a month means its first day. None/empty gives None; anything unreadable
    raises ValueError — an unparseable date is a mistake, not an absence."""
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    text = str(value).strip()
    return date.fromisoformat(text + "-01" if len(text) == 7 else text)


def months_between(start: date, end: date) -> int:
    """Whole calendar months from start to end (negative when end precedes start).
    Month granularity on purpose: every hold in this domain is quoted in months
    and the source dates are often only accurate to the month."""
    return (end.year - start.year) * 12 + (end.month - start.month)


def percentile(values: list[float], p: float) -> float:
    """Percentile with linear interpolation."""
    if not values:
        return 0.0
    sorted_v = sorted(values)
    k = (len(sorted_v) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_v[int(k)]
    return sorted_v[f] * (c - k) + sorted_v[c] * (k - f)


def irr_newton(cashflows: list[float], guess: float = 0.1,
               max_iter: int = 100, tol: float = 1e-6) -> Optional[float]:
    """IRR via Newton-Raphson."""
    rate = guess
    for _ in range(max_iter):
        npv_ = sum(cf / (1 + rate) ** t for t, cf in enumerate(cashflows))
        dnpv = sum(-t * cf / (1 + rate) ** (t + 1) for t, cf in enumerate(cashflows))
        if abs(dnpv) < 1e-12:
            return None
        new_rate = rate - npv_ / dnpv
        if abs(new_rate - rate) < tol:
            return new_rate
        rate = new_rate
    return None


def npv(rate: float, cashflows: list[float]) -> float:
    """Net present value."""
    return sum(cf / (1 + rate) ** t for t, cf in enumerate(cashflows))


def monthly_payment(principal: float, annual_rate: float, months: int) -> float:
    """Fixed monthly payment for an amortizing loan."""
    if annual_rate <= 0 or months <= 0 or principal <= 0:
        return 0.0
    r = annual_rate / 12
    return principal * r * (1 + r) ** months / ((1 + r) ** months - 1)


def roi_cagr(base, target, months) -> Optional[float]:
    """Annualized return (CAGR): (target/base)^(12/months) - 1.
    Returns None on the same guards the SQL view uses. Float in/out —
    coerce money args before calling if they may be Decimal."""
    base = float(base) if base is not None else 0.0
    target = float(target) if target is not None else 0.0
    if base > 0 and target > 0 and months and months > 0:
        return (target / base) ** (12.0 / months) - 1
    return None
