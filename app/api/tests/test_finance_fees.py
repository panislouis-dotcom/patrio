from decimal import Decimal

import pytest

from api.finance import fee_tiers, fees
from api.properties_db import PropertyError

# Sentinel para los tests de select_tier(): un valor que ninguna tasa real del
# negocio usaría, a propósito — si apareciera en el resultado por accidente
# (en vez del default real de ASSUMPTION_DEFAULTS que compute_fees() sí pasa)
# sería obvio. select_tier() no sabe nada de "venta"/"renta" ni de
# ASSUMPTION_DEFAULTS: solo recibe el default ya resuelto por quien llama.
_SENTINEL_DEFAULT = Decimal("0.42")

# Escalera de ejemplo del propio feature: Salón Escobedo — venta ≥ $6.5M → 7%,
# ≥ $5.5M → 6%. A propósito NO está en orden ascendente/descendente:
# select_tier no debe asumir orden, lo encuentra comparando.
ESCOBECO_VENTA_TIERS = [
    {"threshold": Decimal("6500000"), "rate": Decimal("0.07")},
    {"threshold": Decimal("5500000"), "rate": Decimal("0.06")},
]

# Mismo ejemplo, lado renta: ≥ $65,000/mes → 4 rentas, ≥ $55,000/mes → 3 rentas.
# `rate` aquí es un NÚMERO DE RENTAS, no una fracción — puede pasar de 1.
ESCOBECO_RENTA_TIERS = [
    {"threshold": Decimal("65000"), "rate": Decimal("4")},
    {"threshold": Decimal("55000"), "rate": Decimal("3")},
]


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
        "sale_fee_tiers": [],
        "rent_fee_tiers": [],
    }
    base.update(over)
    return base


# ── select_tier ───────────────────────────────────────────────────────────

def test_select_tier_lista_vacia_usa_el_default_que_le_pasan():
    # select_tier no conoce "venta"/"renta" ni ASSUMPTION_DEFAULTS — el default
    # es lo que sea que quien llama haya resuelto y pasado.
    assert fee_tiers.select_tier([], Decimal("9000000"), _SENTINEL_DEFAULT) == _SENTINEL_DEFAULT
    assert fee_tiers.select_tier([], Decimal("20000"), Decimal("0.03")) == Decimal("0.03")


def test_select_tier_valor_exacto_en_el_umbral_es_inclusive():
    # Justo en el límite: >= , no >. 5.5M exacto ya es el tramo del 6%, no 0%.
    assert fee_tiers.select_tier(ESCOBECO_VENTA_TIERS, Decimal("5500000"), _SENTINEL_DEFAULT) == Decimal("0.06")
    assert fee_tiers.select_tier(ESCOBECO_VENTA_TIERS, Decimal("6500000"), _SENTINEL_DEFAULT) == Decimal("0.07")


def test_select_tier_valor_arriba_de_todos_los_umbrales_gana_el_mas_alto():
    assert fee_tiers.select_tier(ESCOBECO_VENTA_TIERS, Decimal("8000000"), _SENTINEL_DEFAULT) == Decimal("0.07")


def test_select_tier_justo_debajo_de_un_umbral_cae_al_tramo_anterior():
    assert fee_tiers.select_tier(ESCOBECO_VENTA_TIERS, Decimal("6499999.99"), _SENTINEL_DEFAULT) == Decimal("0.06")
    # Justo debajo del umbral MÁS BAJO no hay tramo anterior al que caer — 0%.
    assert fee_tiers.select_tier(ESCOBECO_VENTA_TIERS, Decimal("5499999.99"), _SENTINEL_DEFAULT) == Decimal("0")


def test_select_tier_sin_piso_valor_debajo_del_umbral_es_cero():
    # No hay tramo piso. Si el valor no alcanza ningún umbral, la tasa es 0%
    # — no el `default` que pasa quien llama, ese queda reservado
    # exclusivamente para una lista completamente vacía.
    sin_piso = [{"threshold": Decimal("5000000"), "rate": Decimal("0.05")}]
    assert fee_tiers.select_tier(sin_piso, Decimal("1000"), _SENTINEL_DEFAULT) == Decimal("0")
    # Mismo comportamiento con varios tramos: por debajo del umbral más bajo
    # de una escalera de dos tramos, también gana 0%, no el tramo más bajo.
    assert fee_tiers.select_tier(ESCOBECO_VENTA_TIERS, Decimal("5000000"), _SENTINEL_DEFAULT) == Decimal("0")


