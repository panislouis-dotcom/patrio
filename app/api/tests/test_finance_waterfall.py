from decimal import Decimal
from api.finance.waterfall import compute_waterfall


def _base():
    prop = {"totalInvestment": 5_000_000, "currentValuation": 7_000_000,
            "holdMonthsActual": 12, "firstRentDate": "2026-06"}
    config = {"isrRate": 0.30, "investorRateAnnual": 0.12, "finderFeePct": 0.0,
              "directorPct": 0.0, "responsablePct": 0.0, "liderPct": 0.0,
              "maestroPct": 0.0, "ayudantePct": 0.0}
    return prop, config


def test_waterfall_keys_and_decimal_types():
    prop, config = _base()
    w = compute_waterfall(prop, config, team=[], property_investors=[])
    for k in ("exitPrice", "investment", "grossProfit", "investorCuota",
              "operatorGross", "isr", "netProfit", "distributable",
              "activeTier", "months", "investorBreakdown", "scenarios"):
        assert k in w
    assert isinstance(w["grossProfit"], Decimal)
    # gross = 7M - 5M = 2M
    assert w["grossProfit"] == Decimal("2000000")


def test_waterfall_runs_on_decimal_inputs():
    """Simulates post-migration reads: money arrives as Decimal, must not raise."""
    prop, config = _base()
    prop["totalInvestment"] = Decimal("5000000.00")
    prop["currentValuation"] = Decimal("7000000.00")
    w = compute_waterfall(prop, config, team=[], property_investors=[
        {"status": "fondeado", "investorId": 1, "investorName": "A",
         "fundedAmount": Decimal("1000000.00"), "interestRateAnnual": 0.12},
    ])
    assert w["investorCuota"] == Decimal("120000.00")  # 1M*0.12*12/12


def test_a_real_sale_beats_the_last_valuation():
    """Once the property has actually sold, the split runs on the price it sold
    for — the mark it was carried at is history."""
    prop, config = _base()
    prop["salePrice"] = Decimal("8000000.00")
    w = compute_waterfall(prop, config, team=[], property_investors=[])
    assert w["exitPrice"] == Decimal("8000000.00")
    assert w["exitPriceSource"] == "venta"
    assert w["grossProfit"] == Decimal("3000000.00")


# ── Insumos que no se inventan ───────────────────────────────────────────────

def test_without_funded_investors_no_fee_is_invented():
    """Sin capital fondeado registrado el costo del capital de terceros es cero,
    y lo que falta es capturarlos. Suponer que toda la inversión es de ellos al
    12% le restaba 600k a la ganancia sin decirlo."""
    prop, config = _base()
    w = compute_waterfall(prop, config, team=[], property_investors=[])
    assert w["investorCuota"] == Decimal(0)
    assert w["investorCapital"] == Decimal(0)
    assert w["investorCapitalSource"] is None
    assert w["investorBreakdown"] == []
    assert "investorCapital" in w["missingInputs"]
    # La ganancia del operador ya no carga una cuota fabricada.
    assert w["operatorGross"] == w["grossProfit"] == Decimal("2000000")


def test_manual_capital_is_labelled_as_captured():
    prop, config = _base()
    config["investorCapital"] = 3_000_000
    w = compute_waterfall(prop, config, team=[], property_investors=[])
    assert w["investorCapitalSource"] == "capturado"
    assert w["investorCuota"] == Decimal("360000.00")  # 3M*0.12*12/12
    assert "investorCapital" not in w["missingInputs"]


def test_funded_investors_are_labelled_as_funded():
    prop, config = _base()
    w = compute_waterfall(prop, config, team=[], property_investors=[
        {"status": "fondeado", "investorId": 1, "investorName": "A",
         "fundedAmount": 1_000_000, "interestRateAnnual": 0.12},
        {"status": "comprometido", "investorId": 2, "investorName": "B",
         "fundedAmount": 0, "interestRateAnnual": 0.12},
    ])
    assert w["investorCapitalSource"] == "fondeado"
    assert w["investorCapital"] == Decimal("1000000")
    assert len(w["investorBreakdown"]) == 1  # el comprometido todavía no cuesta


def test_the_exit_price_says_where_it_came_from():
    prop, config = _base()
    assert compute_waterfall(prop, config, [])["exitPriceSource"] == "valuacion"
    prop["salePrice"] = 8_000_000
    assert compute_waterfall(prop, config, [])["exitPriceSource"] == "venta"
    config["exitPrice"] = 9_000_000
    w = compute_waterfall(prop, config, [])
    assert w["exitPriceSource"] == "capturado"
    assert w["exitPrice"] == Decimal("9000000")


