"""Unit tests for the pure HTML/SVG builders in prospectus_html.py — no DB,
no client, straight function calls. Integration behavior (does the right data
reach the right property) lives in test_documents.py."""
import re

from api.lib.prospectus_html import (ProspectusSections, _budget_full, _development_card,
                                     _fee_scenario_missing,
                                     _fmt_mxn, _opportunity, _opportunity_detail,
                                     _opportunity_fees_metrics,
                                     _photo_block, _photo_rows, _plan_block, _plan_rows, _rented_card,
                                     _sold_card, _summary_card, _BODY_CSS, _BUDGET_TWO_COLUMN_THRESHOLD)

BASE_PROPERTY = {
    "name": "[TEST] Casa Prueba",
    # landFee/constructionFee nunca faltan (compute_fees() siempre resuelve
    # una base y un %) — toda tarjeta que pasa por _opportunity() los da por
    # sentados (acceso directo, no .get), así que viven en la base para que
    # cada test no tenga que repetirlos.
    "landFee": 150_000, "landCommissionPct": 0.05,
    "constructionFee": 420_000, "constructionCommissionPct": 0.15,
}


# ---------------------------------------------------------------------------
# Inversión sin/con comisiones — cada tarjeta decide qué escenario(s) de salida
# le pasa a `_inv_value()` como sub-línea de la celda "Inversión sin
# comisiones" (mismo patrón que ya usan "Ganancia realizada" y "Ganancia
# proyectada" para su detalle secundario). `compute_fees()` (fees.py) calcula
# venta y renta siempre, sin depender de una estrategia de salida elegida —
# pero una vendida solo pasa venta (renta sería contrafactual: nunca se
# cobró) y una rentada solo pasa renta, en espejo. Desarrollo sigue pasando
# los dos: la salida sigue genuinamente indecisa. Oportunidad ya no pasa
# ninguno — su detalle vive en la fila nueva (`_opportunity_fees_metrics`,
# más abajo). Resumen ya no llama a `_inv_value()`.
# ---------------------------------------------------------------------------

def test_sold_card_shows_the_venta_scenario_as_a_sub_line():
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000,
         "totalInvestmentWithFeesVenta": 1_150_000, "totalInvestmentWithFeesRenta": None}
    html = _sold_card(p, "Kicker")
    assert "Inversión sin comisiones" in html
    assert "Inversión total" not in html
    assert "<small>V $1.1M c/comisiones</small>" in html


def test_sold_card_never_shows_the_renta_scenario_even_when_the_data_exists():
    """La corrección del bug real: compute_fees() cae a un relevo
    real→proyectado y puede traer totalInvestmentWithFeesRenta con valor
    aunque la propiedad jamás se rentó — imprimirlo en una tarjeta de VENTA
    sería una comisión contrafactual, sin ninguna marca de que lo es."""
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000,
         "totalInvestmentWithFeesVenta": 1_150_000, "totalInvestmentWithFeesRenta": 1_200_000}
    html = _sold_card(p, "Kicker")
    assert "<small>V $1.1M c/comisiones</small>" in html
    assert "R $" not in html


def test_sold_card_omits_the_sub_line_without_the_venta_with_fees_figure():
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000,
         "totalInvestmentWithFeesVenta": None, "totalInvestmentWithFeesRenta": 1_200_000}
    html = _sold_card(p, "Kicker")
    assert "Inversión sin comisiones" in html
    assert "c/comisiones" not in html


def test_rented_card_shows_the_renta_scenario_as_a_sub_line():
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000,
         "totalInvestmentWithFeesVenta": None, "totalInvestmentWithFeesRenta": 1_200_000}
    html = _rented_card(p, "Kicker")
    assert "Inversión sin comisiones" in html
    assert "Inversión total" not in html
    assert "<small>R $1.2M c/comisiones</small>" in html


def test_rented_card_never_shows_the_venta_scenario_even_when_the_data_exists():
    """Espejo del bug de _sold_card: venta es contrafactual en una tarjeta
    que reporta lo que la propiedad de verdad hace hoy — rentar."""
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000,
         "totalInvestmentWithFeesVenta": 1_150_000, "totalInvestmentWithFeesRenta": 1_200_000}
    html = _rented_card(p, "Kicker")
    assert "<small>R $1.2M c/comisiones</small>" in html
    assert "V $" not in html


def test_rented_card_omits_the_sub_line_without_the_renta_with_fees_figure():
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000,
         "totalInvestmentWithFeesVenta": 1_150_000, "totalInvestmentWithFeesRenta": None}
    html = _rented_card(p, "Kicker")
    assert "c/comisiones" not in html


def test_development_card_shows_both_with_fees_scenarios_as_a_sub_line():
    """Sin cambios: en desarrollo la salida sigue genuinamente indecisa, y la
    tarjeta ya es de proyección pura — los dos escenarios siguen siendo
    igual de hipotéticos, así que ninguno es más contrafactual que el otro."""
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000,
         "totalInvestmentWithFeesVenta": 1_150_000, "totalInvestmentWithFeesRenta": 1_200_000}
    html = _development_card(p, "Kicker")
    assert "Inversión sin comisiones" in html
    assert "Inversión total" not in html
    assert "<small>V $1.1M · R $1.2M c/comisiones</small>" in html


def test_development_card_omits_the_sub_line_without_either_with_fees_figure():
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000,
         "totalInvestmentWithFeesVenta": None, "totalInvestmentWithFeesRenta": None}
    html = _development_card(p, "Kicker")
    assert "c/comisiones" not in html


