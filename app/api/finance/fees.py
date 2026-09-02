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

from .fee_tiers import select_tier
from .quantize import money0, to_decimal
from .underwriting import ASSUMPTION_DEFAULTS, assumption


def resolve_sale_value(row: dict) -> Decimal | None:
    """Precio de venta REAL una vez que existe, la proyección mientras tanto —
    mismo relevo que gain()/roi ya usan en underwriting.py."""
    sale_price = row.get("sale_price")
    if sale_price:
        return to_decimal(sale_price)
    projected = row.get("projected_sale")
    return to_decimal(projected) if projected else None


def resolve_rent(row: dict) -> Decimal | None:
    """Renta COBRADA una vez que existe, la proyectada mientras tanto."""
    actual = row.get("rent_monthly_actual")
    if actual:
        return to_decimal(actual)
    projected = row.get("rent_monthly_projected")
    return to_decimal(projected) if projected else None


def compute_fees(row: dict, basis: Decimal | None) -> dict:
    land_pct = to_decimal(assumption(row, "land_commission_pct")[0])
    construction_pct = to_decimal(assumption(row, "construction_commission_pct")[0])

    land_fee = to_decimal(row.get("purchase_price")) * land_pct
    construction_fee = to_decimal(row.get("construction_budgeted")) * construction_pct
    base_fees = land_fee + construction_fee

    # La comisión de salida ya no es un % plano: es una escalera de tramos por
    # valor alcanzado (finance/fee_tiers.py), y el tramo que aplica depende del
    # valor — al revés que land/construction arriba, aquí hay que resolver el
    # valor PRIMERO y recién entonces preguntar qué tasa le toca. Pero la TASA
    # en sí solo depende del valor cuando hay tramos que elegir entre ellos:
    # sin tramos configurados la tasa es el default fijo, conocido aunque
    # todavía no exista con qué cobrarlo — por eso se resuelve aparte del
    # monto, y la ficha puede mostrarla incluso antes de tener precio/renta.
    sale_tiers = row.get("sale_fee_tiers", [])
    sale_value = resolve_sale_value(row)
    if sale_value is not None:
        sale_pct = select_tier(sale_tiers, sale_value, ASSUMPTION_DEFAULTS["exit_sale_commission_pct"])
    elif not sale_tiers:
        sale_pct = ASSUMPTION_DEFAULTS["exit_sale_commission_pct"]
    else:
        sale_pct = None
    exit_fee_venta = sale_value * sale_pct if (sale_value is not None and sale_pct is not None) else None
    missing_venta = [] if exit_fee_venta is not None else ["salePrice"]

    # Base de la comisión de renta: un NÚMERO DE RENTAS (meses de renta cobrada
    # o proyectada) — no una fracción de un solo mes. El fondo cobra 2-4 meses
    # de renta como comisión de colocación, y esa magnitud real no cabe en el
    # mismo molde de "% de precio" que usa venta, así que el tramo alcanzado
    # aplica su número de rentas directo sobre la renta mensual que
    # resolve_rent ya resuelve: `exit_fee_renta = meses × renta_mensual`.
    # Mismo relevo que arriba: sin tramos, el número de rentas es el default
    # fijo (`exit_rent_commission_months`).
    rent_tiers = row.get("rent_fee_tiers", [])
    rent = resolve_rent(row)
    if rent is not None:
        rent_months = select_tier(rent_tiers, rent, ASSUMPTION_DEFAULTS["exit_rent_commission_months"])
    elif not rent_tiers:
        rent_months = ASSUMPTION_DEFAULTS["exit_rent_commission_months"]
    else:
        rent_months = None
    exit_fee_renta = rent * rent_months if (rent is not None and rent_months is not None) else None
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
        # El tramo alcanzado (o el default si la escalera está vacía) — ver
        # comentario arriba. Nunca money0: venta es una TASA (fracción de
        # precio), renta es un NÚMERO DE RENTAS (meses) — no son la misma
        # unidad, por eso no comparten nombre de campo.
        "exitFeeVentaRate": sale_pct,
        "exitFeeRentaMonths": rent_months,
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