def test_select_tier_sin_piso_valor_en_el_umbral_usa_la_tasa_del_tramo():
    sin_piso = [{"threshold": Decimal("5000000"), "rate": Decimal("0.05")}]
    assert fee_tiers.select_tier(sin_piso, Decimal("5000000"), _SENTINEL_DEFAULT) == Decimal("0.05")
    assert fee_tiers.select_tier(sin_piso, Decimal("8000000"), _SENTINEL_DEFAULT) == Decimal("0.05")


# ── validate_tiers ────────────────────────────────────────────────────────

def test_validate_tiers_lista_vacia_es_valida():
    fee_tiers.validate_tiers([], "venta")  # no debe lanzar
    fee_tiers.validate_tiers([], "renta")  # no debe lanzar


def test_validate_tiers_acepta_una_escalera_bien_formada():
    fee_tiers.validate_tiers(ESCOBECO_VENTA_TIERS, "venta")  # no debe lanzar
    fee_tiers.validate_tiers(ESCOBECO_RENTA_TIERS, "renta")  # no debe lanzar


def test_validate_tiers_venta_rechaza_rate_fuera_de_rango():
    with pytest.raises(PropertyError):
        fee_tiers.validate_tiers([{"threshold": Decimal("100000"), "rate": Decimal("1.5")}], "venta")
    with pytest.raises(PropertyError):
        fee_tiers.validate_tiers([{"threshold": Decimal("100000"), "rate": Decimal("-0.01")}], "venta")


def test_validate_tiers_venta_acepta_rate_en_los_bordes():
    fee_tiers.validate_tiers([{"threshold": Decimal("100000"), "rate": Decimal("0")}], "venta")
    fee_tiers.validate_tiers([{"threshold": Decimal("100000"), "rate": Decimal("1")}], "venta")


def test_validate_tiers_renta_acepta_un_numero_de_rentas_mayor_a_uno():
    # A diferencia de venta, renta NO tiene tope en 1: 3, 4 rentas son valores
    # reales del negocio, muy por arriba de una fracción de 100%.
    fee_tiers.validate_tiers([{"threshold": Decimal("55000"), "rate": Decimal("3")}], "renta")
    fee_tiers.validate_tiers([{"threshold": Decimal("55000"), "rate": Decimal("4.5")}], "renta")


def test_validate_tiers_renta_rechaza_numero_de_rentas_negativo():
    with pytest.raises(PropertyError):
        fee_tiers.validate_tiers([{"threshold": Decimal("55000"), "rate": Decimal("-1")}], "renta")


def test_validate_tiers_acepta_lista_sin_tramo_piso():
    fee_tiers.validate_tiers([{"threshold": Decimal("5000000"), "rate": Decimal("0.05")}], "venta")  # no debe lanzar


def test_validate_tiers_rechaza_cualquier_tramo_piso():
    # Ya no es "a lo más un piso" — un SOLO tramo piso ya se rechaza, no hace
    # falta un segundo para disparar el error.
    with pytest.raises(PropertyError):
        fee_tiers.validate_tiers([{"threshold": None, "rate": Decimal("0.05")}], "venta")


def test_validate_tiers_rechaza_thresholds_duplicados():
    with pytest.raises(PropertyError):
        fee_tiers.validate_tiers([
            {"threshold": Decimal("5000000"), "rate": Decimal("0.05")},
            {"threshold": Decimal("5000000"), "rate": Decimal("0.06")},
            {"threshold": Decimal("6000000"), "rate": Decimal("0.04")},
        ], "venta")


