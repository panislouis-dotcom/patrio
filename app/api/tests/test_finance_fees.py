from decimal import Decimal

from api.finance import fees


def _row(**over):
    base = {
        "purchase_price": Decimal("1000000"),
        "acquisition_cost_pct": None,   # not this module's concern, but present on a real row
        "construction_budgeted": Decimal("500000"),
        "projected_sale": Decimal("2000000"),
        "sale_price": None,
        "rent_monthly_projected": Decimal("15000"),
        "rent_monthly_actual": None,
        "exit_strategy": None,
        "land_commission_pct": None,
        "construction_commission_pct": None,
        "exit_sale_commission_pct": None,
        "exit_rent_months": None,
    }
    base.update(over)
    return base


def test_land_and_construction_fees_use_model_defaults_when_uncaptured():
    out = fees.compute_fees(_row(), basis=Decimal("1500000"))
    assert out["landFee"] == Decimal("50000")           # 5% of 1,000,000
    assert out["constructionFee"] == Decimal("75000")   # 15% of 500,000


def test_a_captured_pct_overrides_the_default():
    out = fees.compute_fees(_row(land_commission_pct=Decimal("0.10")), basis=Decimal("1500000"))
    assert out["landFee"] == Decimal("100000")


def test_sin_exit_strategy_no_exit_fee_y_se_nombra_el_faltante():
    out = fees.compute_fees(_row(exit_strategy=None), basis=Decimal("1500000"))
    assert out["exitFee"] is None
    assert out["totalFees"] is None
    assert out["totalInvestmentWithFees"] is None
    assert "exitStrategy" in out["missingInputs"]


def test_venta_usa_projected_sale_antes_de_la_venta_real():
    out = fees.compute_fees(_row(exit_strategy="venta"), basis=Decimal("1500000"))
    assert out["exitFee"] == Decimal("100000")   # 5% of 2,000,000 projected_sale


def test_venta_usa_sale_price_una_vez_vendida():
    out = fees.compute_fees(
        _row(exit_strategy="venta", sale_price=Decimal("2200000")), basis=Decimal("1500000"))
    assert out["exitFee"] == Decimal("110000")   # 5% of 2,200,000 sale_price, not projected_sale


def test_renta_usa_rent_monthly_projected_por_los_meses_configurados():
    out = fees.compute_fees(_row(exit_strategy="renta"), basis=Decimal("1500000"))
    assert out["exitFee"] == Decimal("45000")    # 15,000 * 3


def test_renta_usa_rent_monthly_actual_una_vez_rentada():
    out = fees.compute_fees(
        _row(exit_strategy="renta", rent_monthly_actual=Decimal("18000")), basis=Decimal("1500000"))
    assert out["exitFee"] == Decimal("54000")    # 18,000 * 3, not projected


def test_total_fees_y_total_investment_with_fees_suman_las_tres():
    out = fees.compute_fees(_row(exit_strategy="venta"), basis=Decimal("1500000"))
    assert out["totalFees"] == Decimal("50000") + Decimal("75000") + Decimal("100000")
    assert out["totalInvestmentWithFees"] == Decimal("1500000") + out["totalFees"]


def test_sin_basis_no_hay_total_investment_with_fees():
    out = fees.compute_fees(_row(exit_strategy="venta"), basis=None)
    assert out["totalInvestmentWithFees"] is None
    # las líneas individuales SÍ existen — no dependen de basis, solo el total lo hace
    assert out["landFee"] == Decimal("50000")


def test_locked_oracle():
    """Números de mano, congelados — mismo patrón que test_metrics_matches_locked_oracle."""
    row = _row(
        purchase_price=Decimal("3200000"),
        construction_budgeted=Decimal("880000"),
        exit_strategy="renta",
        rent_monthly_projected=Decimal("22000"),
        land_commission_pct=Decimal("0.05"),
        construction_commission_pct=Decimal("0.15"),
        exit_rent_months=Decimal("3"),
    )
    out = fees.compute_fees(row, basis=Decimal("4500000"))
    assert out["landFee"] == Decimal("160000")       # 3,200,000 * 0.05
    assert out["constructionFee"] == Decimal("132000")  # 880,000 * 0.15
    assert out["exitFee"] == Decimal("66000")        # 22,000 * 3
    assert out["totalFees"] == Decimal("358000")
    assert out["totalInvestmentWithFees"] == Decimal("4858000")
