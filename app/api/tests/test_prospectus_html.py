"""Unit tests for the pure HTML/SVG builders in prospectus_html.py — no DB,
no client, straight function calls. Integration behavior (does the right data
reach the right property) lives in test_documents.py."""
import re

import pytest

from api.lib.prospectus_html import _floorplan_svg, _budget_full, _opportunity, _opportunity_detail, _BODY_CSS, _SVG_SIZE

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

# Variantes v3 (envelope del frontend, types.ts): cada una es un FloorSet completo.
ORIGINAL_SET = {"slab_m": 0.15, "activeFloor": 0, "floors": ONE_FLOOR["floors"]}

PLANNED_SET = {
    "slab_m": 0.15,
    "activeFloor": 0,
    "floors": [{
        "name": "Planta Planeada",
        "vertices": {
            "v1": {"id": "v1", "x": 0, "y": 0},
            "v2": {"id": "v2", "x": 8, "y": 0},
        },
        "edges": {"e1": {"id": "e1", "v1": "v1", "v2": "v2", "thickness": 0.15}},
        "rooms": [{"name": "Recámara Nueva", "cx": 4.0, "cy": 0.5}],
    }],
}

# Lo que persiste "EMPEZAR EN BLANCO": un planned con un piso sin un solo vértice. Nombrado
# distinto a ORIGINAL_SET ("Planta Baja") a propósito: si el nombre fuera el mismo, el
# assert de "no se esconde el original dibujado" pasaría aunque el blanco se colara.
BLANK_SET = {
    "slab_m": 0.15,
    "activeFloor": 0,
    "floors": [{"name": "Planta en Blanco", "vertices": {}, "edges": {}, "rooms": []}],
}

# Un piso amueblado (Task 12): un mueble con medidas reales (`kind`, `x`, `y`, `rot`,
# `w_m`, `h_m` — types.ts `Fixture`). `_floorplan_svg` lo dibuja como rect tenue.
FURNISHED_FLOOR = {
    "floors": [{
        **ONE_FLOOR["floors"][0],
        "fixtures": [
            {"id": "fx1", "kind": "cama_queen", "x": 2, "y": 1, "rot": 0, "w_m": 1.6, "h_m": 2.0},
        ],
    }],
}

# Una medida manual (addendum #5, `ManualDimension` en types.ts): línea suelta de dos
# puntos libres, no atada a un muro. `_floorplan_svg` la dibuja siempre — a diferencia
# del editor en vivo, aquí no hay toggle "showDims" que apagarla (ese estado es puro UI
# del reducer, nunca se persiste al modelo).
MEASURED_FLOOR = {
    "floors": [{
        **ONE_FLOOR["floors"][0],
        "manualDimensions": [
            {"id": "d1", "p1": {"x": 1, "y": 1}, "p2": {"x": 4, "y": 1}},
        ],
    }],
}

# Misma cota que MEASURED_FLOOR pero VERTICAL: el número debe rotar con la línea (ver
# test_manual_dimension_label_rotates_with_a_vertical_line) — con el número siempre
# horizontal quedaba cruzado por su propia línea, ilegible.
MEASURED_FLOOR_VERTICAL = {
    "floors": [{
        **ONE_FLOOR["floors"][0],
        "manualDimensions": [
            {"id": "d1", "p1": {"x": 1, "y": 1}, "p2": {"x": 1, "y": 4}},
        ],
    }],
}

# La MISMA cota vertical que MEASURED_FLOOR_VERTICAL, pero con p1/p2 al revés — el orden
# en que el editor los graba depende de en qué sentido arrastró el usuario, no de la
# geometría. El número debe quedar del mismo lado en ambas (ver
# test_manual_dimension_label_side_does_not_depend_on_draw_direction).
MEASURED_FLOOR_VERTICAL_REVERSED = {
    "floors": [{
        **ONE_FLOOR["floors"][0],
        "manualDimensions": [
            {"id": "d1", "p1": {"x": 1, "y": 4}, "p2": {"x": 1, "y": 1}},
        ],
    }],
}

# Un piso con una arista 'ghost' (división manual de cuarto): divide para nombres/áreas
# pero no es muro — _floorplan_svg no debe dibujarle línea alguna.
GHOST_EDGE_FLOOR = {
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
            "e3": {"id": "e3", "v1": "v1", "v2": "v3", "thickness": 0.05, "kind": "ghost"},
        },
        "rooms": [{"name": "Sala", "cx": 2.5, "cy": 2.0}],
    }],
}


def _v3(original, planned):
    return {"schemaVersion": 3, "variants": {"original": original, "planned": planned}}

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


