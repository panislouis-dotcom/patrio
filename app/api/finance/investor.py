"""Investor return metrics — the single home for cuota/expected_return/return_pct,
matching the project_investor_metrics view (migration 000)."""
from datetime import date
from decimal import Decimal

from .quantize import money, pct2, to_decimal


def cuota(funded_amount, interest_rate_annual, months) -> Decimal:
    """Interest owed: funded * rate * months/12 (2 dp)."""
    return money(
        to_decimal(funded_amount) * to_decimal(interest_rate_annual)
        * to_decimal(months) / Decimal(12)
    )


def expected_return(funded_amount, interest_rate_annual, months) -> Decimal:
    """funded * (1 + rate*months/12) (2 dp)."""
    return money(
        to_decimal(funded_amount)
        * (Decimal(1) + to_decimal(interest_rate_annual) * to_decimal(months) / Decimal(12))
    )


def return_pct(interest_rate_annual, months) -> Decimal:
    """rate*months/12*100 (2 dp)."""
    return pct2(to_decimal(interest_rate_annual) * to_decimal(months) / Decimal(12) * Decimal(100))


def hold_months(acquisition_ym: str, conclusion: date | None, today: date | None = None) -> int:
    """Whole months between acquisition (YYYY-MM) and conclusion (date) or today."""
    acq_year, acq_month = map(int, acquisition_ym.split("-"))
    end = conclusion or today or date.today()
    return (end.year - acq_year) * 12 + (end.month - acq_month)


def totals(positions: list[dict]) -> dict:
    """Portfolio sums over camelCase position dicts."""
    return {
        "totalFunded": sum((to_decimal(p.get("fundedAmount")) for p in positions), Decimal(0)),
        "totalCommitted": sum((to_decimal(p.get("committedAmount")) for p in positions), Decimal(0)),
        "totalInterested": sum((to_decimal(p.get("interestedAmount")) for p in positions), Decimal(0)),
    }
