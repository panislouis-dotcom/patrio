"""Unit tests for the pure HTML/SVG builders in prospectus_html.py — no DB,
no client, straight function calls. Integration behavior (does the right data
reach the right property) lives in test_documents.py."""
import re

from api.lib.prospectus_html import _budget_full, _opportunity, _opportunity_detail, _plan_rows, _BODY_CSS

BASE_PROPERTY = {"name": "[TEST] Casa Prueba"}


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


def _render(fid, variant, uri="data:x", name=None):
    return {"floorId": fid, "sourceVariant": variant, "floorName": name, "dataUri": uri}


def test_un_render_empata_por_piso_Y_variante():
    rows, left = _plan_rows(
        [_sheet("abc", "original", "<svg>A</svg>"), _sheet("abc", "planned", "<svg>B</svg>")],
        [_render("abc", "original"), _render("abc", "planned")])
    assert len(rows) == 1
    assert len(rows[0]["antes"]["renders"]) == 1
    assert len(rows[0]["despues"]["renders"]) == 1
    assert left == []


def test_variante_distinta_no_empata_aunque_el_piso_coincida():
    """Un piso planeado nacido de PARTIR comparte el id del original
    (LevantamientoPanel.tsx:231): parear solo por floorId pondría un render del
    original junto al plano del planeado."""
    rows, left = _plan_rows([_sheet("abc", "planned", "<svg>B</svg>")],
                            [_render("abc", "original")])
    assert rows[0]["despues"]["renders"] == []
    assert len(left) == 1


def test_floor_id_nulo_cae_a_la_tira_suelta():
    rows, left = _plan_rows([_sheet("abc", "original")], [_render(None, None)])
    assert rows[0]["antes"]["renders"] == []
    assert len(left) == 1


def test_render_de_un_piso_borrado_cae_a_la_tira_suelta():
    rows, left = _plan_rows([_sheet("abc", "original")], [_render("zzz", "original")])
    assert len(left) == 1


def test_un_render_sin_dataUri_no_entra_a_ningun_lado():
    rows, left = _plan_rows([_sheet("abc", "original")],
                            [_render("abc", "original", uri=None)])
    assert rows[0]["antes"]["renders"] == [] and left == []


def test_un_clon_sin_editar_colapsa_a_una_sola_hoja():
    """Mismo svg = mismo dibujo. Imprimirlo bajo Antes/Después afirmaría una
    transformación que nadie diseñó."""
    rows, left = _plan_rows(
        [_sheet("abc", "original", "<svg>A</svg>"), _sheet("abc", "planned", "<svg>A</svg>")],
        [_render("abc", "original"), _render("abc", "planned")])
    assert rows[0]["despues"] is None
    # los renders del planeado son del MISMO dibujo: se quedan en la fila, no sobran
    assert len(rows[0]["antes"]["renders"]) == 2
    assert left == []


def test_el_nombre_sale_de_la_hoja_no_del_render():
    rows, _ = _plan_rows([_sheet("abc", "original", name="Planta Alta")],
                         [_render("abc", "original", name="Nombre Viejo")])
    assert rows[0]["floorName"] == "Planta Alta"


def test_orden_original_primero_luego_los_pisos_solo_planeados():
    rows, _ = _plan_rows(
        [_sheet("a", "original"), _sheet("b", "original"), _sheet("z", "planned")], [])
    assert len(rows) == 3
    assert [r["antes"] is not None for r in rows] == [True, True, False]


def test_sin_hojas_todo_es_tira_suelta():
    rows, left = _plan_rows([], [_render("abc", "original")])
    assert rows == [] and len(left) == 1


# ---------------------------------------------------------------------------
# _opportunity_detail — el plano impreso junto al render que ancla
# ---------------------------------------------------------------------------

def test_el_detalle_imprime_el_plano_junto_a_su_render():
    p = {"planSheets": [_sheet("abc", "original", "<svg>PLANO</svg>")],
         "renderHeads": [_render("abc", "original")], "budget": {}}
    html = _opportunity_detail(p)
    assert "PLANO" in html and "plan-row" in html


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


def test_los_renders_sin_piso_conservan_la_tira_de_siempre():
    p = {"planSheets": [], "renderHeads": [_render(None, None)], "budget": {}}
    html = _opportunity_detail(p)
    assert 'class="strip"' in html


def test_sin_plano_sin_render_y_sin_presupuesto_no_hay_detalle():
    assert _opportunity_detail({"planSheets": [], "renderHeads": [], "budget": {}}) == ""