def test_validate_tiers_rechaza_threshold_negativo():
    with pytest.raises(PropertyError):
        fee_tiers.validate_tiers([
            {"threshold": Decimal("-100"), "rate": Decimal("0.05")},
            {"threshold": Decimal("6000000"), "rate": Decimal("0.04")},
        ], "venta")


def test_validate_tiers_rechaza_threshold_cero():
    with pytest.raises(PropertyError):
        fee_tiers.validate_tiers([
            {"threshold": Decimal("0"), "rate": Decimal("0.05")},
            {"threshold": Decimal("6000000"), "rate": Decimal("0.04")},
        ], "venta")


# ── compute_fees ──────────────────────────────────────────────────────────

def test_land_and_construction_fees_use_model_defaults_when_uncaptured():
    out = fees.compute_fees(_row(), basis=Decimal("1500000"))
    assert out["landFee"] == Decimal("50000")           # 5% of 1,000,000
    assert out["constructionFee"] == Decimal("75000")   # 15% of 500,000


def test_a_captured_pct_overrides_the_default():
    out = fees.compute_fees(_row(land_commission_pct=Decimal("0.10")), basis=Decimal("1500000"))
    assert out["landFee"] == Decimal("100000")


def test_los_dos_escenarios_se_calculan_siempre_sin_importar_exit_strategy():
    # No hace falta elegir un camino para ver su número: los dos se calculan
    # en cuanto hay con qué, exit_strategy capturado o no.
    out = fees.compute_fees(_row(exit_strategy=None), basis=Decimal("1500000"))
    assert out["exitFeeVenta"] == Decimal("100000")   # 5% (default) of 2,000,000 projected_sale
    assert out["exitFeeRenta"] == Decimal("45000")    # 3 rentas (default) × 15,000
    assert out["missingInputsVenta"] == []
    assert out["missingInputsRenta"] == []

    with_strategy = fees.compute_fees(_row(exit_strategy="venta"), basis=Decimal("1500000"))
    assert with_strategy["exitFeeVenta"] == out["exitFeeVenta"]
    assert with_strategy["exitFeeRenta"] == out["exitFeeRenta"]


def test_venta_usa_projected_sale_antes_de_la_venta_real():
    out = fees.compute_fees(_row(), basis=Decimal("1500000"))
    assert out["exitFeeVenta"] == Decimal("100000")   # 5% of 2,000,000 projected_sale


def test_venta_usa_sale_price_una_vez_vendida():
    out = fees.compute_fees(_row(sale_price=Decimal("2200000")), basis=Decimal("1500000"))
    assert out["exitFeeVenta"] == Decimal("110000")   # 5% of 2,200,000 sale_price, not projected_sale


def test_renta_usa_rent_monthly_projected_por_el_numero_de_rentas_del_default():
    out = fees.compute_fees(_row(), basis=Decimal("1500000"))
    assert out["exitFeeRenta"] == Decimal("45000")    # 3 rentas (default) × 15,000


def test_renta_usa_rent_monthly_actual_una_vez_rentada():
    out = fees.compute_fees(_row(rent_monthly_actual=Decimal("18000")), basis=Decimal("1500000"))
    assert out["exitFeeRenta"] == Decimal("54000")    # 3 rentas × 18,000, not projected


def test_total_fees_y_total_investment_with_fees_suman_las_tres_por_escenario():
    out = fees.compute_fees(_row(), basis=Decimal("1500000"))
    assert out["totalFeesVenta"] == Decimal("50000") + Decimal("75000") + Decimal("100000")
    assert out["totalFeesRenta"] == Decimal("50000") + Decimal("75000") + Decimal("45000")
    assert out["totalInvestmentWithFeesVenta"] == Decimal("1500000") + out["totalFeesVenta"]
    assert out["totalInvestmentWithFeesRenta"] == Decimal("1500000") + out["totalFeesRenta"]


def test_sin_basis_no_hay_total_investment_with_fees_en_ningun_escenario():
    out = fees.compute_fees(_row(), basis=None)
    assert out["totalInvestmentWithFeesVenta"] is None
    assert out["totalInvestmentWithFeesRenta"] is None
    # las líneas individuales SÍ existen — no dependen de basis, solo el total lo hace
    assert out["landFee"] == Decimal("50000")
    assert out["exitFeeVenta"] == Decimal("100000")