def test_without_an_exit_there_is_no_split():
    """Una propiedad en desarrollo sin avalúo no tiene salida. Antes caía a 0 y
    publicaba GANANCIA BRUTA = −inversión como si fuera un hecho."""
    w = compute_waterfall({"totalInvestment": 5_000_000}, {}, team=[])
    assert w["exitPrice"] is None
    assert w["exitPriceSource"] is None
    assert "exitPrice" in w["missingInputs"]
    for key in ("grossProfit", "operatorGross", "isr", "netProfit", "distributable"):
        assert w[key] is None, key
    assert w["scenarios"]["sin_bono"]["companyResidual"] is None


def test_without_investment_there_is_no_split():
    """Un precio de salida menos una inversión que nadie capturó no es ganancia."""
    w = compute_waterfall({"currentValuation": 7_000_000}, {}, team=[])
    assert "investment" in w["missingInputs"]
    assert w["investment"] is None
    assert w["grossProfit"] is None


def test_an_incomplete_split_pays_nobody_a_number():
    """Los renglones por persona tampoco se rellenan con ceros."""
    config = {"finderMemberId": 7, "finderFeePct": 0.10}
    w = compute_waterfall({"totalInvestment": 5_000_000}, config,
                          team=[{"id": 7, "name": "Ana", "role": "director"}])
    finder = w["scenarios"]["bono_50"]["splits"][0]
    assert finder["base"] is None and finder["bonus"] is None and finder["total"] is None


def test_the_months_say_where_they_came_from():
    prop, config = _base()
    assert compute_waterfall(prop, config, [])["monthsSource"] == "real"
    prop.pop("holdMonthsActual")
    prop["holdMonths"] = 18
    w = compute_waterfall(prop, config, [])
    assert (w["months"], w["monthsSource"]) == (18, "proyectado")
    prop.pop("holdMonths")
    w = compute_waterfall(prop, config, [])
    assert (w["months"], w["monthsSource"]) == (12, "supuesto")
    config["investorMonths"] = 24
    w = compute_waterfall(prop, config, [])
    assert (w["months"], w["monthsSource"]) == (24, "capturado")


def test_the_investor_fee_runs_to_the_sale_not_to_the_first_rent():
    """El plazo real congela en la primera renta; el dinero del inversionista no.
    Adquirida 2025-01, rentada 2026-03 y vendida 2026-07: la cuota corre sobre
    los 18 meses hasta la venta, no sobre los 14 que dice `holdMonthsActual`.

    Con 1,000,000 fondeado al 12% son 180,000 a 18 meses y 140,000 a 14. Cobrar
    el plazo congelado le paga 40,000 de menos al inversionista y esos 40,000 se
    le quedan al operador —entran a `operatorGross`— sin que ningún renglón del
    estado diga que salieron de ahí."""
    prop, config = _base()
    prop.update({"acquisitionDate": "2025-01", "firstRentDate": "2026-03",
                 "saleDate": "2026-07", "salePrice": Decimal("8000000.00"),
                 "holdMonthsActual": 14})
    w = compute_waterfall(prop, config, team=[], property_investors=[
        {"status": "fondeado", "investorId": 1, "investorName": "A",
         "fundedAmount": Decimal("1000000.00"), "interestRateAnnual": 0.12},
    ])
    assert (w["months"], w["monthsSource"]) == (18, "real")
    assert w["investorCuota"] == Decimal("180000.00")
    assert w["investorBreakdown"][0]["totalReturn"] == Decimal("1180000.00")


# ── El bono por entregar a tiempo ────────────────────────────────────────────

def test_the_bonus_can_actually_switch_on():
    """Los tres escalones de bono existen porque uno puede encenderse."""
    prop, config = _base()
    config.update(plannedEndDate="2026-06-30", bufferDays=30, actualEndDate="2026-05-01")
    w = compute_waterfall(prop, config, team=[])
    assert w["activeTier"] == Decimal("0.50")
    assert w["bonusInputsMissing"] == []


def test_the_bonus_names_what_it_is_missing():
    prop, config = _base()
    w = compute_waterfall(prop, config, team=[])
    assert w["activeTier"] is None
    assert set(w["bonusInputsMissing"]) == {"plannedEndDate", "bufferDays"}
    # firstRentDate ya cierra la obra: actualEndDate no hace falta.
    assert "actualEndDate" not in w["bonusInputsMissing"]
