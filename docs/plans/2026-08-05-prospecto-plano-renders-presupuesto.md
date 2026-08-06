# Prospecto: plano, renders y presupuesto en Oportunidades — plan de implementación

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cada oportunidad activa (`oferta`/`prospecto`) del prospecto de inversión gana una página compañera con su plano, sus renders generados con IA, y el desglose de su presupuesto de obra por capítulo.

**Architecture:** Todo vive en `app/api/lib/prospectus_html.py` (funciones puras de HTML/SVG) y `app/api/routes/documents.py` (enriquecimiento de datos antes de construir el HTML). Sin endpoint nuevo, sin cambio de contrato. El plano se dibuja en servidor desde `properties.geometry` (muros + nombres de cuarto, sin polígono relleno — ver `docs/plans/2026-08-05-prospecto-plano-renders-presupuesto-design.md`). Los renders y el presupuesto se leen con las funciones que ya existen (`renders_db.list_renders`, `budget_db.get_budget`).

**Tech Stack:** FastAPI, Playwright (HTML→PDF), pytest.

**Diseño previo:** `docs/plans/2026-08-05-prospecto-plano-renders-presupuesto-design.md` — leer primero, ahí están las decisiones y el porqué.

---

### Task 1: Extraer `_embed_image_list()` en `documents.py`

Hoy `_embed_images()` solo sabe enriquecer property dicts con una clave
`"images"`. Los renders necesitan el mismo mecanismo (storage → resize →
base64) sobre una lista plana, sin inventar un wrapper falso. Se extrae el
cuerpo del loop a una función reusable; `_embed_images` queda como un caso
particular de ella. Es un refactor de comportamiento cero — las pruebas que
ya cubren `_embed_images` (via `test_documents.py`) deben seguir pasando sin
cambios.

**Files:**
- Modify: `app/api/routes/documents.py:44-56`
- Test: `app/api/tests/test_documents.py` (nuevo test al final del archivo)

**Step 1: Write the failing test**

Añadir al final de `app/api/tests/test_documents.py`:

```python
def test_embed_image_list_sets_data_uri_from_storage(monkeypatch):
    from api.routes import documents

    monkeypatch.setattr(
        documents.storage, "stream",
        lambda path: (b"\x89PNG-fake-bytes", "image/png"))
    monkeypatch.setattr(
        documents, "_resize_for_pdf",
        lambda content, content_type: (content, content_type))

    images = [{"filePath": "renders/x.png"}]
    documents._embed_image_list(images)

    assert images[0]["dataUri"].startswith("data:image/png;base64,")


def test_embed_image_list_marks_failures_with_none_data_uri(monkeypatch):
    from api.routes import documents

    def _boom(path):
        raise FileNotFoundError(path)

    monkeypatch.setattr(documents.storage, "stream", _boom)
    images = [{"filePath": "renders/missing.png"}]
    documents._embed_image_list(images)
    assert images[0]["dataUri"] is None
```

**Step 2: Run test to verify it fails**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_documents.py -k embed_image_list -v`
Expected: FAIL with `AttributeError: module 'api.routes.documents' has no attribute '_embed_image_list'`

**Step 3: Write minimal implementation**

En `app/api/routes/documents.py`, reemplazar (líneas 44–56):

```python
def _embed_images(items: list[dict]) -> None:
    """Enrich each image dict with a base64 data URI for PDF embedding.

    Blocking (network fetch + Pillow resize): call it off the event loop."""
    for item in items:
        for img in item.get("images", []):
            try:
                content, content_type = storage.stream(img["filePath"])
                content, content_type = _resize_for_pdf(content, content_type)
                img["dataUri"] = f"data:{content_type};base64,{base64.b64encode(content).decode()}"
            except Exception:
                logger.warning("image embed failed: %s", img.get("filePath"), exc_info=True)
                img["dataUri"] = None
```

por:

```python
def _embed_image_list(images: list[dict]) -> None:
    """Enrich each image dict with a base64 data URI for PDF embedding.

    Blocking (network fetch + Pillow resize): call it off the event loop."""
    for img in images:
        try:
            content, content_type = storage.stream(img["filePath"])
            content, content_type = _resize_for_pdf(content, content_type)
            img["dataUri"] = f"data:{content_type};base64,{base64.b64encode(content).decode()}"
        except Exception:
            logger.warning("image embed failed: %s", img.get("filePath"), exc_info=True)
            img["dataUri"] = None


