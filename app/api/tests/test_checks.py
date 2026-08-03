"""Stage-aware checks: what a property is judged on depends on where it is in
its life. A prospecto is judged on how complete its model is; a building under
construction on its capital and dates; a rented one on how fresh its valuation
is; a sold one on whether the record closes."""
from datetime import date

from api.checks import run_checks, stage_requirements
from api.properties_db import metrics


def _row(**overrides) -> dict:
    """A raw property row with a complete, healthy pre-purchase model."""
    return {
        "id": 1, "name": "Test", "status": "prospecto",
        "latitude": 25.68, "longitude": -100.33,
        "purchase_price": 3_000_000, "sqm_land": 100, "sqm_construction": 200,
        "acquisition_cost_pct": 0.06, "permits_cost": 0, "subdivision_cost": 0,
        "construction_cost_per_sqm": 6_000, "construction_overhead": 1.3,
        "projected_sale": 8_000_000, "hold_months": 18, "rent_monthly_projected": 20_000,
        "total_units": None, "acquisition_date": None, "first_rent_date": None,
        "sale_date": None, "sale_price": None, "total_investment_captured": None,
        "rent_monthly_actual": None,
        "current_valuation": None, "valuation_date": None,
        **overrides,
    }


def _issues(row: dict, today: date | None = None):
    return run_checks(row, metrics(row), today=today)


def _fields(row: dict, severity: str, today: date | None = None):
    return {i.field for i in _issues(row, today) if i.severity == severity}


# ── Pre-purchase ─────────────────────────────────────────────────────────────

def test_a_complete_model_has_nothing_wrong_with_it():
    assert _issues(_row()) == []


def test_missing_coordinates_are_errors():
    assert "latitude" in _fields(_row(latitude=0), "error")
    assert "longitude" in _fields(_row(longitude=None), "error")


def test_a_price_or_a_lot_of_zero_is_an_error():
    assert "purchasePrice" in _fields(_row(purchase_price=0), "error")
    assert "sqmLand" in _fields(_row(sqm_land=0), "error")


def test_a_negative_projection_is_an_error():
    assert "projectedRoi" in _fields(_row(projected_sale=1_000_000), "error")


def test_an_overhead_below_one_is_an_error():
    assert "constructionOverhead" in _fields(_row(construction_overhead=0.9), "error")


def test_soft_pre_purchase_warnings():
    assert "constructionCostPerSqm" in _fields(_row(construction_cost_per_sqm=0), "warning")
    assert "rentMonthlyProjected" in _fields(_row(rent_monthly_projected=None), "warning")
    assert "acquisitionCostPct" in _fields(_row(acquisition_cost_pct=0.12), "warning")
    assert "projectedProfit" in _fields(_row(projected_sale=4_000_000), "warning")


def test_oferta_must_model_its_exit():
    assert "projectedSale" in _fields(_row(status="oferta", projected_sale=None), "error")


# ── Post-purchase ────────────────────────────────────────────────────────────

def _bought(**overrides) -> dict:
    return _row(**{"status": "desarrollo", "total_units": 4,
                   "acquisition_date": date(2025, 1, 1),
                   "current_valuation": 5_000_000,
                   "valuation_date": date(2026, 1, 1), **overrides})


def test_the_pre_purchase_warnings_stop_once_it_is_bought():
    """Whether the model was tidy stops being the question after the purchase —
    otherwise every building carries prospect complaints forever."""
    fields = {i.field for i in _issues(_bought(rent_monthly_projected=None, latitude=0))}
    assert "latitude" not in fields
    assert "acquisitionCostPct" not in fields


def test_desarrollo_demands_its_capital_and_dates():
    assert "acquisitionDate" in _fields(_bought(acquisition_date=None), "error")
    assert "totalUnits" in _fields(_bought(total_units=None), "error")


def test_buying_does_not_demand_an_appraisal():
    """Comprar no produce un avalúo. Exigir una valuación el día de la compra
    solo lograba que se inventara —el modal la rellenaba con la venta
    proyectada—, y una plusvalía que nace igualada al plan no es una plusvalía.
    Sin valuación la métrica es None, que es la respuesta honesta."""
    for status in ("desarrollo", "en_renta"):
        row = _bought(status=status, current_valuation=None,
                      first_rent_date=date(2025, 6, 1), rent_monthly_actual=10_000)
        assert "currentValuation" not in _fields(row, "error")


def test_desarrollo_warns_when_the_investment_was_typed_in():
    manual = _bought(purchase_price=None, total_investment_captured=5_000_000)
    assert "totalInvestmentCaptured" in _fields(manual, "warning")
    assert "totalInvestmentCaptured" not in _fields(_bought(), "error")


def test_a_stale_valuation_is_a_warning():
    fresh = _bought(status="en_renta", first_rent_date=date(2025, 6, 1),
                    valuation_date=date(2026, 1, 1))
    assert "valuationDate" not in _fields(fresh, "warning", today=date(2026, 6, 1))
    assert "valuationDate" in _fields(fresh, "warning", today=date(2028, 6, 1))