def test_opportunity_card_shows_the_payback_period_instead_of_bare_investment():
    """"Inversión sin comisiones" salió de esta fila — pedido explícito,
    reemplazada por el plazo de recuperación. La tarjeta LEE `paybackMonths`
    del API, no lo recalcula: el mismo criterio que ya sigue con
    projectedProfit, capRate, etc. Se enseña en años (pedido explícito),
    aunque el campo del API siga en meses — 223 / 12 = 18.6."""
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000, "paybackMonths": 223}
    html = _opportunity(p)
    assert '<div class="v">18.6 años</div><div class="l">Plazo de recuperación</div>' in html
    assert '<div class="l">Inversión sin comisiones</div>' not in html


def test_opportunity_card_payback_period_is_a_dash_without_one():
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000, "paybackMonths": None}
    html = _opportunity(p)
    assert '<div class="v">—</div><div class="l">Plazo de recuperación</div>' in html


def test_opportunity_card_shows_yield_on_cost_next_to_cap_rate_as_a_sixth_cell():
    """Pedido explícito: un sexto cuadro, "rendimiento sobre inversión" — el
    yield on cost que capRate dejó de ser — AL LADO del cap rate de mercado,
    no en su lugar. La fila pasa de .metrics-5 a .metrics-6. Las dos
    etiquetas van sin calificar ("Cap rate", "Rendimiento sobre inversión")
    — pedido explícito, tras ver los calificadores envolver a 2-3 líneas: el
    nombre distinto de cada una ya dice cuál es cuál, a diferencia de
    _development_card() (sin un vecino "Rendimiento"), que sí conserva
    "Cap rate proy. s/ venta"."""
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000, "capRate": 0.0864, "yieldOnCost": 0.0539}
    html = _opportunity(p)
    assert '<div class="v">8.6%</div><div class="l">Cap rate</div>' in html
    assert '<div class="v">5.4%</div><div class="l">Rendimiento sobre inversión</div>' in html
    # Dos filas de seis ahora: comisiones/totales, y plazo/venta/ganancia/cap
    # rate/rendimiento — ninguna es ya la vieja fila de cinco.
    assert html.count('class="metrics metrics-6"') == 2
    assert 'class="metrics metrics-5"' not in html


def test_opportunity_card_yield_on_cost_is_a_dash_without_one():
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000, "yieldOnCost": None}
    html = _opportunity(p)
    assert '<div class="v">—</div><div class="l">Rendimiento sobre inversión</div>' in html


# ---------------------------------------------------------------------------
# _opportunity_fees_metrics — la fila nueva: terreno, obra, y los dos finales
# ---------------------------------------------------------------------------

def test_fee_scenario_missing_names_the_reason():
    assert _fee_scenario_missing(["salePrice"]) == '— <small>falta precio de venta</small>'
    assert _fee_scenario_missing(["rentMonthly"]) == '— <small>falta renta mensual</small>'


def test_fee_scenario_missing_never_a_bare_dash_when_a_reason_exists():
    """Un guion solo se leería como cero comisión — siempre trae el porqué al
    lado cuando hay uno."""
    assert _fee_scenario_missing(["salePrice"]) != "—"


def test_fee_scenario_missing_falls_back_to_a_bare_dash_without_a_reason():
    assert _fee_scenario_missing(None) == "—"
    assert _fee_scenario_missing([]) == "—"


def test_opportunity_fees_metrics_shows_terreno_and_obra_as_their_own_cells():
    p = {**BASE_PROPERTY,
         "totalInvestmentWithFeesVenta": 3_970_000, "totalInvestmentWithFeesRenta": 3_900_000}
    html = _opportunity_fees_metrics(p)
    assert '$150K <small>5.0%</small>' in html
    assert "Comisión compra terreno" in html
    assert '$420K <small>15.0%</small>' in html
    assert "Comisión de obra" in html


def test_opportunity_fees_metrics_shows_the_exit_fee_venta_and_renta_as_their_own_cells():
    """La comisión de salida no venía desglosada en ningún lado — a diferencia
    de terreno y obra, que sí muestran su propio $ — así que cada escenario
    necesita su propia celda con el monto que se cobra. Sin `saleFeeTiers`/
    `rentFeeTiers` configurados, la sub-línea nombra el default del modelo
    (`_fee_tier_lines`, sin tramos) — no `exitSaleCommissionPct`/
    `exitRentMonths`, campos huérfanos desde que la escalera reemplazó al
    mecanismo plano que describían."""
    p = {**BASE_PROPERTY,
         "exitFeeVenta": 195_000, "exitSaleCommissionPct": 0.05,
         "exitFeeRenta": 144_000, "exitRentMonths": 3}
    html = _opportunity_fees_metrics(p)
    assert '$195K <small class="tiers">sin tramos · 5.0% por omisión</small>' in html
    assert "Comisión de salida · venta" in html
    assert '$144K <small class="tiers">sin tramos · 5.0% por omisión</small>' in html
    assert "Comisión de salida · renta" in html


def test_opportunity_fees_metrics_shows_the_configured_fee_tier_ladder():
    """Con `saleFeeTiers`/`rentFeeTiers` configurados, la sub-línea describe
    la escalera guardada — techo primero, piso al final — en vez del
    fallback de default."""
    p = {**BASE_PROPERTY,
         "exitFeeVenta": 195_000,
         "saleFeeTiers": [{"threshold": 6_500_000, "rate": 0.07},
                           {"threshold": None, "rate": 0.05},
                           {"threshold": 5_500_000, "rate": 0.06}],
         "exitFeeRenta": 144_000,
         "rentFeeTiers": [{"threshold": 15_000, "rate": 0.06},
                           {"threshold": None, "rate": 0.03}]}
    html = _opportunity_fees_metrics(p)
    assert '$195K <small class="tiers">≥$6.5M→7.0% · ≥$5.5M→6.0% · si no→5.0%</small>' in html
    assert '$144K <small class="tiers">≥$15K→6.0% · si no→3.0%</small>' in html