def _embed_images(items: list[dict]) -> None:
    """Enrich each item's `images` list in place. Blocking: call off the event loop."""
    for item in items:
        _embed_image_list(item.get("images", []))
```

**Step 4: Run test to verify it passes**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_documents.py -k "embed_image_list or prospectus" -v`
Expected: all PASS (the two new tests, plus every existing `*prospectus*` test unchanged).

**Step 5: Commit**

```bash
git add app/api/routes/documents.py app/api/tests/test_documents.py
git commit -m "refactor(prospecto): extraer _embed_image_list para reusarla en renders"
```

---

### Task 2: `_floorplan_svg()` en `prospectus_html.py`

**Files:**
- Create: `app/api/tests/test_prospectus_html.py`
- Modify: `app/api/lib/prospectus_html.py` (nueva función, cerca de `_team_block`, cualquier lugar en la sección "Section builders")

**Step 1: Write the failing test**

Crear `app/api/tests/test_prospectus_html.py`:

```python
"""Unit tests for the pure HTML/SVG builders in prospectus_html.py — no DB,
no client, straight function calls. Integration behavior (does the right data
reach the right property) lives in test_documents.py."""
from api.lib.prospectus_html import _floorplan_svg, _chapter_totals

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
```

**Step 2: Run test to verify it fails**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_prospectus_html.py -v`
Expected: FAIL — `ImportError: cannot import name '_floorplan_svg'`

**Step 3: Write minimal implementation**

En `app/api/lib/prospectus_html.py`, agregar dos constantes cerca de las
otras constantes de módulo (junto a `_MESES`, arriba del archivo):

```python
_SVG_SIZE = 260.0
_SVG_PAD = 14.0
```

Y agregar la función, en la sección "Section builders" (junto a
`_team_block`, por ejemplo justo antes de `def _team_block`):

```python
def _floorplan_svg(geometry: dict) -> str:
    """El plano de una oportunidad, dibujado con lo único que el modelo crudo
    del editor garantiza siempre: muros (con su grosor) y el nombre de cada
    cuarto en su punto de etiqueta. Sin polígono relleno — un cuarto puede
    nombrarse sin estar cerrado por muros, así que el modelo no trae su área
    ni su forma (ver docs/plans/2026-08-05-...-design.md). Sin pisos -> "",
    el bloque desaparece del mismo modo que _team_block."""
    floors = (geometry or {}).get("floors") or []
    blocks = []
    for floor in floors:
        vertices = floor.get("vertices") or {}
        if not vertices:
            continue
        xs = [v["x"] for v in vertices.values()]
        ys = [v["y"] for v in vertices.values()]
        width = max(max(xs) - min(xs), 0.01)
        height = max(max(ys) - min(ys), 0.01)
        scale = _SVG_SIZE / max(width, height)
        min_x, min_y = min(xs), min(ys)

        def sx(x):
            return (x - min_x) * scale + _SVG_PAD

        def sy(y):
            return (y - min_y) * scale + _SVG_PAD

        lines = []
        for edge in (floor.get("edges") or {}).values():
            v1 = vertices.get(edge.get("v1"))
            v2 = vertices.get(edge.get("v2"))
            if v1 is None or v2 is None:
                continue
            stroke = max(_num(edge.get("thickness")) * scale, 1)
            lines.append(
                f'<line x1="{sx(v1["x"]):.1f}" y1="{sy(v1["y"]):.1f}" '
                f'x2="{sx(v2["x"]):.1f}" y2="{sy(v2["y"]):.1f}" '
                f'stroke="#1A1A1A" stroke-width="{stroke:.1f}" stroke-linecap="square" />'
            )

        labels = []
        for room in floor.get("rooms") or []:
            cx, cy = room.get("cx"), room.get("cy")
            if cx is None or cy is None:
                continue
            labels.append(
                f'<text x="{sx(cx):.1f}" y="{sy(cy):.1f}" '
                f'class="plano-room" text-anchor="middle">{_esc(room.get("name", ""))}</text>'
            )

        view = _SVG_SIZE + _SVG_PAD * 2
        blocks.append(f"""<div class="plano-floor">
  <div class="plano-floor-name">{_esc(floor.get("name", ""))}</div>
  <svg viewBox="0 0 {view:.1f} {view:.1f}" class="plano-svg">{''.join(lines)}{''.join(labels)}</svg>
</div>""")
    if not blocks:
        return ""
    return f'<div class="plano">{"".join(blocks)}</div>'


