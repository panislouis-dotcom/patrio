"""Profit-split waterfall — Decimal port of the former profit_db logic.
Money exact; ratios (tier, isr, split pcts) coerced to Decimal.

Regla de la casa: ningún renglón de este estado se calcula sobre un número
inventado. Cada insumo llega acompañado de su procedencia (`*Source`) y, cuando
no existe, el renglón vale `None` y el insumo se nombra en `missingInputs` —
en lugar de un cero que se lee como un hecho.
"""
from datetime import date, timedelta
from decimal import Decimal

from .analysis import months_between, parse_date
from .quantize import to_decimal
from .investor import cuota

_D0 = Decimal(0)

# Los supuestos por omisión viven aquí, con nombre y en un solo lugar, para que
# la propiedad pueda sobreescribirlos y la interfaz pueda decir "esto es un
# supuesto". Una constante escondida en medio de una fórmula no puede hacer ni
# lo uno ni lo otro.
DEFAULT_MONTHS = 12
DEFAULT_ISR_RATE = Decimal("0.30")
DEFAULT_INVESTOR_RATE = 0.12


def compute_bonus_tier(config: dict, conclusion_date=None) -> Decimal | None:
    """0.50 / 0.25 / 0.0 / None (None = cannot determine)."""
    planned = config.get("plannedEndDate")
    buffer = config.get("bufferDays") or 0
    if not planned or buffer <= 0:
        return None
    p = parse_date(planned)
    a = parse_date(config.get("actualEndDate") or conclusion_date)
    if p is None or a is None:
        return None
    early_threshold = p - timedelta(days=buffer)
    half_threshold = p - timedelta(days=buffer // 2)
    if a <= early_threshold:
        return Decimal("0.50")
    if a <= half_threshold:
        return Decimal("0.25")
    return _D0


def missing_bonus_inputs(config: dict, conclusion_date=None) -> list[str]:
    """Qué le falta al bono por entregar a tiempo para poder encenderse.

    Se pintan tres escalones de dinero; si ninguno puede activarse nunca, la
    tabla miente. Nombrar el faltante es lo que convierte tres columnas muertas
    en tres columnas que esperan un dato."""
    missing = []
    if not config.get("plannedEndDate"):
        missing.append("plannedEndDate")
    if not (config.get("bufferDays") or 0) > 0:
        missing.append("bufferDays")
    if not (config.get("actualEndDate") or conclusion_date):
        missing.append("actualEndDate")
    return missing


def _pct(config: dict, key: str) -> Decimal:
    return to_decimal(config.get(key) or 0)


def _share(amount: Decimal | None, factor: Decimal) -> Decimal | None:
    """Una parte de un monto que puede no existir: sin monto, no hay parte."""
    return None if amount is None else amount * factor


def _split(amount: Decimal | None, n: Decimal) -> Decimal | None:
    return None if amount is None else amount / n


def _compute_splits_for_tier(tier, finder_amount, director_amount, responsable_amount,
                             lider_amount, maestro_pool, ayudante_pool, residual, config,
                             team_by_id, directors, m_count, a_count, maestro_ids, ayudante_ids) -> dict:
    def _entry(label, member_id, pct, base, bonus):
        member = team_by_id.get(member_id) or {}
        return {"label": label, "id": member_id, "name": member.get("name"),
                "role": member.get("role"), "pct": pct, "base": base, "bonus": bonus,
                "total": None if base is None else base + bonus}

    splits = []
    finder_id = config.get("finderMemberId")
    if finder_id is not None:
        splits.append(_entry("Finder", finder_id, _pct(config, "finderFeePct"),
                             finder_amount, _share(finder_amount, tier)))
    if directors:
        n = Decimal(len(directors))
        per_base = _split(director_amount, n)
        per_bonus = _split(_share(director_amount, tier), n)
        for d in directors:
            splits.append(_entry("Director", d["id"], _pct(config, "directorPct") / n, per_base, per_bonus))
    responsable_id = config.get("responsableMemberId")
    if responsable_id is not None:
        splits.append(_entry("Responsable", responsable_id, _pct(config, "responsablePct"),
                             responsable_amount, _share(responsable_amount, tier)))
    lider_id = config.get("liderMemberId")
    if lider_id is not None:
        splits.append(_entry("Líder", lider_id, _pct(config, "liderPct"),
                             lider_amount, _share(lider_amount, tier)))
    mc_val = config.get("maestroCount")
    if maestro_ids or (mc_val is not None and mc_val > 0):
        mc = Decimal(m_count)
        per_base = _split(maestro_pool, mc)
        per_bonus = _split(_share(maestro_pool, tier), mc)
        for mid in maestro_ids:
            splits.append(_entry("Maestro", mid, _pct(config, "maestroPct") / mc, per_base, per_bonus))
        for _ in range(m_count - len(maestro_ids)):
            splits.append({"label": "Maestro", "pct": _pct(config, "maestroPct") / mc, "id": None,
                           "name": "—", "role": "maestro", "base": per_base, "bonus": per_bonus,
                           "total": None if per_base is None else per_base + per_bonus})
    ac_val = config.get("ayudanteCount")
    if ayudante_ids or (ac_val is not None and ac_val > 0):
        ac = Decimal(a_count)
        per_base = _split(ayudante_pool, ac)
        per_bonus = _split(_share(ayudante_pool, tier), ac)
        for aid in ayudante_ids:
            splits.append(_entry("Ayudante", aid, _pct(config, "ayudantePct") / ac, per_base, per_bonus))
        for _ in range(a_count - len(ayudante_ids)):
            splits.append({"label": "Ayudante", "pct": _pct(config, "ayudantePct") / ac, "id": None,
                           "name": "—", "role": "ayudante", "base": per_base, "bonus": per_bonus,
                           "total": None if per_base is None else per_base + per_bonus})
    if residual is None:
        company_residual = None
    else:
        total_bonuses = sum((s["bonus"] for s in splits), _D0)
        company_residual = max(_D0, residual - total_bonuses)
    return {"splits": splits, "companyResidual": company_residual}


def _resolve_exit_price(prop: dict, config: dict) -> tuple[Decimal | None, str | None]:
    """De dónde sale el precio de salida, mejor evidencia primero: lo que el
    operador capturó en esta configuración, luego el precio al que la propiedad
    de verdad se vendió, luego la última valuación.

    Sin ninguno de los tres no hay salida. Antes se caía a 0 y el reparto
    publicaba "GANANCIA BRUTA = −inversión" como si fuera un renglón de estado
    financiero; ahora no hay renglón que publicar."""
    if config.get("exitPrice"):
        return to_decimal(config["exitPrice"]), "capturado"
    if prop.get("salePrice"):
        return to_decimal(prop["salePrice"]), "venta"
    if prop.get("currentValuation"):
        return to_decimal(prop["currentValuation"]), "valuacion"
    return None, None


def _months_deployed(prop: dict) -> int | None:
    """Los meses que el capital lleva trabajando: de la adquisición a la venta,
    o a hoy si todavía no se vende. Sin compra no hay capital desplegado.

    No es `holdMonthsActual` y no puede serlo: ese congela en la primera renta
    porque mide en cuánto la propiedad se volvió productiva, que es una pregunta
    de pantalla. El dinero del inversionista no se detiene ahí — sigue adentro
    mientras la propiedad esté rentada y hasta que se venda."""
    acquisition = parse_date(prop.get("acquisitionDate"))
    if acquisition is None:
        return None
    return months_between(acquisition, parse_date(prop.get("saleDate")) or date.today())


def _resolve_months(prop: dict, config: dict) -> tuple[int, str]:
    """El plazo sobre el que corre la cuota del inversionista: el capturado, el
    real si la propiedad ya lo tiene, el proyectado si no, y solo entonces el
    supuesto de la casa.

    «El real» aquí es el plazo del CAPITAL, y por eso se calcula en vez de leer
    `holdMonthsActual`. Cuando ambos medían lo mismo daba igual cuál se leyera;
    desde que el plazo real congela en la primera renta, leerlo le cobraría al
    inversionista una fracción de los meses que su dinero estuvo adentro —
    de la primera renta en adelante saldrían gratis— y el faltante se le queda
    al operador sin que ningún renglón del estado lo diga."""
    if config.get("investorMonths"):
        return int(config["investorMonths"]), "capturado"
    deployed = _months_deployed(prop)
    if deployed:
        return deployed, "real"
    if prop.get("holdMonths"):
        return int(prop["holdMonths"]), "proyectado"
    return DEFAULT_MONTHS, "supuesto"


def _resolve_investors(config: dict, property_investors, months) -> tuple:
    """El costo del capital de terceros sale de lo que está registrado.

    Sin capital registrado el costo es cero, y lo que falta es capturar a los
    inversionistas — que es una cosa muy distinta de suponer que toda la
    inversión es de ellos al 12% anual y cobrarle esa cuota a la ganancia."""
    if config.get("investorCapital"):
        capital = to_decimal(config["investorCapital"])
        rate = config.get("investorRateAnnual") or DEFAULT_INVESTOR_RATE
        fee = cuota(capital, rate, months)
        return capital, fee, [{"investorId": None, "name": "Capital (capturado)",
                               "fundedAmount": capital, "interestRateAnnual": rate,
                               "cuota": fee, "totalReturn": capital + fee}], "capturado"

    fondeados = [pi for pi in (property_investors or []) if pi.get("status") == "fondeado"]
    if fondeados:
        breakdown = []
        for pi in fondeados:
            funded = to_decimal(pi.get("fundedAmount"))
            rate = pi.get("interestRateAnnual") or DEFAULT_INVESTOR_RATE
            fee = cuota(funded, rate, months)
            breakdown.append({
                "investorId": pi.get("investorId"), "name": pi.get("investorName", "—"),
                "fundedAmount": funded, "interestRateAnnual": rate,
                "cuota": fee, "totalReturn": funded + fee,
            })
        capital = sum((e["fundedAmount"] for e in breakdown), _D0)
        return capital, sum((e["cuota"] for e in breakdown), _D0), breakdown, "fondeado"

    return _D0, _D0, [], None


def compute_waterfall(prop: dict, config: dict, team: list[dict],
                      property_investors: list[dict] = None) -> dict:
    missing: list[str] = []

    investment = prop.get("totalInvestment")
    investment = to_decimal(investment) if investment else None
    if investment is None:
        missing.append("investment")

    exit_price, exit_price_source = _resolve_exit_price(prop, config)
    if exit_price is None:
        missing.append("exitPrice")

    months, months_source = _resolve_months(prop, config)
    isr_rate = to_decimal(config["isrRate"]) if config.get("isrRate") is not None else DEFAULT_ISR_RATE

    investor_capital, investor_cuota, investor_breakdown, investor_capital_source = \
        _resolve_investors(config, property_investors, months)
    if investor_capital_source is None:
        missing.append("investorCapital")

    computable = exit_price is not None and investment is not None
    gross_profit = exit_price - investment if computable else None
    operator_gross = gross_profit - investor_cuota if computable else None
    isr = max(_D0, operator_gross * isr_rate) if computable else None
    net_profit = operator_gross - isr if computable else None
    distributable = max(_D0, net_profit) if computable else None

    finder_amount = _share(distributable, _pct(config, "finderFeePct"))
    remaining = None if distributable is None else distributable - finder_amount
    director_amount = _share(remaining, _pct(config, "directorPct"))
    responsable_amount = _share(remaining, _pct(config, "responsablePct"))
    lider_amount = _share(remaining, _pct(config, "liderPct"))
    maestro_pool = _share(remaining, _pct(config, "maestroPct"))
    ayudante_pool = _share(remaining, _pct(config, "ayudantePct"))
    if distributable is None:
        residual = None
    else:
        allocated = (finder_amount + director_amount + responsable_amount
                     + lider_amount + maestro_pool + ayudante_pool)
        residual = max(_D0, distributable - allocated)

    team_by_id = {m["id"]: m for m in team}
    directors = [m for m in team if m.get("role") == "director"]
    maestro_ids = config.get("maestroMemberIds") or []
    mc = config.get("maestroCount")
    m_count = max(1, mc if (mc is not None and mc > 0) else (len(maestro_ids) or 1))
    m_count = max(m_count, len(maestro_ids))
    ayudante_ids = config.get("ayudanteMemberIds") or []
    ac = config.get("ayudanteCount")
    a_count = max(1, ac if (ac is not None and ac > 0) else (len(ayudante_ids) or 1))
    a_count = max(a_count, len(ayudante_ids))

    shared = dict(finder_amount=finder_amount, director_amount=director_amount,
                  responsable_amount=responsable_amount, lider_amount=lider_amount,
                  maestro_pool=maestro_pool, ayudante_pool=ayudante_pool, residual=residual,
                  config=config, team_by_id=team_by_id, directors=directors,
                  m_count=m_count, a_count=a_count, maestro_ids=maestro_ids, ayudante_ids=ayudante_ids)
    scenarios = {
        "sin_bono": _compute_splits_for_tier(tier=_D0, **shared),
        "bono_25": _compute_splits_for_tier(tier=Decimal("0.25"), **shared),
        "bono_50": _compute_splits_for_tier(tier=Decimal("0.50"), **shared),
    }
    # When the work actually concluded: the sale for a flip, the first rent for
    # a hold. Neither exists while the property is still in desarrollo, and then
    # only an explicit actualEndDate can settle the on-time bonus.
    conclusion = prop.get("saleDate") or prop.get("firstRentDate")
    return {"exitPrice": exit_price, "exitPriceSource": exit_price_source,
            "investment": investment, "grossProfit": gross_profit,
            "investorCapital": investor_capital, "investorCapitalSource": investor_capital_source,
            "investorCuota": investor_cuota, "operatorGross": operator_gross,
            "isrRate": isr_rate, "isr": isr,
            "netProfit": net_profit, "distributable": distributable,
            "activeTier": compute_bonus_tier(config, conclusion),
            "bonusInputsMissing": missing_bonus_inputs(config, conclusion),
            "months": months, "monthsSource": months_source,
            "missingInputs": missing,
            "investorBreakdown": investor_breakdown, "scenarios": scenarios}
