from decimal import Decimal

from api.finance.quantize import money, money0, frac4, pct2, to_decimal


def test_to_decimal_from_float_is_exact():
    assert to_decimal(0.1) == Decimal("0.1")


def test_money0_rounds_half_away_from_zero_like_postgres():
    assert money0(Decimal("0.5")) == Decimal("1")
    assert money0(Decimal("2.5")) == Decimal("3")


def test_money_two_dp():
    assert money(Decimal("1234.005")) == Decimal("1234.01")


def test_frac4_four_dp():
    assert frac4(Decimal("0.12345")) == Decimal("0.1235")


def test_pct2_two_dp():
    assert pct2(Decimal("12.345")) == Decimal("12.35")


from api.finance import underwriting as uw

# Clean inputs (float-exact) so Decimal output matches the float4 SQL view byte-for-byte.
#
# `construction_budgeted` son los 2,340,000 que la fórmula vieja producía con
# 200 m² × 9,000 × 1.3 — el mismo dinero, dicho como lo dice ahora el
# presupuesto: una cifra que llega entera y con el overhead ya adentro.
# `sqm_construction` sigue aquí porque sigue siendo metraje físico, y ya no
# pone precio a nada.
INPUTS = dict(
    purchase_price=1_000_000, acquisition_cost_pct=0.065,
    permits_cost=50_000, subdivision_cost=25_000,
    construction_budgeted=2_340_000, sqm_construction=200,
    projected_sale=2_500_000,
    hold_months=18, rent_monthly_projected=18_000, sqm_land=300,
)

_RAW_ARGS = ("purchase_price", "acquisition_cost_pct", "permits_cost", "subdivision_cost",
             "construction_budgeted")


def test_investment_raw_unrounded_single_expression():
    # 1_000_000*1.065 + 50_000 + 25_000 + 2_340_000 = 1_065_000 + 75_000 + 2_340_000
    assert uw.investment_raw(**{k: INPUTS[k] for k in _RAW_ARGS}) == Decimal("3480000.000")


def test_the_budgeted_work_enters_whole_and_is_never_multiplied():
    """El riesgo central del cambio de fuente: el overhead ya está DENTRO de la
    cifra presupuestada —se aplicó una sola vez, al sembrar— así que el stack
    tiene que sumarla tal cual. Si algún factor sobreviviera aquí, cada costo de
    obra crecería 30% sin un solo test rojo y sin nada que se viera roto.

    2,340,000 presupuestados suman 2,340,000. No 3,042,000."""
    solo_obra = dict(purchase_price=0, acquisition_cost_pct=0,
                     permits_cost=0, subdivision_cost=0,
                     construction_budgeted=2_340_000)
    assert uw.investment_raw(**solo_obra) == Decimal("2340000")
    assert uw.investment(solo_obra) == Decimal("2340000")


def test_the_stack_takes_no_multiplier_it_could_re_apply():
    """No es solo que no se aplique: es que no hay dónde pasarlo. Un overhead
    que se pudiera enviar es un overhead que alguien puede volver a enviar."""
    import inspect
    assert "overhead" not in inspect.signature(uw.investment_raw).parameters
    assert "construction_overhead" not in uw.ASSUMPTION_DEFAULTS