def _chapter_totals(lines: list[dict], chapters: list[str]) -> list[tuple[str, str]]:
    """Subtotal presupuestado por capítulo, en el orden que `chapters` ya
    trae (residuo al final, ver budget_db._chapters), más un renglón de
    Total. Sin renglones -> lista vacía, para que el llamador decida que no
    hay presupuesto que enseñar."""
    if not lines:
        return []
    by_chapter: dict[str, float] = {}
    for line in lines:
        name = line.get("chapterName") or ""
        by_chapter[name] = by_chapter.get(name, 0.0) + _num(line.get("budgetedAmount"))
    pairs = [(name, _fmt_mxn(by_chapter[name])) for name in chapters if name in by_chapter]
    pairs.append(("Total", _fmt_mxn(sum(by_chapter.values()))))
    return pairs
```

**Step 4: Run test to verify it passes**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_prospectus_html.py -v`
Expected: 6 PASS

**Step 5: Commit**

```bash
git add app/api/lib/prospectus_html.py app/api/tests/test_prospectus_html.py
git commit -m "feat(prospecto): dibujar el plano en SVG y sumar el presupuesto por capítulo"
```

---

### Task 3: `_opportunity_detail()` — la página compañera, y su CSS

**Files:**
- Modify: `app/api/lib/prospectus_html.py` (nueva función + CSS + wiring en `build_prospectus_html`)
- Test: `app/api/tests/test_prospectus_html.py`

**Step 1: Write the failing test**

Agregar a `app/api/tests/test_prospectus_html.py`:

```python
from api.lib.prospectus_html import _opportunity_detail

BASE_PROPERTY = {"name": "[TEST] Casa Prueba"}


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
```

**Step 2: Run test to verify it fails**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_prospectus_html.py -k opportunity_detail -v`
Expected: FAIL — `ImportError: cannot import name '_opportunity_detail'`

**Step 3: Write minimal implementation**

En `app/api/lib/prospectus_html.py`, agregar la función justo después de
`_opportunity` (antes de `_closing`):

```python
def _opportunity_detail(p: dict) -> str:
    """Página compañera de una oportunidad: plano, renders y desglose del
    presupuesto de obra. "" si no hay ninguna de las tres — la tarjeta
    principal (`_opportunity`) ya dijo todo lo que hay que decir."""
    floorplan_html = _floorplan_svg(p.get("geometry") or {})

    renders = _imgs_by_type(p.get("renders") or [])
    renders_html = _strip(renders, "Renders", 4) if renders else ""

    budget = p.get("budget") or {}
    chapter_pairs = _chapter_totals(budget.get("lines", []), budget.get("chapters", []))
    budget_html = _kv_rows(chapter_pairs) if chapter_pairs else ""

    if not (floorplan_html or renders_html or budget_html):
        return ""

    sections = "".join([
        f'<div class="detail-section"><div class="col-label">Plano</div>{floorplan_html}</div>'
        if floorplan_html else "",
        f'<div class="detail-section"><div class="col-label">Renders</div>{renders_html}</div>'
        if renders_html else "",
        f'<div class="detail-section"><div class="col-label">Presupuesto de obra</div>{budget_html}</div>'
        if budget_html else "",
    ])
    return f"""<div class="page-block opp-detail">
  <div class="band">
    <div class="kicker">Oportunidad Activa</div>
    <h2>{_esc(p.get("name", ""))}</h2>
  </div>
  <div class="opp-detail-body">{sections}</div>
</div>"""
```

Ahora conectarla en el loop de `build_prospectus_html` (línea ~719-720):

```python
    for p in opportunity:
        parts.append(_opportunity(p))
```

cambia a:

```python
    for p in opportunity:
        parts.append(_opportunity(p))
        parts.append(_opportunity_detail(p))