def test_opportunity_fees_metrics_names_the_reason_when_an_exit_fee_is_missing():
    p = {**BASE_PROPERTY,
         "exitFeeVenta": None, "feesMissingInputsVenta": ["salePrice"],
         "exitFeeRenta": 144_000, "exitRentMonths": 3}
    html = _opportunity_fees_metrics(p)
    assert '— <small>falta precio de venta</small>' in html
    assert '$144K <small class="tiers">sin tramos · 5.0% por omisión</small>' in html


def test_opportunity_fees_metrics_shows_the_two_totals_as_separate_cells():
    """El pedido del usuario: los totales quedan tal cual estaban, cada uno en
    su propia celda — no se funden en una sola."""
    p = {**BASE_PROPERTY,
         "totalInvestmentWithFeesVenta": 3_970_000, "totalInvestmentWithFeesRenta": 3_900_000}
    html = _opportunity_fees_metrics(p)
    assert '<div class="v">$4.0M</div><div class="l">Inversión c/comisiones · venta</div>' in html
    assert '<div class="v">$3.9M</div><div class="l">Inversión c/comisiones · renta</div>' in html
    assert "metric-wide" not in html


def test_opportunity_fees_metrics_names_the_reason_when_a_total_is_missing():
    p = {**BASE_PROPERTY,
         "totalInvestmentWithFeesVenta": None, "feesMissingInputsVenta": ["salePrice"],
         "totalInvestmentWithFeesRenta": 3_900_000, "feesMissingInputsRenta": []}
    html = _opportunity_fees_metrics(p)
    assert '— <small>falta precio de venta</small>' in html
    assert '<div class="v">$3.9M</div><div class="l">Inversión c/comisiones · renta</div>' in html


def test_opportunity_card_wires_the_fee_metrics_row_after_opp_cols_and_before_the_top_metrics():
    """Pedido explícito: la fila de plazo/inversión/venta/ganancia/cap rate
    (`.metrics-5`) va DESPUÉS de la de comisiones (`.metrics-6`), no antes —
    el desglose de comisiones se lee primero, la proyección resumida cierra
    la página."""
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000,
         "exitFeeVenta": 195_000, "exitSaleCommissionPct": 0.05,
         "exitFeeRenta": None, "feesMissingInputsRenta": ["rentMonthly"],
         "totalInvestmentWithFeesVenta": 3_970_000, "totalInvestmentWithFeesRenta": None}
    html = _opportunity(p)
    assert "Comisión compra terreno" in html
    assert "Comisión de obra" in html
    assert "Comisión de salida · venta" in html
    assert "Comisión de salida · renta" in html
    assert "Inversión c/comisiones · venta" in html
    assert "Inversión c/comisiones · renta" in html
    assert html.index('class="opp-cols"') < html.index("Comisión compra terreno")
    assert html.index("Comisión compra terreno") < html.index("Plazo proyectado")


# ---------------------------------------------------------------------------
# _summary_card — ya no muestra ninguna cifra con comisiones
# ---------------------------------------------------------------------------

def test_summary_card_never_shows_a_fee_sub_line_even_when_every_property_has_the_data():
    """Sumar "si todo se hubiera vendido" + "si todo se hubiera rentado" en un
    track record mixto no es una cifra real que ningún inversionista pregunte
    — y mezclaría dinero realizado con dinero hipotético en un solo número."""
    sold = [{**BASE_PROPERTY, "totalInvestment": 1_000_000,
             "totalInvestmentWithFeesVenta": 1_150_000, "totalInvestmentWithFeesRenta": 1_180_000,
             "salePrice": 2_000_000}]
    rented = [{**BASE_PROPERTY, "totalInvestment": 500_000,
               "totalInvestmentWithFeesVenta": 550_000, "totalInvestmentWithFeesRenta": 560_000,
               "currentValuation": 700_000}]
    html = _summary_card(sold, rented)
    assert "c/comisiones" not in html
    assert "V $" not in html and "R $" not in html
    match = re.search(
        r'<div class="metric"><div class="v">((?:(?!</div>).)*?)</div><div class="l">Capital invertido</div>',
        html)
    assert match is not None
    assert match.group(1) == "$1.5M"


def test_summary_card_still_omits_the_fee_sub_line_when_data_is_missing_too():
    sold = [{**BASE_PROPERTY, "totalInvestment": 1_000_000,
             "totalInvestmentWithFeesVenta": None, "totalInvestmentWithFeesRenta": None,
             "salePrice": 2_000_000}]
    html = _summary_card(sold, [])
    assert "c/comisiones" not in html


def test_budget_full_empty_lines_returns_empty_string():
    assert _budget_full([], []) == ""


def test_budget_full_lists_every_line_with_chapter_subtotals_and_grand_total():
    """Pedido explícito: la granularidad completa, no solo el agregado por
    capítulo — cada partida tiene que aparecer, con su propio monto, y un
    capítulo de dos o más renglones lleva su subtotal."""
    lines = [
        {"chapterName": "Albañilería", "name": "Cimentación", "budgetedAmount": 100_000,
         "quantity": 1, "unit": "lote"},
        {"chapterName": "Otros", "name": "Otros, por detallar", "budgetedAmount": 50_000,
         "quantity": 1, "unit": "lote"},
        {"chapterName": "Albañilería", "name": "Muros", "budgetedAmount": 25_000,
         "quantity": 1, "unit": "lote"},
    ]
    html = _budget_full(lines, ["Albañilería", "Otros"])
    assert "Cimentación" in html
    assert "Muros" in html
    assert "$100,000" in html
    assert "$25,000" in html
    assert '<div class="budget-chapter-name">Albañilería</div>' in html
    assert '<tr class="budget-subtotal"><td>Subtotal</td><td class="n">$125,000</td></tr>' in html
    assert "$175,000" in html  # el total general
    assert html.index("Albañilería") < html.index("Otros")  # en el orden de `chapters`