# Regression oracle: the exact figures the prospect_metrics view produced for INPUTS
# (locked here before the view was dropped in migration 020). A future change that
# breaks the round-of-sum discipline — summing pre-rounded sub-totals instead of the
# single unrounded investment_raw — would drift these by ~1 peso and fail.
# cap_rate is the one figure that no longer matches the old view exactly: it briefly
# became yield on cost (216,000 / 3,480,000 = 0.0621, 2026-07 through 2026-08) before
# reverting to NOI / market value — same shape as the view's own formula, just without
# its fabricated 0.70 opex haircut (216,000 / 2,500,000 = 0.0864 vs. the view's
# 151,200 / 2,500,000 = 0.0605).
#
# `construction_base` y `construction_total` ya no salen de aquí: la obra llega
# entera y la publica el módulo del presupuesto, junto a lo comprometido y lo
# pagado contra ella. El total que producían —2,340,000— sigue dentro de
# `total_investment`, que es lo que esta ancla existe para fijar.
_EXPECTED = {
    "total_investment": Decimal("3480000"),
    "acquisition_costs": Decimal("65000"),
    "acquisition_total": Decimal("1065000"),
    "profit": Decimal("-980000"),
    "cap_rate": Decimal("0.0864"),
    "purchase_price_per_sqm": Decimal("3333.33"),
    "sale_per_sqm": Decimal("8333.33"),
    "investment_per_sqm": Decimal("11600.00"),
    "rent_annual": Decimal("216000"),
    "roi": Decimal("-0.1979"),
    "roi_total": Decimal("-0.2816"),
}


def test_metrics_matches_locked_oracle(client, test_property):
    """finance.underwriting reproduces the figures the prospect_metrics view
    produced, reading a real properties row (the view itself is long gone) con
    el costo de obra de su presupuesto."""
    from api import budget_db
    from api.db import get_db
    with get_db() as conn:
        conn.execute(
            """UPDATE properties SET purchase_price=%s, acquisition_cost_pct=%s, permits_cost=%s,
                   subdivision_cost=%s, sqm_construction=%s, projected_sale=%s, hold_months=%s,
                   rent_monthly_projected=%s, sqm_land=%s WHERE id=%s""",
            (INPUTS["purchase_price"], INPUTS["acquisition_cost_pct"], INPUTS["permits_cost"],
             INPUTS["subdivision_cost"], INPUTS["sqm_construction"], INPUTS["projected_sale"],
             INPUTS["hold_months"], INPUTS["rent_monthly_projected"], INPUTS["sqm_land"],
             test_property["id"]))
        budget_db.set_total(conn, test_property["id"], INPUTS["construction_budgeted"])
        base = conn.execute("SELECT * FROM properties WHERE id=%s",
                            (test_property["id"],)).fetchone()
        total = conn.execute(
            budget_db.totals_sql("%s"), (test_property["id"],)).fetchone()

    m = uw.metrics(dict(base, **total))
    for key, expected in _EXPECTED.items():
        assert m[key] == expected, f"{key}: {m[key]} != {expected}"


def test_metrics_zero_guards_return_none():
    m = uw.metrics(dict(
        purchase_price=0, acquisition_cost_pct=0, permits_cost=0, subdivision_cost=0,
        construction_budgeted=0, sqm_construction=0,
        projected_sale=0, hold_months=0, rent_monthly_projected=0, sqm_land=0,
    ))
    assert m["roi"] is None
    assert m["roi_total"] is None
    assert m["profit"] is None
    assert m["cap_rate"] is None
    assert m["rent_annual"] is None
    assert m["purchase_price_per_sqm"] is None


# ── El precio de compra se cuenta una vez ─────────────────────────────────────

def test_the_purchase_price_is_not_counted_twice():
    """Comprar una casa ya construida cuesta el precio de compra más sus costos
    de adquisición, y nada más. Lo edificado no se vuelve a sumar: la obra son
    los metros que TÚ vas a ejecutar, y aquí no hay ninguno."""
    built_house = dict(
        purchase_price=4_000_000, acquisition_cost_pct=0.065,
        permits_cost=0, subdivision_cost=0,
        construction_budgeted=0, sqm_construction=0,
        projected_sale=None, hold_months=None, rent_monthly_projected=None, sqm_land=None,
    )
    assert uw.metrics(built_house)["total_investment"] == Decimal("4260000")