```

Y agregar el CSS. En el bloque `_BODY_CSS` (línea 67 en adelante), justo
después de las reglas `.opp *` (después de la línea `.opp .strip img { height: 32mm; }`,
alrededor de la línea 192), agregar:

```css
.opp-detail { padding: var(--pad); }
.detail-section { margin-bottom: 8mm; }
.detail-section:last-child { margin-bottom: 0; }
.plano { display: flex; flex-wrap: wrap; gap: 6mm; }
.plano-floor { flex: 1; min-width: 70mm; }
.plano-floor-name { font-family: 'Inter', sans-serif; font-size: 7pt; font-weight: 600;
  color: var(--sec); margin-bottom: 2mm; }
.plano-svg { width: 100%; height: auto; border: 1px solid var(--border); background: var(--warm); }
.plano-room { font-family: 'Inter', sans-serif; font-size: 7px; fill: var(--sec); }
```

**Step 4: Run test to verify it passes**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_prospectus_html.py -v`
Expected: 11 PASS (todos los de Task 2 + Task 3)

**Step 5: Commit**

```bash
git add app/api/lib/prospectus_html.py app/api/tests/test_prospectus_html.py
git commit -m "feat(prospecto): página compañera de la oportunidad con plano, renders y presupuesto"
```

---

### Task 4: Enriquecer las oportunidades en `documents.py`

**Files:**
- Modify: `app/api/routes/documents.py`
- Test: `app/api/tests/test_documents.py`

**Step 1: Write the failing test**

Agregar al final de `app/api/tests/test_documents.py`. Necesita `storage`,
`renders_db` y `get_db` — revisar los imports ya presentes al inicio del
archivo (`from api.db import get_db, get_team_members` ya existe; agregar
`from api import renders_db, storage as storage_mod` si hiciera falta, o usar
los que ya expone `documents`).

```python
def test_prospectus_shows_the_plano_for_an_opportunity_with_geometry(client, test_property):
    from api.properties_db import set_geometry
    geometry = {
        "floors": [{
            "name": "Planta Baja",
            "vertices": {"v1": {"id": "v1", "x": 0, "y": 0},
                        "v2": {"id": "v2", "x": 5, "y": 0}},
            "edges": {"e1": {"id": "e1", "v1": "v1", "v2": "v2", "thickness": 0.15}},
            "rooms": [{"name": "Sala", "cx": 2.5, "cy": 0.5}],
        }],
    }
    set_geometry(test_property["id"], geometry)
    p = get_property(test_property["id"])
    html = build_prospectus_html([], [], [], [p])
    assert "<svg" not in html  # aún sin pasar por el enriquecimiento de documents.py

    from api.routes.documents import _embed_opportunity_extras
    _embed_opportunity_extras([p])
    html = build_prospectus_html([], [], [], [p])
    assert "<svg" in html
    assert "Sala" in html


def test_prospectus_shows_the_budget_chapters_for_an_opportunity(client, test_property):
    client.post(f"/api/properties/{test_property['id']}/budget/lines", json={
        "chapterName": "Albañilería", "name": "Cocina", "unit": "m2",
        "quantity": 1, "unitPrice": 500_000,
    })
    p = get_property(test_property["id"])

    from api.routes.documents import _embed_opportunity_extras
    _embed_opportunity_extras([p])
    html = build_prospectus_html([], [], [], [p])
    assert "Albañilería" in html
    assert "$500,000" in html  # la partida nueva
    assert "Otros" in html     # el residual sigue ahí


def test_prospectus_shows_the_renders_for_an_opportunity(client, test_property):
    from api import renders_db, storage
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c6360000002000154a24f7f0000000049454e44ae426082")
    path = f"properties/{test_property['id']}/renders/test.png"
    storage.upload(path, png, "image/png")
    renders_db.add_render(
        property_id=test_property["id"], source_image_id=None, file_path=path,
        content_type="image/png", prompt_id=None, prompt_text="[TEST]",
        provider="test", model="test")
    p = get_property(test_property["id"])

    from api.routes.documents import _embed_opportunity_extras
    _embed_opportunity_extras([p])
    html = build_prospectus_html([], [], [], [p])
    assert "Renders" in html
    assert "data:image/png;base64," in html


def test_prospectus_has_no_companion_page_without_plano_or_renders(client, test_property):
    """El presupuesto SIEMPRE trae al menos el residual, así que la página
    compañera SIEMPRE aparece para una propiedad recién nacida — es
    información real (el estimado grueso), no un placeholder. Esta prueba
    documenta esa expectativa en vez de asumir lo contrario."""
    p = get_property(test_property["id"])
    from api.routes.documents import _embed_opportunity_extras
    _embed_opportunity_extras([p])
    html = build_prospectus_html([], [], [], [p])
    assert 'class="page-block opp-detail"' in html
    assert "Otros" in html  # el residual, no un plano ni un render
    assert "<svg" not in html
    assert "Renders" not in html
```

