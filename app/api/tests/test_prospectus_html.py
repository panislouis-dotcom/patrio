"""Unit tests for the pure HTML/SVG builders in prospectus_html.py — no DB,
no client, straight function calls. Integration behavior (does the right data
reach the right property) lives in test_documents.py."""
import re

from api.lib.prospectus_html import _floorplan_svg, _chapter_totals, _opportunity_detail

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


def test_chapter_totals_empty_lines_returns_empty_list():
    assert _chapter_totals([], []) == []


def test_chapter_totals_sums_by_chapter_in_order_with_total():
    lines = [
        {"chapterName": "Albañilería", "budgetedAmount": 100_000},
        {"chapterName": "Otros", "budgetedAmount": 50_000},
        {"chapterName": "Albañilería", "budgetedAmount": 25_000},
    ]
    pairs = _chapter_totals(lines, ["Albañilería", "Otros"])
    assert pairs == [
        ("Albañilería", "$125,000"),
        ("Otros", "$50,000"),
        ("Total", "$175,000"),
    ]


def test_opportunity_detail_is_empty_without_plano_renders_or_budget():
    assert _opportunity_detail(BASE_PROPERTY) == ""


def test_opportunity_detail_shows_only_the_plano_section():
    p = {**BASE_PROPERTY, "geometry": ONE_FLOOR}
    html = _opportunity_detail(p)
    assert "plano" in html.lower()
    assert "<svg" in html
    assert "Renders" not in html
    assert "Presupuesto" not in html


def test_opportunity_detail_shows_only_the_renders_section():
    p = {**BASE_PROPERTY, "renders": [{"filePath": "x.png", "dataUri": "data:image/png;base64,AA=="}]}
    html = _opportunity_detail(p)
    assert "Renders" in html
    assert "<svg" not in html


def test_opportunity_detail_shows_only_the_budget_section():
    p = {**BASE_PROPERTY, "budget": {
        "lines": [{"chapterName": "Otros", "budgetedAmount": 156_000}],
        "chapters": ["Otros"],
    }}
    html = _opportunity_detail(p)
    assert "$156,000" in html
    assert "Total" in html
    assert "<svg" not in html
    assert "Renders" not in html


def test_opportunity_detail_page_breaks_after_itself():
    p = {**BASE_PROPERTY, "geometry": ONE_FLOOR}
    html = _opportunity_detail(p)
    assert 'class="page-block opp-detail"' in html
