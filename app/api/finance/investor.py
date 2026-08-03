"""Investor return metrics — the single home for cuota/expected_return/return_pct,
matching the project_investor_metrics view (migration 000)."""
from datetime import date
from decimal import Decimal

from .analysis import months_between
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


def funnel_status(interested_amount, committed_amount, funded_amount) -> str:
    """El estado de una posición es una lectura de su dinero, no un campo aparte.

    Vivía copiado en tres formularios del front, y uno de ellos mandaba
    `committedAmount: 0` siempre — así que "comprometido" era inalcanzable desde
    la ficha de la propiedad. Una sola definición, del lado que escribe."""
    if to_decimal(funded_amount) > 0:
        return "fondeado"
    if to_decimal(committed_amount) > 0:
        return "comprometido"
    return "interesado"


def hold_months(acquisition: date | None, conclusion: date | None, today: date | None = None) -> int:
    """Months the money has been in: acquisition → conclusion, or → today while the
    position is open. 0 without an acquisition date — nothing has been held yet."""
    if acquisition is None:
        return 0
    return months_between(acquisition, conclusion or today or date.today())


def totals(positions: list[dict]) -> dict:
    """Portfolio sums over camelCase position dicts."""
    return {
        "totalFunded": sum((to_decimal(p.get("fundedAmount")) for p in positions), Decimal(0)),
        "totalCommitted": sum((to_decimal(p.get("committedAmount")) for p in positions), Decimal(0)),
        "totalInterested": sum((to_decimal(p.get("interestedAmount")) for p in positions), Decimal(0)),
    }