def test_budget_full_skips_the_subtotal_for_a_single_line_chapter():
    """Repetir el mismo número dos veces (la partida y un "Subtotal" idéntico
    debajo) no añade información — solo hay algo que sumar con dos renglones
    o más."""
    lines = [{"chapterName": "Otros", "name": "Otros, por detallar", "budgetedAmount": 156_000,
              "quantity": 1, "unit": "lote"}]
    html = _budget_full(lines, ["Otros"])
    assert "$156,000" in html
    assert "budget-subtotal" not in html


def test_budget_full_stays_single_column_below_the_threshold():
    """Feedback en vivo: un presupuesto real de docenas de renglones ocupaba
    hasta tres páginas — pero la mayoría de las propiedades solo tienen "Otros,
    por detallar", una sola línea. Forzar dos columnas ahí dejaría la segunda
    visiblemente vacía, así que el umbral solo aplica arriba de
    _BUDGET_TWO_COLUMN_THRESHOLD."""
    lines = [{"chapterName": "Otros", "name": "Otros, por detallar", "budgetedAmount": 156_000,
              "quantity": 1, "unit": "lote"}]
    html = _budget_full(lines, ["Otros"])
    assert "budget-columns" not in html


def test_budget_full_switches_to_two_columns_above_the_threshold():
    """Un presupuesto de verdad, con capítulos de sobra, sí gana las dos
    columnas — Chromium reparte los capítulos entre columnas, esta prueba solo
    confirma que el contenedor aparece y sigue llevando cada capítulo, no
    cómo se balancean visualmente (eso es CSS, no Python)."""
    lines = [
        {"chapterName": f"Capítulo {i}", "name": f"Partida {i}", "budgetedAmount": 1_000,
         "quantity": 1, "unit": "lote"}
        for i in range(_BUDGET_TWO_COLUMN_THRESHOLD + 1)
    ]
    chapters = [f"Capítulo {i}" for i in range(_BUDGET_TWO_COLUMN_THRESHOLD + 1)]
    html = _budget_full(lines, chapters)
    assert '<div class="budget-columns">' in html
    for i in range(_BUDGET_TWO_COLUMN_THRESHOLD + 1):
        assert f"Partida {i}" in html
    # El total sigue fuera del contenedor de columnas, a lo ancho completo.
    assert html.rindex("budget-columns") < html.index("budget-grand-total")


def test_budget_full_total_is_never_inside_the_two_column_container():
    """El Total es la respuesta, no un renglón más — se agrega FUERA de
    .budget-columns aunque el presupuesto sea largo, para no leerse metido a
    media columna. `_budget_full` arma el resultado como `body + total`, así
    que si el total de verdad quedó afuera, la tabla del Total es un SUFIJO
    literal del html completo — no hace falta parsear la anidación de <div>
    para probarlo."""
    n = _BUDGET_TWO_COLUMN_THRESHOLD + 1
    lines = [
        {"chapterName": f"Capítulo {i}", "name": f"Partida {i}", "budgetedAmount": 1_000,
         "quantity": 1, "unit": "lote"}
        for i in range(n)
    ]
    chapters = [f"Capítulo {i}" for i in range(n)]
    html = _budget_full(lines, chapters)
    expected_total_table = (
        f'<table class="kv budget-grand-total"><tr><td>Total</td>'
        f'<td class="n">{_fmt_mxn(n * 1_000)}</td></tr></table>'
    )
    assert html.endswith(expected_total_table)


def test_opportunity_detail_is_empty_without_plano_or_budget():
    assert _opportunity_detail(BASE_PROPERTY) == ""


def test_opportunity_detail_shows_only_the_budget_section():
    p = {**BASE_PROPERTY, "budget": {
        "lines": [{"chapterName": "Otros", "budgetedAmount": 156_000}],
        "chapters": ["Otros"],
    }}
    html = _opportunity_detail(p)
    assert "$156,000" in html
    assert "Total" in html
    assert "<svg" not in html


def test_the_budget_forces_its_own_page_after_plano_or_renders():
    """Pedido explícito: plano/renders y presupuesto quedan cada uno en su
    hoja. Un presupuesto real (datos de producción) resultó más largo de lo
    que la premisa anterior asumía ("un presupuesto típico es corto y cabe en
    lo que dejan los renders") y arrancaba a media hoja de planos para
    cortarse ahí — `.detail-section-budget` fuerza el salto quo lo evita."""
    p = {**BASE_PROPERTY, "planSheets": [_sheet("abc", "original", "<svg>PLANO</svg>")],
         "budget": {
             "lines": [{"chapterName": "Otros", "budgetedAmount": 156_000}],
             "chapters": ["Otros"],
         }}
    html = _opportunity_detail(p)
    assert "Presupuesto de obra" in html
    assert 'class="detail-section detail-section-budget"' in html
    assert ".detail-section-budget" in _BODY_CSS
    rule = re.search(r"\.detail-section-budget \{[^}]*\}", _BODY_CSS).group()
    assert "break-before: page" in rule


