"""Comisiones del fondo sobre una propiedad — capa aparte del cost stack.

`underwriting.py` es deliberadamente la única fuente de cuánto costó la
propiedad; este módulo no le toca esa pregunta, contesta una distinta: cuánto
cuesta operar el fondo sobre ella. `basis` llega ya resuelto (Decimal, sin
redondear — mismo criterio que gain()/cap_rate(): todo lo derivado redondea
una sola vez), nunca se recalcula aquí.

exitFee es la única línea que puede faltar: sin exit_strategy no hay forma
honesta de saber si aplica el % de venta o los meses de renta, y no se
adivina — se nombra en missingInputs, igual que un exit_price ausente en
waterfall.py. landFee y constructionFee nunca faltan: siempre hay una base
(aunque sea 0) y un % (el default si nadie capturó uno).
"""
from decimal import Decimal

from .quantize import money0, to_decimal
from .underwriting import assumption


def _resolve_sale_value(row: dict) -> Decimal | None:
    """Precio de venta REAL una vez que existe, la proyección mientras tanto —
    mismo relevo que gain()/roi ya usan en underwriting.py."""
    sale_price = row.get("sale_price")
    if sale_price:
        return to_decimal(sale_price)
    projected = row.get("projected_sale")
    return to_decimal(projected) if projected else None


def _resolve_rent(row: dict) -> Decimal | None:
    """Renta COBRADA una vez que existe, la proyectada mientras tanto."""
    actual = row.get("rent_monthly_actual")
    if actual:
        return to_decimal(actual)
    projected = row.get("rent_monthly_projected")
    return to_decimal(projected) if projected else None


def compute_fees(row: dict, basis: Decimal | None) -> dict:
    land_pct = to_decimal(assumption(row, "land_commission_pct")[0])
    construction_pct = to_decimal(assumption(row, "construction_commission_pct")[0])
    sale_pct = to_decimal(assumption(row, "exit_sale_commission_pct")[0])
    rent_months = to_decimal(assumption(row, "exit_rent_months")[0])

    land_fee = to_decimal(row.get("purchase_price")) * land_pct
    construction_fee = to_decimal(row.get("construction_budgeted")) * construction_pct

    missing: list[str] = []
    exit_strategy = row.get("exit_strategy")
    exit_fee: Decimal | None
    if exit_strategy == "venta":
        sale_value = _resolve_sale_value(row)
        if sale_value is None:
            exit_fee = None
            missing.append("salePrice")
        else:
            exit_fee = sale_value * sale_pct
    elif exit_strategy == "renta":
        rent = _resolve_rent(row)
        if rent is None:
            exit_fee = None
            missing.append("rentMonthly")
        else:
            exit_fee = rent * rent_months
    else:
        exit_fee = None
        missing.append("exitStrategy")

    total_fees = None if exit_fee is None else land_fee + construction_fee + exit_fee
    total_with_fees = (
        None if (basis is None or total_fees is None) else basis + total_fees
    )

    return {
        "landFee": money0(land_fee),
        "constructionFee": money0(construction_fee),
        "exitFee": money0(exit_fee) if exit_fee is not None else None,
        "exitFeeMode": exit_strategy,
        "totalFees": money0(total_fees) if total_fees is not None else None,
        "totalInvestmentWithFees": money0(total_with_fees) if total_with_fees is not None else None,
        "missingInputs": missing,
    }
