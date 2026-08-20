"""Comisiones del fondo sobre una propiedad — capa aparte del cost stack.

`underwriting.py` es deliberadamente la única fuente de cuánto costó la
propiedad; este módulo no le toca esa pregunta, contesta una distinta: cuánto
cuesta operar el fondo sobre ella. `basis` llega ya resuelto (Decimal, sin
redondear — mismo criterio que gain()/cap_rate(): todo lo derivado redondea
una sola vez), nunca se recalcula aquí.

La comisión de salida (venta o renta) YA NO depende de `exit_strategy`
capturado: antes había que elegir un camino para ver su comisión, y nadie
sabe de antemano si va a vender o rentar — obligarlo a elegir para poder ver
el número era pedir una decisión que el pedido real no necesita. Ahora se
calculan LOS DOS escenarios siempre que haya con qué, y quien lee la ficha
compara — `exit_strategy` capturado queda en la fila, pero ya no es un
interruptor de esta cuenta.

landFee y constructionFee nunca faltan: siempre hay una base (aunque sea 0)
y un % (el default si nadie capturó uno). exitFeeVenta/exitFeeRenta sí
pueden faltar cada uno por su cuenta — sin precio de venta (real o
proyectado) no hay honestamente forma de cobrar un % de algo que no existe,
y no se adivina: se nombra en missingInputsVenta/missingInputsRenta, igual
que un exit_price ausente en waterfall.py.
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
    base_fees = land_fee + construction_fee

    sale_value = _resolve_sale_value(row)
    exit_fee_venta = sale_value * sale_pct if sale_value is not None else None
    missing_venta = [] if exit_fee_venta is not None else ["salePrice"]

    rent = _resolve_rent(row)
    exit_fee_renta = rent * rent_months if rent is not None else None
    missing_renta = [] if exit_fee_renta is not None else ["rentMonthly"]

    total_fees_venta = None if exit_fee_venta is None else base_fees + exit_fee_venta
    total_fees_renta = None if exit_fee_renta is None else base_fees + exit_fee_renta

    def _with_basis(total_fees: Decimal | None) -> Decimal | None:
        return None if (basis is None or total_fees is None) else basis + total_fees

    return {
        "landFee": money0(land_fee),
        "constructionFee": money0(construction_fee),
        "exitFeeVenta": money0(exit_fee_venta) if exit_fee_venta is not None else None,
        "exitFeeRenta": money0(exit_fee_renta) if exit_fee_renta is not None else None,
        "totalFeesVenta": money0(total_fees_venta) if total_fees_venta is not None else None,
        "totalFeesRenta": money0(total_fees_renta) if total_fees_renta is not None else None,
        "totalInvestmentWithFeesVenta": (
            money0(v) if (v := _with_basis(total_fees_venta)) is not None else None
        ),
        "totalInvestmentWithFeesRenta": (
            money0(v) if (v := _with_basis(total_fees_renta)) is not None else None
        ),
        "missingInputsVenta": missing_venta,
        "missingInputsRenta": missing_renta,
    }