def test_the_budget_does_not_force_a_page_without_plano_or_renders_before_it():
    """Sin plano ni renders no hay nada de qué separar el presupuesto — forzar
    el salto ahí sería una hoja en blanco sin razón."""
    p = {**BASE_PROPERTY, "budget": {
        "lines": [{"chapterName": "Otros", "budgetedAmount": 156_000}],
        "chapters": ["Otros"],
    }}
    html = _opportunity_detail(p)
    assert "Presupuesto de obra" in html
    assert "detail-section-budget" not in html


def test_opportunity_detail_flows_right_after_the_gallery_not_a_new_page():
    """Plano, renders y presupuesto solían vivir en su PROPIA page-block —
    page-break-after:always forzaba un salto de hoja sin importar cuánta
    quedara libre, dejando su cola sola arriba de una página casi en blanco.
    Ahora comparten la page-block de _opportunity: Chromium solo brinca de
    página cuando de veras se le acaba el espacio."""
    # El detalle ahora se dispara con presupuesto (o renders), no con el plano
    # técnico, que ya no se dibuja.
    p = {**BASE_PROPERTY, "budget": {
        "lines": [{"chapterName": "Otros", "budgetedAmount": 156_000}],
        "chapters": ["Otros"],
    }}
    html = _opportunity(p)
    assert html.count("page-block") == 1
    assert html.index('class="opp-cols"') < html.index('class="opp-detail"')


def test_the_opportunity_card_does_not_hard_clip_overflow():
    """`.opp` con `height: 297mm` combinado con el overflow:hidden que hereda de
    .page-block recortaba invisible cualquier cola que no cupiera en una hoja.
    `min-height: 297mm` pareció el arreglo, pero un flex container que se
    fragmenta entre páginas volvía a estirar CADA fragmento a 297mm — una nota
    larga varada sola en una hoja casi en blanco. Sin flex, sin height ni
    min-height, `.opp-body` mide lo que su contenido pide en cada fragmento."""
    rule = re.search(r"\.opp-body \{[^}]*\}", _BODY_CSS).group()
    assert "height" not in rule
    assert "flex" not in rule


# ---------------------------------------------------------------------------
# _plan_rows — hojas dibujadas + cabezas de render → filas por linaje de piso
# ---------------------------------------------------------------------------

def _sheet(fid, variant, svg="<svg/>", name="Planta Baja"):
    return {"floorId": fid, "variant": variant, "floorName": name, "svg": svg}


def _render(fid=None, variant=None, uri="data:x", name=None, chosen=False, image_id=None):
    return {"floorId": fid, "sourceVariant": variant, "floorName": name,
            "dataUri": uri, "isChosen": chosen, "sourceImageId": image_id}


def test_el_elegido_se_empareja_su_lado():
    rows = _plan_rows(
        [_sheet("abc", "original", "<svg>A</svg>"), _sheet("abc", "planned", "<svg>B</svg>")],
        [_render("abc", "original", chosen=True), _render("abc", "planned", chosen=True)], "planned")
    assert len(rows[0]["antes"]["renders"]) == 1
    assert len(rows[0]["despues"]["renders"]) == 1


def test_sin_estrella_el_lado_no_tiene_renders_pero_el_plano_sigue():
    """El plano es el ancla dimensional (PR #45) — se imprime CON o SIN render
    elegido. Solo el hueco de render queda vacío."""
    rows = _plan_rows([_sheet("abc", "original")], [_render("abc", "original", chosen=False)], "planned")
    assert rows[0]["antes"] is not None
    assert rows[0]["antes"]["renders"] == []


def test_variante_distinta_no_empata_aunque_el_piso_coincida():
    """Un piso planeado nacido de PARTIR comparte el id del original
    (LevantamientoPanel.tsx:231): elegir por floorId solo pondría el elegido del
    original junto al plano del planeado."""
    rows = _plan_rows([_sheet("abc", "planned")], [_render("abc", "original", chosen=True)], "planned")
    assert rows[0]["despues"]["renders"] == []


def test_floor_id_nulo_no_empata_con_nada():
    rows = _plan_rows([_sheet("abc", "original")], [_render(None, None, chosen=True)], "planned")
    assert rows[0]["antes"]["renders"] == []


def test_un_render_sin_dataUri_nunca_cuenta_aunque_este_elegido():
    rows = _plan_rows([_sheet("abc", "original")], [_render("abc", "original", uri=None, chosen=True)], "planned")
    assert rows[0]["antes"]["renders"] == []


def test_un_clon_sin_editar_colapsa_a_una_sola_hoja():
    """Mismo svg = mismo dibujo. Imprimirlo bajo Antes/Después afirmaría una
    transformación que nadie diseñó."""
    rows = _plan_rows(
        [_sheet("abc", "original", "<svg>A</svg>"), _sheet("abc", "planned", "<svg>A</svg>")],
        [_render("abc", "original", chosen=True)], "planned")
    assert rows[0]["despues"] is None
    assert len(rows[0]["antes"]["renders"]) == 1


def test_el_nombre_sale_de_la_hoja_no_del_render():
    rows = _plan_rows([_sheet("abc", "original", name="Planta Alta")],
                      [_render("abc", "original", name="Nombre Viejo", chosen=True)], "planned")
    assert rows[0]["floorName"] == "Planta Alta"


def test_orden_original_primero_luego_los_pisos_solo_planeados():
    rows = _plan_rows([_sheet("a", "original"), _sheet("b", "original"), _sheet("z", "planned")], [], "planned")
    assert len(rows) == 3
    assert [r["antes"] is not None for r in rows] == [True, True, False]


def test_sin_hojas_no_hay_filas():
    assert _plan_rows([], [_render("abc", "original", chosen=True)], "planned") == []