def test_an_undated_valuation_is_a_warning():
    assert "valuationDate" in _fields(_bought(valuation_date=None), "warning")


def test_en_renta_without_a_captured_rent_is_an_error():
    """Only reachable by emptying the field after the fact — which is exactly
    what makes it worth checking on every read."""
    row = _bought(status="en_renta", first_rent_date=date(2025, 6, 1), rent_monthly_actual=None)
    assert "rentMonthlyActual" in _fields(row, "error")


def test_vendida_wants_the_record_closed():
    sold = _row(status="vendida", sale_date=date(2026, 7, 1), sale_price=5_000_000,
                acquisition_date=None, purchase_price=None)
    fields = {i.field for i in _issues(sold)}
    assert "acquisitionDate" in fields   # no hold, so no realized ROI
    assert "totalInvestmentCaptured" in fields   # no basis, so no realized gain


# ── The mirror ───────────────────────────────────────────────────────────────

def test_stage_requirements_mirror_the_cross_field_checks():
    """These are table CHECKs in migration 024. Restating them here is what
    turns a would-be 500 into a 422."""
    row = _row(acquisition_date=date(2026, 1, 1), first_rent_date=date(2025, 1, 1))
    assert "firstRentDate" in stage_requirements("prospecto", row)
    row = _row(acquisition_date=date(2026, 1, 1), sale_date=date(2025, 1, 1))
    assert "saleDate" in stage_requirements("prospecto", row)


def test_a_zero_rent_is_never_admissible():
    assert "rentMonthlyProjected" in stage_requirements("prospecto", _row(rent_monthly_projected=0))
    assert "rentMonthlyActual" in stage_requirements("prospecto", _row(rent_monthly_actual=0))


def test_archivada_is_asked_for_nothing():
    assert stage_requirements("archivada", _row(purchase_price=None)) == {}


def test_a_typed_total_that_disagrees_with_the_breakdown_is_a_warning():
    """Las dos versiones de la inversión conviven: el desglose manda, pero el
    total capturado no se borra ni se esconde. Si no cuadran, uno de los dos
    está mal y hay que decirlo en vez de elegir en silencio."""
    # El desglose del fixture suma 3,000,000×1.06 + 200×6,000×1.3 = 4,740,000.
    assert "totalInvestmentCaptured" in _fields(
        _bought(total_investment_captured=6_000_000), "warning")
    assert "totalInvestmentCaptured" not in _fields(
        _bought(total_investment_captured=4_740_000), "warning")


def test_a_rounded_typed_total_is_not_a_disagreement():
    """Un peso de diferencia es cómo se teclea un número, no un desacuerdo sobre
    cuánto se invirtió."""
    assert "totalInvestmentCaptured" not in _fields(
        _bought(total_investment_captured=4_740_100), "warning")


def test_a_partial_breakdown_larger_than_the_typed_total_cannot_add_up():
    """Con el desglose incompleto manda el total tecleado y los costos que sí se
    capturaron son una PARTE de él — que la ficha pinta como barras más un renglón
    «sin desglosar» por el resto. Una parte mayor que el todo deja al desglose sin
    forma de sumar su propio total, y es el único caso en que no puede cuadrar.

    Vaciar `permits_cost` rompe el desglose; los costos que quedan siguen sumando
    4,740,000, así que un total tecleado de 3,000,000 no los cubre."""
    partial = _bought(permits_cost=None)
    assert "totalInvestmentCaptured" in _fields(
        partial | {"total_investment_captured": 3_000_000}, "warning")
    assert "totalInvestmentCaptured" not in {
        i.field for i in _issues(partial | {"total_investment_captured": 6_000_000})
        if "suman más" in i.message}


def test_a_valuation_before_the_purchase_has_no_period_to_annualize():
    """La fecha de valuación ahora es el reloj del ROI de la marca: si es
    anterior a la compra el periodo sale negativo y no hay ROI que dar."""
    row = _bought(acquisition_date=date(2025, 6, 1), valuation_date=date(2025, 1, 1),
                  current_valuation=6_000_000)
    assert "valuationDate" in _fields(row, "warning")
    assert metrics(row)["roi"] is None


def test_en_renta_wants_the_cap_rate_of_what_it_collects():
    """La renta estimada no salva a una propiedad rentada de no haber capturado
    lo que cobra: el aviso mira `capRateActual`."""
    rented = _bought(status="en_renta", first_rent_date=date(2025, 6, 1),
                     rent_monthly_actual=None)
    assert "capRateActual" in _fields(rented, "warning")
    assert "capRateActual" not in _fields(
        _bought(status="en_renta", first_rent_date=date(2025, 6, 1),
                rent_monthly_actual=20_000), "warning")