def test_venta_sin_projected_sale_ni_sale_price_nombra_el_faltante_solo_del_lado_de_venta():
    out = fees.compute_fees(_row(projected_sale=None, sale_price=None), basis=Decimal("1500000"))
    assert out["exitFeeVenta"] is None
    assert out["totalFeesVenta"] is None
    assert out["totalInvestmentWithFeesVenta"] is None
    assert "salePrice" in out["missingInputsVenta"]
    # El lado de renta no se contagia: sigue calculándose con lo que sí tiene.
    assert out["exitFeeRenta"] == Decimal("45000")
    assert out["missingInputsRenta"] == []


def test_renta_sin_ninguna_renta_nombra_el_faltante_solo_del_lado_de_renta():
    out = fees.compute_fees(
        _row(rent_monthly_projected=None, rent_monthly_actual=None), basis=Decimal("1500000"))
    assert out["exitFeeRenta"] is None
    assert out["totalFeesRenta"] is None
    assert out["totalInvestmentWithFeesRenta"] is None
    assert "rentMonthly" in out["missingInputsRenta"]
    # El lado de venta no se contagia.
    assert out["exitFeeVenta"] == Decimal("100000")
    assert out["missingInputsVenta"] == []


def test_sin_ningun_dato_de_salida_faltan_los_dos_escenarios_por_separado():
    out = fees.compute_fees(
        _row(projected_sale=None, sale_price=None, rent_monthly_projected=None, rent_monthly_actual=None),
        basis=Decimal("1500000"),
    )
    assert out["exitFeeVenta"] is None
    assert out["exitFeeRenta"] is None
    assert "salePrice" in out["missingInputsVenta"]
    assert "rentMonthly" in out["missingInputsRenta"]
    # Y lo que no depende de la salida sigue ahí — nunca se apaga la ficha entera
    # porque falte un solo insumo.
    assert out["landFee"] == Decimal("50000")
    assert out["constructionFee"] == Decimal("75000")


def test_sin_saleFeeTiers_ni_rentFeeTiers_en_la_fila_se_comporta_como_lista_vacia():
    # Filas reales de hoy no traen estas keys todavía (las llena una tarea
    # posterior) — compute_fees debe seguir funcionando igual que con [] explícito.
    row = _row()
    del row["sale_fee_tiers"]
    del row["rent_fee_tiers"]
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeVenta"] == Decimal("100000")
    assert out["exitFeeRenta"] == Decimal("45000")


def test_locked_oracle():
    """Números de mano, congelados — mismo patrón que test_metrics_matches_locked_oracle."""
    row = _row(
        purchase_price=Decimal("3200000"),
        construction_budgeted=Decimal("880000"),
        rent_monthly_projected=Decimal("22000"),
        land_commission_pct=Decimal("0.05"),
        construction_commission_pct=Decimal("0.15"),
    )
    out = fees.compute_fees(row, basis=Decimal("4500000"))
    assert out["landFee"] == Decimal("160000")       # 3,200,000 * 0.05
    assert out["constructionFee"] == Decimal("132000")  # 880,000 * 0.15
    assert out["exitFeeRenta"] == Decimal("66000")   # 22,000 * 3 rentas (default)
    assert out["totalFeesRenta"] == Decimal("358000")
    assert out["totalInvestmentWithFeesRenta"] == Decimal("4858000")


# ── compute_fees con una escalera real configurada ──────────────────────────

def test_compute_fees_con_escalera_de_venta_debajo_de_todos_los_umbrales_es_cero():
    row = _row(projected_sale=Decimal("5000000"), sale_fee_tiers=ESCOBECO_VENTA_TIERS)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeVenta"] == Decimal("0")


def test_compute_fees_con_escalera_de_venta_en_el_umbral_inferior_exacto():
    row = _row(projected_sale=Decimal("5500000"), sale_fee_tiers=ESCOBECO_VENTA_TIERS)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeVenta"] == Decimal("330000")  # 6% de 5,500,000


