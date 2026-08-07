"""Unit tests for the pure HTML/SVG builders in prospectus_html.py — no DB,
no client, straight function calls. Integration behavior (does the right data
reach the right property) lives in test_documents.py."""
import re

from api.lib.prospectus_html import _floorplan_svg, _budget_full, _opportunity, _opportunity_detail, _BODY_CSS

ONE_FLOOR = {
    "floors": [{
        "name": "Planta Baja",
        "vertices": {
            "v1": {"id": "v1", "x": 0, "y": 0},
            "v2": {"id": "v2", "x": 5, "y": 0},
            "v3": {"id": "v3", "x": 5, "y": 4},
        },
        "edges": {
            "e1": {"id": "e1", "v1": "v1", "v2": "v2", "thickness": 0.15},
            "e2": {"id": "e2", "v1": "v2", "v2": "v3", "thickness": 0.15},
        },
        "rooms": [{"name": "Sala", "cx": 2.5, "cy": 2.0}],
    }],
}

TWO_FLOORS = {
    "floors": [
        ONE_FLOOR["floors"][0],
        {**ONE_FLOOR["floors"][0], "name": "Planta Alta"},
    ],
}

DANGLING_EDGE = {
    "floors": [{
        "name": "Planta Baja",
        "vertices": {"v1": {"id": "v1", "x": 0, "y": 0}},
        "edges": {"e1": {"id": "e1", "v1": "v1", "v2": "ghost", "thickness": 0.15}},
        "rooms": [],
    }],
}

BASE_PROPERTY = {"name": "[TEST] Casa Prueba"}


def test_empty_geometry_renders_nothing():
    assert _floorplan_svg({}) == ""
    assert _floorplan_svg(None) == ""
    assert _floorplan_svg({"floors": []}) == ""


def test_one_floor_draws_walls_and_room_name():
    svg = _floorplan_svg(ONE_FLOOR)
    assert "<svg" in svg
    assert svg.count("<line") == 2
    assert "Sala" in svg
    assert "Planta Baja" in svg


def test_two_floors_stack_both_with_their_names():
    svg = _floorplan_svg(TWO_FLOORS)
    assert "Planta Baja" in svg
    assert "Planta Alta" in svg
    assert svg.count("<svg") == 2


def test_a_wall_with_a_missing_vertex_is_skipped_not_fatal():
    svg = _floorplan_svg(DANGLING_EDGE)
    assert "<line" not in svg
    assert "<svg" in svg  # el piso se dibuja igual, solo sin ese muro


def test_the_plan_is_not_printed_upside_down():
    """La y del modelo apunta hacia arriba (viewTransform.ts la niega); la del
    SVG hacia abajo. El muro que en el editor SUBE tiene que subir en el papel."""
    svg = _floorplan_svg(ONE_FLOOR)
    walls = re.findall(r'<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"', svg)
    vertical = [w for w in walls if w[0] == w[2]]  # el muro de (5,0) a (5,4)
    assert len(vertical) == 1
    _, y1, _, y2 = vertical[0]
    assert float(y1) > float(y2)


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


def test_opportunity_detail_shows_only_the_plano_section():
    """Sin renders aquí: `_opportunity` ya enseña la cabeza de cada cadena
    (`renderHeads`) junto a las fotos — repetirlos aquí, sin deduplicar por
    cadena, mostraría el mismo diseño dos veces, una con peor curación."""
    p = {**BASE_PROPERTY, "geometry": ONE_FLOOR}
    html = _opportunity_detail(p)
    assert "plano" in html.lower()
    assert "<svg" in html
    assert "Presupuesto" not in html


def test_opportunity_detail_shows_only_the_budget_section():
    p = {**BASE_PROPERTY, "budget": {
        "lines": [{"chapterName": "Otros", "budgetedAmount": 156_000}],
        "chapters": ["Otros"],
    }}
    html = _opportunity_detail(p)
    assert "$156,000" in html
    assert "Total" in html
    assert "<svg" not in html


def test_the_budget_section_always_starts_on_its_own_page():
    """Pedido explícito: el presupuesto completo es demasiado largo para
    compartir hoja con el plano y los renders sin sentirse apretado — a
    diferencia de esos dos, arranca siempre en una hoja nueva."""
    p = {**BASE_PROPERTY, "geometry": ONE_FLOOR, "budget": {
        "lines": [{"chapterName": "Otros", "budgetedAmount": 156_000}],
        "chapters": ["Otros"],
    }}
    html = _opportunity_detail(p)
    assert 'class="detail-section detail-section-budget"' in html
    rule = re.search(r"\.detail-section-budget \{[^}]*\}", _BODY_CSS).group()
    assert "break-before: page" in rule


def test_opportunity_detail_flows_right_after_the_note_not_a_new_page():
    """Plano, renders y presupuesto solían vivir en su PROPIA page-block —
    page-break-after:always forzaba un salto de hoja sin importar cuánta
    quedara libre bajo la nota, dejando su cola sola arriba de una página
    casi en blanco. Ahora comparten la page-block de _opportunity, después de
    la nota: Chromium solo brinca de página cuando de veras se le acaba el
    espacio."""
    p = {**BASE_PROPERTY, "geometry": ONE_FLOOR, "notes": "Nota de prueba."}
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