def test_v3_with_only_original_renders_the_original():
    svg = _floorplan_svg(_v3(ORIGINAL_SET, None))
    assert "<svg" in svg
    assert "Sala" in svg
    assert "Planta Baja" in svg


def test_v3_with_a_drawn_planned_renders_the_planned_not_the_original():
    """El prospecto es el pitch al inversionista: muestra la propuesta."""
    svg = _floorplan_svg(_v3(ORIGINAL_SET, PLANNED_SET))
    assert "Recámara Nueva" in svg
    assert "Planta Planeada" in svg
    assert "Sala" not in svg


def test_v3_blank_planned_does_not_hide_a_drawn_original():
    """"EMPEZAR EN BLANCO" persiste un planned con un piso sin vértices: eso
    no es una propuesta todavía — el original dibujado sigue mandando."""
    svg = _floorplan_svg(_v3(ORIGINAL_SET, BLANK_SET))
    assert "Sala" in svg
    assert "Planta Baja" in svg
    assert "Planta en Blanco" not in svg

    # Mismo caso con un planned sin ni un piso (en vez del piso vacío que persiste el
    # botón "EMPEZAR EN BLANCO"): el original dibujado sigue ganando igual.
    assert "Sala" in _floorplan_svg(_v3(ORIGINAL_SET, {"floors": []}))


def test_v3_planned_wins_if_any_of_its_floors_has_vertices():
    """"Tiene geometría dibujada" es CUALQUIER piso con al menos un vértice,
    no "la lista de pisos no está vacía"."""
    planned = {**PLANNED_SET,
               "floors": BLANK_SET["floors"] + PLANNED_SET["floors"]}
    svg = _floorplan_svg(_v3(ORIGINAL_SET, planned))
    assert "Recámara Nueva" in svg
    assert "Sala" not in svg


def test_v3_with_garbage_variants_renders_nothing():
    assert _floorplan_svg({"schemaVersion": 3}) == ""
    assert _floorplan_svg({"schemaVersion": 3, "variants": {}}) == ""
    assert _floorplan_svg(_v3(None, None)) == ""
    assert _floorplan_svg(_v3({"floors": []}, None)) == ""


def test_a_wall_with_a_missing_vertex_is_skipped_not_fatal():
    svg = _floorplan_svg(DANGLING_EDGE)
    assert "<line" not in svg
    assert "<svg" in svg  # el piso se dibuja igual, solo sin ese muro


def test_ghost_edges_are_not_drawn_as_walls():
    """Una fantasma (división manual de cuarto, `kind: 'ghost'`) divide para nombres/áreas
    pero NO es muro: si se dibujara aquí, el modelo de render vería un muro que no existe."""
    svg = _floorplan_svg(GHOST_EDGE_FLOOR)
    assert svg.count("<line") == 2   # los 2 muros reales (e1, e2); e3 (ghost) no se dibuja
    assert "Sala" in svg             # el cuarto sigue nombrado


def test_furnished_floor_draws_a_muted_rect_for_the_fixture():
    """`class="plano-fixture"` (no un <rect> a secas: el fondo del SVG también es un rect)
    identifica el elemento; sin label — a diferencia de planImage.ts (que sí nombra cada
    mueble para el modelo de render), aquí el lector es un inversionista viendo un plano
    técnico en miniatura: importa la masa, no que diga "cama queen" en 7px."""
    svg = _floorplan_svg(FURNISHED_FLOOR)
    assert 'class="plano-fixture"' in svg
    m = re.search(r'class="plano-fixture" x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"', svg)
    assert m is not None
    x, y, w, h = (float(g) for g in m.groups())
    scale = _SVG_SIZE / 5  # ONE_FLOOR mide 5x4, el lado mayor (5) fija la escala compartida
    assert w == pytest.approx(1.6 * scale, abs=0.5)
    assert h == pytest.approx(2.0 * scale, abs=0.5)
    assert x == pytest.approx(-w / 2, abs=0.5)   # rect centrado, se traslada con transform
    assert y == pytest.approx(-h / 2, abs=0.5)
    assert "cama_queen" not in svg


def test_floor_without_fixtures_key_does_not_crash():
    """Backward compat: ningún blob anterior a Task 10 trae la clave `fixtures`."""
    svg = _floorplan_svg(ONE_FLOOR)
    assert 'class="plano-fixture"' not in svg
    assert "<svg" in svg