def test_the_work_to_execute_is_what_gets_added_on_top():
    """La misma casa con 780,000 presupuestados de obra: el precio de compra no
    se mueve y encima aparecen exactamente esos 780,000."""
    remodel = dict(
        purchase_price=4_000_000, acquisition_cost_pct=0.065,
        permits_cost=0, subdivision_cost=0,
        construction_budgeted=780_000, sqm_construction=100,
        projected_sale=None, hold_months=None, rent_monthly_projected=None, sqm_land=None,
    )
    m = uw.metrics(remodel)
    assert m["acquisition_total"] == Decimal("4260000")
    assert m["total_investment"] == Decimal("5040000")


# ── The one gain, applied to three different exits ───────────────────────────

def test_gain_is_the_exit_minus_the_basis():
    assert uw.gain(3_480_000, 5_000_000) == Decimal("1520000")
    assert uw.gain_pct(3_480_000, 5_000_000) == Decimal("0.4368")


def test_a_loss_is_reported_as_a_loss():
    assert uw.gain(3_480_000, 2_500_000) == Decimal("-980000")
    assert uw.gain_pct(3_480_000, 2_500_000) == Decimal("-0.2816")


def test_no_exit_value_means_no_gain_never_zero():
    """0 means "not captured" for every exit in this domain — a modeled sale
    that does not exist, a valuation nobody made. Reporting 0 would claim the
    property broke even; reporting the negative would claim it lost everything."""
    for absent in (0, None):
        assert uw.gain(3_480_000, absent) is None
        assert uw.gain_pct(3_480_000, absent) is None


def test_no_basis_means_no_gain():
    for absent in (0, None):
        assert uw.gain(absent, 5_000_000) is None
        assert uw.gain_pct(absent, 5_000_000) is None


# ── Supuestos: valor vigente y de dónde salió ────────────────────────────────

def test_an_absent_assumption_is_the_model_default_and_says_so():
    for key, default in uw.ASSUMPTION_DEFAULTS.items():
        assert uw.assumption({}, key) == (default, "default")


def test_a_stored_assumption_is_a_decision_and_says_so():
    row = dict(acquisition_cost_pct=0.08, hold_months=24)
    assert uw.assumption(row, "acquisition_cost_pct") == (0.08, "captured")
    assert uw.assumptions(row) == {
        "acquisition_cost_pct": {"value": 0.08, "source": "captured"},
        "hold_months": {"value": 24, "source": "captured"},
        "land_commission_pct": {"value": Decimal("0.05"), "source": "default"},
        "construction_commission_pct": {"value": Decimal("0.15"), "source": "default"},
        "exit_sale_commission_pct": {"value": Decimal("0.05"), "source": "default"},
        "exit_rent_months": {"value": Decimal("3"), "source": "default"},
    }


def test_the_overhead_is_no_longer_an_assumption():
    """Un supuesto es un número que el modelo aplica cuando nadie eligió, y que
    por eso hay que poder ver. El overhead ya no aplica nada: se usó una vez
    para calcular el primer renglón del presupuesto y ahí quedó, dentro del
    importe. Publicarlo seguiría poniendo en la ficha una cifra editable que no
    mueve un peso."""
    assert "construction_overhead" not in uw.assumptions({})
    assert tuple(uw.ASSUMPTION_KEYS) == (
        "acquisition_cost_pct", "hold_months",
        "land_commission_pct", "construction_commission_pct",
        "exit_sale_commission_pct", "exit_rent_months",
    )


def test_capturing_the_default_value_changes_only_the_provenance():
    """Un supuesto vacío y uno capturado con el mismo número dan el mismo dinero.
    Lo único que cambia es que uno lo eligió alguien, y eso es lo que la ficha
    tiene que poder decir."""
    absent = dict(INPUTS, acquisition_cost_pct=None, hold_months=None)
    captured = dict(INPUTS, acquisition_cost_pct=0.065, hold_months=12)
    assert uw.metrics(absent)["total_investment"] == uw.metrics(captured)["total_investment"]
    assert uw.assumptions(absent)["hold_months"]["source"] == "default"
    assert uw.assumptions(captured)["hold_months"]["source"] == "captured"