**Step 2: Run test to verify it fails**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_documents.py -k "plano or budget_chapters or shows_the_renders or companion_page" -v`
Expected: FAIL — `ImportError: cannot import name '_embed_opportunity_extras'`

**Step 3: Write minimal implementation**

En `app/api/routes/documents.py`, cambiar los imports (líneas 11-16):

```python
from api.db import get_team_members
from api.properties_db import get_properties, get_property
```

por:

```python
from api.db import get_team_members, get_db
from api.properties_db import get_properties, get_property, get_geometry
from api import renders_db, budget_db
```

Agregar la función nueva, justo después de `_embed_images` (ver Task 1):

```python
def _embed_opportunity_extras(opportunities: list[dict]) -> None:
    """Todo lo que la página compañera de una oportunidad necesita: plano,
    renders (con su imagen ya embebida) y presupuesto por capítulo. Bloqueante
    (DB + storage): se llama junto con _embed_images, off the event loop."""
    with get_db() as conn:
        for p in opportunities:
            p["geometry"] = get_geometry(p["id"]) or {}
            renders = renders_db.list_renders(p["id"])
            _embed_image_list(renders)
            p["renders"] = renders
            p["budget"] = budget_db.get_budget(conn, p["id"])
```

Y en `generate_prospectus()`, cambiar:

```python
    favorites = [p for p in get_properties() if p.get("isFavorite")]
    if not favorites:
        raise HTTPException(
            status_code=400,
            detail="No favorites set. Mark at least one property as favorite.",
        )
    await asyncio.to_thread(_embed_images, favorites)
    ...
    html = build_prospectus_html(
        _by_status(favorites, "vendida"),
        _by_status(favorites, "en_renta"),
        _by_status(favorites, "desarrollo"),
        _by_status(favorites, "oferta", "prospecto"),
        get_team_members(),
    )
```

por:

```python
    favorites = [p for p in get_properties() if p.get("isFavorite")]
    if not favorites:
        raise HTTPException(
            status_code=400,
            detail="No favorites set. Mark at least one property as favorite.",
        )
    await asyncio.to_thread(_embed_images, favorites)
    opportunities = _by_status(favorites, "oferta", "prospecto")
    await asyncio.to_thread(_embed_opportunity_extras, opportunities)
    ...
    html = build_prospectus_html(
        _by_status(favorites, "vendida"),
        _by_status(favorites, "en_renta"),
        _by_status(favorites, "desarrollo"),
        opportunities,
        get_team_members(),
    )