# ─── _photo_rows — foto fuente + su render elegido ─────────────────────────

def _photo(image_id, data_uri="data:foto"):
    return {"id": image_id, "dataUri": data_uri}


def test_una_foto_con_estrella_imprime_su_fila():
    rows = _photo_rows([_photo(7)], [_render(image_id=7, chosen=True)])
    assert len(rows) == 1
    assert len(rows[0]["renders"]) == 1


def test_una_foto_sin_estrella_no_imprime_fila():
    rows = _photo_rows([_photo(7)], [_render(image_id=7, chosen=False)])
    assert rows == []


def test_estrella_de_otra_foto_no_empata():
    rows = _photo_rows([_photo(7)], [_render(image_id=9, chosen=True)])
    assert rows == []


def test_sin_fotos_no_hay_filas():
    assert _photo_rows([], [_render(image_id=7, chosen=True)]) == []


def test_la_pareja_de_una_foto_lleva_la_clase_que_apaga_el_padding_del_titulo():
    """El plano trae su título DENTRO del propio SVG — `.plan-renders` le suma
    9mm de padding-top para que su render alinee con eso (ver el CSS). Una foto
    no trae ese título: sin la clase `plan-pair--photo` que apaga ese padding
    para este caso, el render de la foto arrancaría más abajo que la foto misma."""
    rows = _photo_rows([_photo(7)], [_render(image_id=7, chosen=True)])
    html = _photo_block(rows)
    assert "plan-pair--photo" in html


def test_la_pareja_de_un_plano_no_lleva_esa_clase():
    p = {"planSheets": [_sheet("abc", "original", "<svg>PLANO</svg>")],
         "renderHeads": [_render("abc", "original", chosen=True)]}
    html = _plan_block(_plan_rows(p["planSheets"], p["renderHeads"], "planned"))
    assert "plan-pair--photo" not in html


# ---------------------------------------------------------------------------
# _opportunity_detail — el plano impreso junto al render que ancla
# ---------------------------------------------------------------------------

def test_el_detalle_imprime_el_plano_junto_a_su_render_elegido():
    p = {"planSheets": [_sheet("abc", "original", "<svg>PLANO</svg>")],
         "renderHeads": [_render("abc", "original", uri="data:ELEGIDO", chosen=True)], "budget": {}}
    html = _opportunity_detail(p)
    assert "PLANO" in html and "plan-row" in html
    assert "data:ELEGIDO" in html


def test_una_sola_variante_no_lleva_etiquetas_antes_despues():
    p = {"planSheets": [_sheet("abc", "original")], "renderHeads": [], "budget": {}}
    html = _opportunity_detail(p)
    assert "Antes" not in html and "Después" not in html


def test_dos_variantes_distintas_llevan_antes_y_despues():
    p = {"planSheets": [_sheet("abc", "original", "<svg>A</svg>"),
                        _sheet("abc", "planned", "<svg>B</svg>")],
         "renderHeads": [], "budget": {}}
    html = _opportunity_detail(p)
    assert "Antes" in html and "Después" in html


def test_un_render_sin_hoja_ni_foto_no_imprime_nada():
    """Ya no hay tira suelta de respaldo: un render que no empata con una hoja
    ni con una foto —ninguna estrella, o un piso ya borrado— simplemente no
    tiene dónde salir."""
    p = {"planSheets": [], "images": [], "renderHeads": [_render(None, None, chosen=True)],
         "budget": {}}
    assert _opportunity_detail(p) == ""


def test_la_foto_elegida_se_imprime_en_su_propia_seccion():
    p = {"planSheets": [], "images": [{"id": 7, "dataUri": "data:FOTO"}],
         "renderHeads": [_render(uri="data:ELEGIDO", chosen=True, image_id=7)], "budget": {}}
    html = _opportunity_detail(p)
    assert "Fotos y propuesta" in html
    assert "data:FOTO" in html and "data:ELEGIDO" in html


def test_sin_plano_sin_render_y_sin_presupuesto_no_hay_detalle():
    assert _opportunity_detail({"planSheets": [], "renderHeads": [], "budget": {}}) == ""


# ---------------------------------------------------------------------------
# ProspectusSections — recortar la página de oportunidad
#
# Cada bloque se prueba apagado CONTRA UN VECINO QUE SIGUE AHÍ, no solo por su
# propia ausencia: "la sección ya no está" también es cierto si el recorte se
# llevó media página por delante, y esa es justamente la falla que estas
# pruebas existen para atrapar.
# ---------------------------------------------------------------------------

# Cada bloque, por la única cadena que solo él imprime. Las dos rejillas de
# seis comparten clase (`metrics-6`), así que se distinguen por su etiqueta:
# la de comisiones abre con el terreno, la de proyección con el plazo.
_FEES_ROW = "Comisión compra terreno"
_PROJECTION_ROW = "Plazo proyectado"
_GALLERY = '<div class="strip-label">Galería</div>'
_PLANS = "Plano y propuesta"
_PHOTO_RENDERS = "Fotos y propuesta"
_BUDGET = "Presupuesto de obra"