def test_compute_fees_con_escalera_sin_piso_debajo_del_unico_umbral_es_cero():
    sin_piso = [{"threshold": Decimal("6500000"), "rate": Decimal("0.07")}]
    row = _row(projected_sale=Decimal("5000000"), sale_fee_tiers=sin_piso)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeVenta"] == Decimal("0")


def test_compute_fees_con_escalera_de_venta_en_el_umbral_superior_exacto():
    row = _row(projected_sale=Decimal("6500000"), sale_fee_tiers=ESCOBECO_VENTA_TIERS)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeVenta"] == Decimal("455000")  # 7% de 6,500,000


# ── exitFeeVentaRate / exitFeeRentaMonths — la tasa/número vigente, aparte del monto ──

def test_sin_escalera_ni_valor_la_tasa_es_el_default_del_modelo():
    # El "caso base": propiedad recién creada, sin tramos y sin precio/renta
    # todavía. La tasa/número ya se conoce — es el default— aunque el monto no.
    out = fees.compute_fees(
        _row(projected_sale=None, sale_price=None,
             rent_monthly_projected=None, rent_monthly_actual=None),
        basis=Decimal("1500000"),
    )
    assert out["exitFeeVenta"] is None
    assert out["exitFeeRenta"] is None
    assert out["exitFeeVentaRate"] == Decimal("0.05")
    assert out["exitFeeRentaMonths"] == Decimal("3")


def test_con_escalera_configurada_pero_sin_valor_la_tasa_es_null():
    # Hay tramos, pero sin precio de venta no hay contra qué evaluarlos —
    # a diferencia del caso sin escalera, aquí la tasa de verdad no se sabe.
    row = _row(projected_sale=None, sale_price=None, sale_fee_tiers=ESCOBECO_VENTA_TIERS)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeVenta"] is None
    assert out["exitFeeVentaRate"] is None


def test_con_escalera_de_renta_configurada_pero_sin_valor_el_numero_es_null():
    row = _row(rent_monthly_projected=None, rent_monthly_actual=None, rent_fee_tiers=ESCOBECO_RENTA_TIERS)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeRenta"] is None
    assert out["exitFeeRentaMonths"] is None


def test_con_escalera_configurada_y_valor_la_tasa_es_la_del_tramo_ganador():
    row = _row(projected_sale=Decimal("5500000"), sale_fee_tiers=ESCOBECO_VENTA_TIERS)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeVentaRate"] == Decimal("0.06")


def test_con_escalera_de_renta_configurada_y_valor_el_numero_es_el_del_tramo_ganador():
    row = _row(rent_monthly_projected=Decimal("55000"), rent_fee_tiers=ESCOBECO_RENTA_TIERS)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeRentaMonths"] == Decimal("3")


def test_compute_fees_con_escalera_de_venta_arriba_de_todo():
    row = _row(projected_sale=Decimal("9000000"), sale_fee_tiers=ESCOBECO_VENTA_TIERS)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeVenta"] == Decimal("630000")  # 7% de 9,000,000, no interpola


# ── compute_fees con una escalera de renta configurada ──────────────────────

def test_compute_fees_con_escalera_de_renta_debajo_de_todos_los_umbrales_es_cero():
    row = _row(rent_monthly_projected=Decimal("40000"), rent_fee_tiers=ESCOBECO_RENTA_TIERS)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeRenta"] == Decimal("0")


def test_compute_fees_con_escalera_de_renta_en_el_umbral_inferior_exacto():
    row = _row(rent_monthly_projected=Decimal("55000"), rent_fee_tiers=ESCOBECO_RENTA_TIERS)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeRenta"] == Decimal("165000")  # 3 rentas × 55,000


def test_compute_fees_con_escalera_de_renta_arriba_de_todo():
    row = _row(rent_monthly_projected=Decimal("90000"), rent_fee_tiers=ESCOBECO_RENTA_TIERS)
    out = fees.compute_fees(row, basis=Decimal("1500000"))
    assert out["exitFeeRenta"] == Decimal("360000")  # 4 rentas × 90,000, no interpola