def test_floor_with_empty_fixtures_list_does_not_crash():
    floor = {**ONE_FLOOR["floors"][0], "fixtures": []}
    svg = _floorplan_svg({"floors": [floor]})
    assert 'class="plano-fixture"' not in svg
    assert "<svg" in svg


def test_floor_with_manual_dimension_draws_line_and_label():
    """`class="plano-dim"`/`class="plano-dim-label"` identifican la línea y su número —
    misma convención que `plano-fixture` arriba. Se dibuja SIEMPRE, sin depender de
    ningún toggle: el prospecto no tiene el botón "Dims" del editor, así que no hay
    nada que apagar aquí."""
    svg = _floorplan_svg(MEASURED_FLOOR)
    assert 'class="plano-dim"' in svg
    assert 'class="plano-dim-label"' in svg
    assert "3.00 m" in svg  # distancia real entre (1,1) y (4,1)


def test_manual_dimension_label_is_upright_on_a_horizontal_line():
    svg = _floorplan_svg(MEASURED_FLOOR)
    m = re.search(r'class="plano-dim-label"[^>]*transform="rotate\((-?[\d.]+)', svg)
    assert m is not None
    assert float(m.group(1)) == pytest.approx(0, abs=1)


def test_manual_dimension_label_rotates_with_a_vertical_line():
    """Antes el número era siempre horizontal — sobre una cota vertical quedaba escrito
    ENCIMA de su propia línea, ilegible. Ahora rota con ella (recortado a ±90° para
    nunca salir cabeza abajo, mismo criterio que FloorPlanCanvas.tsx)."""
    svg = _floorplan_svg(MEASURED_FLOOR_VERTICAL)
    m = re.search(r'class="plano-dim-label"[^>]*transform="rotate\((-?[\d.]+)', svg)
    assert m is not None
    assert abs(float(m.group(1))) == pytest.approx(90, abs=1)
    assert "3.00 m" in svg  # distancia real entre (1,1) y (1,4)


def _dim_label_tag(svg: str) -> str:
    m = re.search(r'<text [^>]*class="plano-dim-label"[^>]*>', svg)
    assert m is not None
    return m.group(0)


def test_manual_dimension_label_side_does_not_depend_on_draw_direction():
    """El mismo trazo visual (misma cota vertical) podía terminar con el número a la
    izquierda o a la derecha según en qué sentido arrastró el usuario — p1/p2 se graban
    en el orden del gesto, no de la geometría. Canonizada la dirección antes de rotar y
    desplazar, ambos órdenes producen el mismo ángulo y el mismo lado."""
    tag_fwd = _dim_label_tag(_floorplan_svg(MEASURED_FLOOR_VERTICAL))
    tag_rev = _dim_label_tag(_floorplan_svg(MEASURED_FLOOR_VERTICAL_REVERSED))
    x_fwd = float(re.search(r'x="(-?[\d.]+)"', tag_fwd).group(1))
    x_rev = float(re.search(r'x="(-?[\d.]+)"', tag_rev).group(1))
    angle_fwd = float(re.search(r'rotate\((-?[\d.]+)', tag_fwd).group(1))
    angle_rev = float(re.search(r'rotate\((-?[\d.]+)', tag_rev).group(1))
    assert x_fwd == pytest.approx(x_rev, abs=0.1)
    assert angle_fwd == pytest.approx(angle_rev, abs=0.1)


def test_floor_without_manual_dimensions_key_does_not_crash():
    """Backward compat: ningún blob previo al addendum #5 trae la clave `manualDimensions`."""
    svg = _floorplan_svg(ONE_FLOOR)
    assert 'class="plano-dim"' not in svg
    assert "<svg" in svg


def test_floor_with_empty_manual_dimensions_list_does_not_crash():
    floor = {**ONE_FLOOR["floors"][0], "manualDimensions": []}
    svg = _floorplan_svg({"floors": [floor]})
    assert 'class="plano-dim"' not in svg
    assert "<svg" in svg


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


def test_opportunity_detail_omits_the_technical_plano():
    """El plano TÉCNICO (SVG de muros) ya no se dibuja aunque la propiedad tenga
    geometría: pedido de Louis — al cliente no le interesan los planos técnicos;
    la distribución la comunica el render 2D amueblado, no este dibujo."""
    p = {**BASE_PROPERTY, "geometry": ONE_FLOOR, "budget": {
        "lines": [{"chapterName": "Otros", "budgetedAmount": 156_000}],
        "chapters": ["Otros"],
    }}
    html = _opportunity_detail(p)
    assert "<svg" not in html   # el plano técnico no se dibuja...
    assert "$156,000" in html   # ...aunque el presupuesto sí (la sección no está vacía)


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