```

(el `...` es el comentario existente sobre cómo el prospecto lee cada etapa — no tocarlo, solo insertar las dos líneas nuevas antes del `html = build_prospectus_html(`).

**Step 4: Run test to verify it passes**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/test_documents.py tests/test_prospectus_html.py -v`
Expected: all PASS

**Step 5: Commit**

```bash
git add app/api/routes/documents.py app/api/tests/test_documents.py
git commit -m "feat(prospecto): enriquecer oportunidades con plano, renders y presupuesto"
```

---

### Task 5: Suite completa + verificación visual

**Files:** ninguno nuevo — solo verificación.

**Step 1: Correr toda la suite de API**

Run: `cd app/api && ../../.venv/bin/python -m pytest tests/ -q`
Expected: todos PASS, sin regresiones fuera de `test_documents.py`/`test_prospectus_html.py`.

**Step 2: Generar un PDF real y revisarlo a ojo**

Con el stack vivo (`make app` o `uvicorn`/`vite` sueltos) y una propiedad
`oferta`/`prospecto` favorita con geometría, renders y presupuesto capturados
(usar el login estándar de dev, `delagarzaguerra@gmail.com`):

```bash
curl -s -X POST localhost:8000/api/documents/prospectus \
  -H "Authorization: Bearer $TOKEN" -o /tmp/prospecto-test.pdf
```

Abrir `/tmp/prospecto-test.pdf` y confirmar: el plano se ve proporcionado (no
estirado ni cortado), los nombres de cuarto caen dentro de su piso, los
renders se ven nítidos, la tabla de presupuesto suma correctamente contra el
total. Un `assert` de texto no detecta un SVG mal escalado — esto sí.

**Step 3: Confirmar que el resto del prospecto no cambió**

Generar un prospecto con propiedades vendida/renta/desarrollo también
favoritas y confirmar visualmente que esas páginas son idénticas a como
estaban antes de este plan (el companion page solo debe aparecer después de
cada oportunidad, nunca después de vendida/renta/desarrollo).

**Step 4: Commit final (si algo se ajustó durante la verificación visual)**

```bash
git add -A
git commit -m "fix(prospecto): ajustes de la verificación visual del plano/renders/presupuesto"
```

(Omitir este paso si la verificación visual no requirió cambios.)

---

## Desviaciones del plan (verificadas en subagent-driven-development, no aplicadas retroactivamente a los bloques de código de arriba)

Cada implementador siguió TDD contra el código exacto de este plan y, en
varios puntos, ese código estaba mal — verificado contra la fuente real, no
supuesto. Los bloques de código de las Tasks 1-4 arriba quedan como el plan
ORIGINAL (así se pidió el trabajo); esto documenta dónde el resultado final
difiere y por qué, para que nadie lea este archivo como el estado actual del
código.

- **Task 2 — `sy()` estaba invertido.** El plan tenía `(y - min_y) * scale + _SVG_PAD`. El eje y del modelo del editor apunta hacia arriba (verificado en `app/web/src/lib/floorplan/viewTransform.ts`, ambos modos de cámara); el de SVG apunta hacia abajo. El código enviado usa `(max_y - y) * scale + _SVG_PAD` — de lo contrario cada plano se imprimía espejeado verticalmente. Regresión cubierta por `test_the_plan_is_not_printed_upside_down`.
- **Task 3 — CSS incompleto en dos puntos.** `.opp-detail { padding: var(--pad) }` insetaba la banda verde a doble padding (comparar contra `.opp-body`/`.proj-body`, que pad el cuerpo, no el contenedor con la banda) — se movió a `.opp-detail-body`. Y `.opp-detail .strip img` no tenía altura propia (`.opp .strip img`'s 32mm no aplica a esta clase) — sin la regla añadida, un render se imprimía a ~170mm, más de media página. Se agregó `.opp-detail .strip img { height: 45mm; }`.
- **Task 3 — `_strip(renders, "Renders", 4)` duplicaba la etiqueta.** `_strip` ya imprime su propio `strip-label`, y `_opportunity_detail` también envuelve la sección en un `col-label` con el mismo texto — dos "RENDERS" apilados. Código enviado: `_strip(renders, "", 4)` (label vacío, `_strip` calla el suyo).
- **Task 4 — se eliminó `p["geometry"] = get_geometry(p["id"]) or {}` (y el import de `get_geometry`).** `get_properties()`/`get_property()` ya traen `geometry` en cada dict (`properties_db._fetch` hace `SELECT p.*`, y `geometry` sobrevive el paso snake→camel) — confirmado contra 21 propiedades reales, las 21 ya la traían. La línea del plan era una segunda lectura que sobrescribía el campo consigo mismo — dos fuentes vivas para el mismo hecho, justo lo que este dominio evita en todos lados.
- **Task 4 — la prueba de renders no podía pasar tal como estaba escrita.** El PNG hexadecimal del plan es un archivo corrupto (Pillow lo rechaza), y además `_resize_for_pdf` siempre reencoda a JPEG sin importar el formato de entrada — así que `data:image/png;base64,` nunca podía aparecer en el HTML. La prueba enviada genera un PNG real con Pillow y afirma `data:image/jpeg;base64,`.

Ninguna desviación cambió el alcance de una task ni tocó código de otra — cada una se detectó, se verificó contra la fuente real (no se asumió), y se aprobó en el review de spec compliance correspondiente antes de continuar.