def test_the_basis_is_always_the_cost_stack():
    """Una sola resolución: la base ES el desglose. No hay segundo número que
    pueda contradecirla ni procedencia que reportar."""
    assert uw.basis(INPUTS) == uw.investment(INPUTS) == Decimal("3480000.000")


def test_a_missing_component_is_worth_zero_not_a_missing_basis():
    """Antes, un costo vacío tumbaba el «desglose completo» y la base se caía a
    None. Ahora vale 0 y la base sigue siendo la suma de lo que sí se capturó."""
    assert uw.basis(dict(INPUTS, permits_cost=None)) == Decimal("3430000.000")


def test_an_all_in_total_captured_as_purchase_price_is_exactly_that_total():
    """La capacidad que se retiró al borrar la inversión tecleada: un total
    all-in que nadie quiere desglosar se captura como precio de compra con el
    pct de adquisición en 0, y la base da ese total al peso.

    El 0 EXPLÍCITO es la mitad del trato: dejarlo vacío significa «aplica el
    6.5% del sistema» y le sumaría $617,500 a un total que ya venía completo."""
    all_in = {"purchase_price": 9_500_000, "acquisition_cost_pct": 0}
    assert uw.basis(all_in) == Decimal("9500000")

    sin_el_cero = {"purchase_price": 9_500_000}
    assert uw.basis(sin_el_cero) == Decimal("10117500.000")


def test_a_stack_that_sums_to_zero_is_no_basis_at_all():
    """Cero no es una base de capital: es que nadie ha capturado nada. Publicar
    $0 lo convertiría en una medición, y la ficha tiene que seguir diciendo «—».
    Es exactamente el estado de una propiedad recién dada de alta, cuyos cinco
    costos nacen en 0 por CAPTURE_DEFAULTS."""
    assert uw.basis({}) is None
    assert uw.basis(dict.fromkeys(uw.COST_KEYS, 0)) is None


def test_cap_rate_is_noi_over_market_value():
    # 18,000*12 = 216,000 over a 2,500,000 market value
    assert uw.cap_rate(18_000, 2_500_000) == Decimal("0.0864")


def test_cap_rate_none_without_positive_market_value():
    assert uw.cap_rate(18_000, 0) is None
    assert uw.cap_rate(18_000, None) is None
    assert uw.cap_rate(18_000, -3_480_000) is None


def test_cap_rate_none_without_positive_rent():
    assert uw.cap_rate(0, 3_480_000) is None
    assert uw.cap_rate(None, 3_480_000) is None
    assert uw.cap_rate(-18_000, 3_480_000) is None


def test_rent_annual_is_twelve_months_or_nothing():
    assert uw.rent_annual(18_000) == Decimal("216000")
    assert uw.rent_annual(0) is None
    assert uw.rent_annual(None) is None
    assert uw.rent_annual(-18_000) is None


def test_the_underwriting_stack_reads_the_projected_rent():
    """`metrics()` es el modelo, no el estado de cuenta: aunque la propiedad ya
    cobre renta, esta capa responde por lo que se proyectó."""
    m = uw.metrics(dict(INPUTS, rent_monthly_actual=90_000))
    assert m["rent_annual"] == Decimal("216000")
    assert m["cap_rate"] == Decimal("0.0864")


def test_metrics_cap_rate_moves_with_projected_sale():
    """El denominador es el valor de mercado (venta proyectada), así que un
    cambio en la salida SÍ mueve el cap rate — al revés de cuando el
    denominador era el costo."""
    m = uw.metrics(dict(INPUTS))
    cheaper_exit = uw.metrics(dict(INPUTS, projected_sale=1_000_000))
    assert m["cap_rate"] == Decimal("0.0864")
    assert cheaper_exit["cap_rate"] == Decimal("0.2160")
    assert cheaper_exit["cap_rate"] != m["cap_rate"]