def _opportunity_with_everything() -> dict:
    """Una oportunidad que dispara los cinco bloques apagables a la vez.

    Es una función y no una constante para que cada prueba reciba un dict
    nuevo: `_opportunity()` no muta su entrada hoy, pero una constante
    compartida convierte esa promesa en una dependencia silenciosa entre
    pruebas el día que deje de cumplirse.

    Dos fotos, no una: la primera es el hero (que nunca se apaga) y solo a
    partir de la segunda existe la galería. La foto 7 además trae render
    elegido, que es lo que hace aparecer "Fotos y propuesta"."""
    return {
        **BASE_PROPERTY,
        "images": [{"id": 6, "dataUri": "data:FOTO-HERO"},
                   {"id": 7, "dataUri": "data:FOTO-GALERIA"}],
        "planSheets": [_sheet("abc", "original", "<svg>PLANO</svg>")],
        "renderHeads": [_render("abc", "original", uri="data:RENDER-PLANO", chosen=True),
                        _render(uri="data:RENDER-FOTO", chosen=True, image_id=7)],
        "budget": {"lines": [{"chapterName": "Otros", "budgetedAmount": 156_000}],
                   "chapters": ["Otros"]},
    }


def test_an_opportunity_card_with_no_opinion_prints_every_toggleable_block():
    """El punto de partida de todo lo de abajo. Sin esta prueba, un "ya no
    está" podría significar que ese bloque nunca estuvo y las demás pasarían
    en verde sin comprobar nada."""
    html = _opportunity(_opportunity_with_everything())
    for marker in (_FEES_ROW, _PROJECTION_ROW, _GALLERY, _PLANS, _PHOTO_RENDERS, _BUDGET):
        assert marker in html, marker


def test_turning_off_the_fees_row_leaves_the_projection_row_standing():
    """Las dos filas son `metrics-6` y son vecinas: apagar la de comisiones
    borrando "la rejilla de seis" se llevaría también la proyección, que es lo
    único que dice a qué se estaría entrando. El conteo de rejillas lo fija:
    queda exactamente una."""
    html = _opportunity(_opportunity_with_everything(),
                        ProspectusSections(opportunity_fees=False))
    assert _FEES_ROW not in html
    assert _PROJECTION_ROW in html
    assert html.count('class="metrics metrics-6"') == 1


def test_turning_off_the_gallery_leaves_the_hero_and_the_detail_blocks():
    """El hero no es galería: es la foto que dice de qué inmueble habla la
    página. Y la galería vive justo antes del detalle — borrar de más aquí se
    llevaría plano, renders y presupuesto de un tirón."""
    html = _opportunity(_opportunity_with_everything(),
                        ProspectusSections(opportunity_gallery=False))
    assert _GALLERY not in html
    assert 'class="hero"' in html
    assert _PLANS in html and _PHOTO_RENDERS in html and _BUDGET in html


def test_turning_off_the_plans_leaves_the_photo_renders_and_the_budget():
    """Plano y fotos comparten maquetación (`plan-row`, `_plan_side`) y los dos
    salen de `renderHeads`: apagar el plano por la clase, o vaciando
    `renderHeads`, se llevaría también el render de la foto."""
    html = _opportunity(_opportunity_with_everything(),
                        ProspectusSections(opportunity_plans=False))
    assert _PLANS not in html
    assert "<svg" not in html  # el dibujo, no solo su encabezado
    assert _PHOTO_RENDERS in html and "data:RENDER-FOTO" in html
    assert _BUDGET in html


def test_turning_off_the_photo_renders_leaves_the_plans_and_the_budget():
    """El espejo de la prueba anterior, por el mismo parentesco: la sección de
    fotos se va y el plano —con su render elegido— sigue impreso."""
    html = _opportunity(_opportunity_with_everything(),
                        ProspectusSections(opportunity_renders=False))
    assert _PHOTO_RENDERS not in html
    assert "data:RENDER-FOTO" not in html
    assert _PLANS in html and "PLANO" in html and "data:RENDER-PLANO" in html
    assert _BUDGET in html


def test_turning_off_the_budget_leaves_the_plans_and_the_photo_renders():
    html = _opportunity(_opportunity_with_everything(),
                        ProspectusSections(opportunity_budget=False))
    assert _BUDGET not in html
    assert "$156,000" not in html
    assert _PLANS in html and _PHOTO_RENDERS in html


def test_the_budget_does_not_force_its_own_page_when_plans_and_renders_are_turned_off():
    """Mismo criterio que cuando el dato no existe (ver
    test_the_budget_does_not_force_a_page_without_plano_or_renders_before_it),
    ahora por elección: si el salto siguiera atado a que la propiedad TIENE
    plano, un deck pedido sin planos ni renders abriría cada presupuesto con
    una hoja en blanco — no hay nada antes de qué separarlo."""
    html = _opportunity_detail(_opportunity_with_everything(),
                               ProspectusSections(opportunity_plans=False,
                                                  opportunity_renders=False))
    assert _BUDGET in html
    assert "detail-section-budget" not in html


def test_the_budget_still_forces_its_own_page_when_only_the_renders_are_turned_off():
    """El plano solo ya es algo de qué separarlo: el salto no depende de que
    estén los dos bloques, sino de que quede alguno."""
    html = _opportunity_detail(_opportunity_with_everything(),
                               ProspectusSections(opportunity_renders=False))
    assert 'class="detail-section detail-section-budget"' in html


def test_a_stripped_opportunity_still_says_which_property_it_is_and_what_it_projects():
    """Lo que ningún recorte puede quitar: la banda con el nombre, el hero, las
    dos columnas y la fila de proyección. Sin ellas la hoja deja de identificar
    la propiedad o de decir a qué se entraría — no sería un prospecto más
    corto, sería una página que no dice nada."""
    html = _opportunity(_opportunity_with_everything(),
                        ProspectusSections(opportunity_fees=False, opportunity_gallery=False,
                                           opportunity_plans=False, opportunity_renders=False,
                                           opportunity_budget=False))
    assert "[TEST] Casa Prueba" in html
    assert 'class="hero"' in html
    assert 'class="opp-cols"' in html
    assert _PROJECTION_ROW in html
    # Sin ninguno de los tres bloques, el contenedor del detalle tampoco se
    # imprime vacío — mismo comportamiento que una propiedad sin esos datos.
    assert 'class="opp-detail"' not in html


