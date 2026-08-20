"""Unit tests for the pure HTML/SVG builders in prospectus_html.py — no DB,
no client, straight function calls. Integration behavior (does the right data
reach the right property) lives in test_documents.py."""
import re

from api.lib.prospectus_html import (_budget_full, _development_card, _fee_scenario_missing,
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


def test_opportunity_card_main_investment_metric_has_no_sub_line():
    """El detalle de comisiones se mudó a su propia fila
    (`_opportunity_fees_metrics`) — mostrarlo también aquí repetiría las
    mismas cifras dos veces en la misma página."""
    p = {**BASE_PROPERTY, "totalInvestment": 1_000_000,
         "totalInvestmentWithFeesVenta": 1_150_000, "totalInvestmentWithFeesRenta": 1_200_000}
    html = _opportunity(p)
    match = re.search(
        r'<div class="metric"><div class="v">((?:(?!</div>).)*?)</div><div class="l">Inversión sin comisiones</div>',
        html)
    assert match is not None
    cell = match.group(1)
    assert cell == "$1.0M"
    assert "<small>" not in cell
    assert "V $" not in cell and "R $" not in cell


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
    necesita su propia celda con el monto que se cobra."""
    p = {**BASE_PROPERTY,
         "exitFeeVenta": 195_000, "exitSaleCommissionPct": 0.05,
         "exitFeeRenta": 144_000, "exitRentMonths": 3}
    html = _opportunity_fees_metrics(p)
    assert '$195K <small>5.0%</small>' in html
    assert "Comisión de salida · venta" in html
    assert '$144K <small>3 meses</small>' in html
    assert "Comisión de salida · renta" in html


def test_opportunity_fees_metrics_names_the_reason_when_an_exit_fee_is_missing():
    p = {**BASE_PROPERTY,
         "exitFeeVenta": None, "feesMissingInputsVenta": ["salePrice"],
         "exitFeeRenta": 144_000, "exitRentMonths": 3}
    html = _opportunity_fees_metrics(p)
    assert '— <small>falta precio de venta</small>' in html
    assert '$144K <small>3 meses</small>' in html


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


def test_opportunity_card_wires_the_fee_metrics_row_after_opp_cols():
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


def test_the_budget_flows_with_the_renders_not_its_own_page():
    """Pedido de Louis: sin el plano técnico y con los renders arriba, la hoja de
    detalle queda ~70% libre y un presupuesto de obra típico (corto) cabe ahí.
    Ya NO se fuerza a su propia página — fluye como cualquier otra sección; si
    uno muy largo no cupiera, Chromium brinca solo (sin partir renglones)."""
    p = {**BASE_PROPERTY, "budget": {
        "lines": [{"chapterName": "Otros", "budgetedAmount": 156_000}],
        "chapters": ["Otros"],
    }}
    html = _opportunity_detail(p)
    assert "Presupuesto de obra" in html
    assert "detail-section-budget" not in html     # sin salto de página forzado
    assert ".detail-section-budget" not in _BODY_CSS  # la regla que lo forzaba se retiró


def test_opportunity_detail_flows_right_after_the_note_not_a_new_page():
    """Plano, renders y presupuesto solían vivir en su PROPIA page-block —
    page-break-after:always forzaba un salto de hoja sin importar cuánta
    quedara libre bajo la nota, dejando su cola sola arriba de una página
    casi en blanco. Ahora comparten la page-block de _opportunity, después de
    la nota: Chromium solo brinca de página cuando de veras se le acaba el
    espacio."""
    # El detalle ahora se dispara con presupuesto (o renders), no con el plano
    # técnico, que ya no se dibuja.
    p = {**BASE_PROPERTY, "budget": {
        "lines": [{"chapterName": "Otros", "budgetedAmount": 156_000}],
        "chapters": ["Otros"],
    }, "notes": "Nota de prueba."}
    html = _opportunity(p)
    assert html.count("page-block") == 1
    assert html.index('class="opp-note"') < html.index('class="opp-detail"')


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


def test_the_opportunity_note_is_prose_not_a_rigid_block():
    """Un párrafo de nota puede envolver y seguir en la página siguiente como
    cualquier texto de un libro — forzarlo entero a saltar de página (como sí
    debe hacer una fila de fotos o una tabla) era lo que lo dejaba varado
    solo en una hoja casi en blanco."""
    rule = re.search(r"\.opp-note \{[^}]*\}", _BODY_CSS).group()
    assert "break-inside" not in rule


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
        [_render("abc", "original", chosen=True), _render("abc", "planned", chosen=True)])
    assert len(rows[0]["antes"]["renders"]) == 1
    assert len(rows[0]["despues"]["renders"]) == 1


def test_sin_estrella_el_lado_no_tiene_renders_pero_el_plano_sigue():
    """El plano es el ancla dimensional (PR #45) — se imprime CON o SIN render
    elegido. Solo el hueco de render queda vacío."""
    rows = _plan_rows([_sheet("abc", "original")], [_render("abc", "original", chosen=False)])
    assert rows[0]["antes"] is not None
    assert rows[0]["antes"]["renders"] == []


def test_variante_distinta_no_empata_aunque_el_piso_coincida():
    """Un piso planeado nacido de PARTIR comparte el id del original
    (LevantamientoPanel.tsx:231): elegir por floorId solo pondría el elegido del
    original junto al plano del planeado."""
    rows = _plan_rows([_sheet("abc", "planned")], [_render("abc", "original", chosen=True)])
    assert rows[0]["despues"]["renders"] == []


def test_floor_id_nulo_no_empata_con_nada():
    rows = _plan_rows([_sheet("abc", "original")], [_render(None, None, chosen=True)])
    assert rows[0]["antes"]["renders"] == []


def test_un_render_sin_dataUri_nunca_cuenta_aunque_este_elegido():
    rows = _plan_rows([_sheet("abc", "original")], [_render("abc", "original", uri=None, chosen=True)])
    assert rows[0]["antes"]["renders"] == []


def test_un_clon_sin_editar_colapsa_a_una_sola_hoja():
    """Mismo svg = mismo dibujo. Imprimirlo bajo Antes/Después afirmaría una
    transformación que nadie diseñó."""
    rows = _plan_rows(
        [_sheet("abc", "original", "<svg>A</svg>"), _sheet("abc", "planned", "<svg>A</svg>")],
        [_render("abc", "original", chosen=True)])
    assert rows[0]["despues"] is None
    assert len(rows[0]["antes"]["renders"]) == 1


def test_el_nombre_sale_de_la_hoja_no_del_render():
    rows = _plan_rows([_sheet("abc", "original", name="Planta Alta")],
                      [_render("abc", "original", name="Nombre Viejo", chosen=True)])
    assert rows[0]["floorName"] == "Planta Alta"


def test_orden_original_primero_luego_los_pisos_solo_planeados():
    rows = _plan_rows([_sheet("a", "original"), _sheet("b", "original"), _sheet("z", "planned")], [])
    assert len(rows) == 3
    assert [r["antes"] is not None for r in rows] == [True, True, False]


def test_sin_hojas_no_hay_filas():
    assert _plan_rows([], [_render("abc", "original", chosen=True)]) == []


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
    html = _plan_block(_plan_rows(p["planSheets"], p["renderHeads"]))
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