# ─── Múltiples planes: una sección por plan seleccionado ─────────────────────

def _plan_sheet(fid, plan_id, plan_name, svg="<svg/>"):
    return {**_sheet(fid, plan_id, svg), "planName": plan_name}


def test_dos_planes_imprimen_dos_secciones_etiquetadas():
    p = {**BASE_PROPERTY,
         "planSheets": [
             _sheet("abc", "original", "<svg>O</svg>"),
             _plan_sheet("abc", "plan-a", "Plan A: 4 departamentos", "<svg>A</svg>"),
             _plan_sheet("abc", "plan-b", "Plan B: locales", "<svg>B</svg>"),
         ],
         "renderHeads": []}
    html = _opportunity_detail(p)
    assert "Plano y propuesta · Plan A: 4 departamentos" in html
    assert "Plano y propuesta · Plan B: locales" in html
    # Cada sección trae su propio par: el svg del original aparece en LAS DOS.
    assert html.count("<svg>O</svg>") == 2
    assert html.count("<svg>A</svg>") == 1
    assert html.count("<svg>B</svg>") == 1


def test_un_solo_plan_conserva_el_titulo_de_siempre_sin_sufijo():
    # El contrato de ProspectusSections extendido: una propiedad con su único
    # plan (el legado) produce el documento de siempre, byte por byte.
    p = {**BASE_PROPERTY,
         "planSheets": [
             _sheet("abc", "original", "<svg>O</svg>"),
             _plan_sheet("abc", "planned", "Plan de proyecto", "<svg>P</svg>"),
         ],
         "renderHeads": []}
    html = _opportunity_detail(p)
    assert ">Plano y propuesta<" in html
    assert "Plano y propuesta ·" not in html


def test_el_clon_identico_se_suprime_por_plan_no_globalmente():
    # Plan A es un clon sin editar (mismo svg que el original) — su lado
    # "después" se suprime; Plan B sí difiere y conserva el suyo.
    p = {**BASE_PROPERTY,
         "planSheets": [
             _sheet("abc", "original", "<svg>O</svg>"),
             _plan_sheet("abc", "plan-a", "Plan A", "<svg>O</svg>"),
             _plan_sheet("abc", "plan-b", "Plan B", "<svg>B</svg>"),
         ],
         "renderHeads": []}
    html = _opportunity_detail(p)
    assert "Después" in html            # el de Plan B
    assert html.count("<svg>B</svg>") == 1
    # La sección de Plan A existe (su original ancla) pero sin lado después:
    assert "Plano y propuesta · Plan A" in html


def test_cada_seccion_solo_parea_los_renders_de_su_plan():
    p = {**BASE_PROPERTY,
         "planSheets": [
             _sheet("abc", "original", "<svg>O</svg>"),
             _plan_sheet("abc", "plan-a", "Plan A", "<svg>A</svg>"),
             _plan_sheet("abc", "plan-b", "Plan B", "<svg>B</svg>"),
         ],
         "renderHeads": [
             {**_render("abc", "plan-a", uri="data:render-a", chosen=True)},
             {**_render("abc", "plan-b", uri="data:render-b", chosen=True)},
         ]}
    html = _opportunity_detail(p)
    a_pos = html.find("Plano y propuesta · Plan A")
    b_pos = html.find("Plano y propuesta · Plan B")
    # El render de cada plan cae dentro de SU sección, no en la del otro.
    assert a_pos < html.find("data:render-a") < b_pos
    assert html.find("data:render-b") > b_pos


def test_cada_seccion_de_plan_imprime_su_presupuesto_escenario_si_existe():
    p = {**BASE_PROPERTY,
         "planSheets": [
             _sheet("abc", "original", "<svg>O</svg>"),
             _plan_sheet("abc", "plan-a", "Plan A", "<svg>A</svg>"),
             _plan_sheet("abc", "plan-b", "Plan B", "<svg>B</svg>"),
         ],
         "renderHeads": [],
         "planBudgets": {
             "plan-a": {"lines": [
                 {"chapterName": "Obra", "name": "Albañilería", "unit": "lote",
                  "quantity": 1, "unitPrice": 100_000, "isResidual": False,
                  "committedAmount": None, "closedAt": None, "payments": [],
                  "supplierId": None, "actualQuantity": None, "isProportional": True}],
              "chapters": ["Obra"]},
             # plan-b sin escenario: su sección no imprime presupuesto.
         }}
    html = _opportunity_detail(p)
    assert "Presupuesto · Plan A" in html
    assert "Albañilería" in html
    assert "Presupuesto · Plan B" not in html
    # Y aparece DENTRO del flujo de su plan: después del título de Plan A y
    # antes del de Plan B.
    assert html.find("Plano y propuesta · Plan A") < html.find("Presupuesto · Plan A") < html.find("Plano y propuesta · Plan B")


def test_sin_escenarios_el_documento_no_cambia_ni_un_byte():
    base = {**BASE_PROPERTY,
            "planSheets": [
                _sheet("abc", "original", "<svg>O</svg>"),
                _plan_sheet("abc", "planned", "Plan de proyecto", "<svg>P</svg>"),
            ],
            "renderHeads": []}
    sin_clave = _opportunity_detail(base)
    con_vacio = _opportunity_detail({**base, "planBudgets": {}})
    assert sin_clave == con_vacio
    assert "Presupuesto ·" not in sin_clave
