# Elegir el render — plan de implementación

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Que junto a cada piso y a cada foto fuente el prospecto imprima cuando mucho 1 render — el que alguien marcó con estrella — y nunca más una tira de sobrantes.

**Architecture:** Columna `is_chosen` en `property_renders`, garantizada por dos índices únicos parciales (uno por piso+variante, otro por foto fuente). La API expone elegir/quitar; la UI gana el botón de estrella en las tarjetas de render de los dos paneles (LevantamientoPanel ya tiene selector por piso, FotosPanel gana el mismo para fotos); el PDF deja de "emparejar hasta 2 y mandar el resto a una tira" y en su lugar imprime solo lo elegido — sin estrella, sin fila.

**Tech Stack:** PostgreSQL (dbmate) · Python/FastAPI · pytest · TypeScript/React · vitest

**Diseño:** `docs/plans/2026-08-17-render-elegido-por-piso-y-foto-design.md` — léelo antes de empezar. Explica por qué el índice único vive en la base de datos y no solo en una transacción (el único precedente del repo, `cotizaciones.is_selected`, no lo hace así), y por qué editar sobre un render elegido lo desmarca de facto sin escribir código para eso.

**Rama:** `feat/render-elegido-por-piso`, arriba de `feat/plano-en-prospecto` (PR #45). Se trabaja en `.worktrees/plano-en-prospecto` — ya tiene BD clonada (`patrio_plano_en_prospecto`), bundle del plano compilado, y API (`:8012`)/web (`:5176`) corriendo.

---

## Task 1: Migración `046_render_is_chosen.sql`

**Files:**
- Create: `db/migrations/046_render_is_chosen.sql`
- Test: `app/api/tests/test_render_is_chosen_schema.py`

**Step 1: Write the failing test**

```python
"""La garantía de «uno por grupo» vive en el índice, no en el código que la usa —
si algo la rodea (una migración de datos, un script suelto), la base de datos la
sigue cumpliendo. Esta suite prueba el índice directo, sin pasar por la API."""
import pytest
from psycopg2 import IntegrityError

from api.db import get_db


PROPERTY = dict(name="[TEST] Elegir render", address="Calle Test 1", city="Monterrey",
                status="prospecto", url="http://x", latitude=25.67, longitude=-100.31)


@pytest.fixture
def property_id():
    with get_db() as conn:
        pid = conn.execute(
            "INSERT INTO properties (name, address, city, status, url, latitude, longitude)"
            " VALUES (%(name)s, %(address)s, %(city)s, %(status)s, %(url)s,"
            "         %(latitude)s, %(longitude)s) RETURNING id", PROPERTY).fetchone()["id"]
    yield pid
    with get_db() as conn:
        conn.execute("DELETE FROM properties WHERE id = %s", (pid,))


def _insert_render(conn, property_id, **cols):
    cols = {"property_id": property_id, "file_path": "x.png", "content_type": "image/png",
            "prompt_text": "x", "provider": "openai", "model": "gpt-image-2", **cols}
    keys = ", ".join(cols)
    placeholders = ", ".join(f"%({k})s" for k in cols)
    return conn.execute(
        f"INSERT INTO property_renders ({keys}) VALUES ({placeholders}) RETURNING id",
        cols).fetchone()["id"]


def test_no_puede_haber_dos_elegidos_en_el_mismo_piso_y_variante(property_id):
    with get_db() as conn:
        _insert_render(conn, property_id, floor_id="f1", source_variant="original", is_chosen=True)
        with pytest.raises(IntegrityError):
            _insert_render(conn, property_id, floor_id="f1", source_variant="original", is_chosen=True)


def test_variantes_distintas_del_mismo_piso_pueden_tener_cada_una_su_elegido(property_id):
    with get_db() as conn:
        _insert_render(conn, property_id, floor_id="f1", source_variant="original", is_chosen=True)
        # No debe reventar: es OTRO grupo (misma piso, variante distinta).
        _insert_render(conn, property_id, floor_id="f1", source_variant="planned", is_chosen=True)


def test_no_puede_haber_dos_elegidos_de_la_misma_foto(property_id):
    with get_db() as conn:
        _insert_render(conn, property_id, source_image_id=None, is_chosen=True,
                       floor_id=None, source_variant=None)
    # source_image_id real hace falta para la prueba de choque; se usa un valor
    # fijo porque el índice no valida FK, solo unicidad — no hace falta una foto real.
    with get_db() as conn:
        _insert_render(conn, property_id, source_image_id=99, is_chosen=True)
        with pytest.raises(IntegrityError):
            _insert_render(conn, property_id, source_image_id=99, is_chosen=True)


def test_pisos_sin_floor_id_nunca_chocan_entre_si(property_id):
    """floor_id NULL es el caso de los renders anteriores al 7-ago (migración 042,
    sin backfill). NULL <> NULL en un índice único de Postgres, así que da igual
    cuántos existan marcados: nunca compiten. El índice también los excluye
    explícitamente (WHERE floor_id IS NOT NULL) — las dos protecciones cuentan."""
    with get_db() as conn:
        _insert_render(conn, property_id, floor_id=None, source_variant=None, is_chosen=True)
        _insert_render(conn, property_id, floor_id=None, source_variant=None, is_chosen=True)
```

**Step 2: Run to verify it fails**

```bash
cd /home/eduardo/Documents/repos/new-repos/patrio/.worktrees/plano-en-prospecto
PYTHONPATH=".:app" .venv/bin/pytest app/api/tests/test_render_is_chosen_schema.py -v
```
Esperado: FAIL — `column "is_chosen" does not exist`.

**Step 3: Write the migration**

```sql
-- migrate:up

-- Junto a cada plano o cada foto pueden existir varios renders (varias cadenas de
-- edición independientes: cada "GENERAR RENDER" nuevo arranca una raíz propia). El
-- prospecto necesita UNO por piso+variante y UNO por foto fuente — no "el más
-- reciente", sino el que alguien de verdad revisó y eligió.
--
-- `is_chosen` es la marca; los DOS índices son la garantía. Un render nace de un
-- piso (floor_id + source_variant) o de una foto (source_image_id), nunca de los
-- dos, así que los índices no compiten entre sí — cada uno solo mira su propio
-- grupo (WHERE floor_id/source_image_id IS NOT NULL) y dentro de ese grupo hace
-- físicamente imposible tener dos elegidos a la vez, sin importar qué código
-- escriba la fila después. El único precedente del repo (cotizaciones.is_selected)
-- garantiza "solo uno" con una transacción, sin constraint — aquí "solo uno" es la
-- razón de ser de la feature, no un efecto secundario de cómo se escribe.
--
-- Sin backfill: ninguna propiedad tiene hoy una elección honesta — "el render que
-- alguien de verdad prefirió" nunca se capturó — así que todo nace en FALSE.
ALTER TABLE property_renders ADD COLUMN IF NOT EXISTS is_chosen BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_render_chosen_per_floor
  ON property_renders (property_id, floor_id, source_variant)
  WHERE is_chosen AND floor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_render_chosen_per_photo
  ON property_renders (property_id, source_image_id)
  WHERE is_chosen AND source_image_id IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS idx_render_chosen_per_photo;
DROP INDEX IF EXISTS idx_render_chosen_per_floor;
ALTER TABLE property_renders DROP COLUMN IF EXISTS is_chosen;
```

**Step 4: Apply it and run the lint local**

```bash
cd /home/eduardo/Documents/repos/new-repos/patrio/.worktrees/plano-en-prospecto
bad=$(grep -rEin "^\s*CREATE (TABLE|UNIQUE INDEX|INDEX)\b" db/migrations/ | grep -iv "IF NOT EXISTS" || true)
[ -z "$bad" ] && echo "lint OK" || echo "$bad"

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/patrio_plano_en_prospecto?sslmode=disable" \
  dbmate --migrations-dir db/migrations --no-dump-schema up
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/patrio_plano_en_prospecto_test?sslmode=disable" \
  dbmate --migrations-dir db/migrations --no-dump-schema up
```
Esperado: `Applying: 046_render_is_chosen.sql` en las dos BDs, `lint OK`.

**Step 5: Run to verify it passes**

```bash
PYTHONPATH=".:app" .venv/bin/pytest app/api/tests/test_render_is_chosen_schema.py -v
```
Esperado: 4 passed.

**Step 6: Regenerar `db/schema.sql`** (memoria: `pg_dump` local no coincide de versión con el server)

```bash
docker run --rm --network host \
  -e DATABASE_URL="postgresql://postgres:postgres@localhost:5432/patrio_plano_en_prospecto?sslmode=disable" \
  -v "$(pwd)/db:/db" ghcr.io/amacneil/dbmate:latest \
  --migrations-dir /db/migrations --schema-file /db/schema.sql dump
git diff db/schema.sql   # debe traer SOLO is_chosen + los dos índices
```

**Step 7: Commit**

```bash
git add db/migrations/046_render_is_chosen.sql db/schema.sql app/api/tests/test_render_is_chosen_schema.py
git commit -m "feat(renders): is_chosen — un elegido por piso, otro por foto, garantizado por índice"
```

---

## Task 2: `renders_db.py` — `choose_render` / `unchoose_render`

**Files:**
- Modify: `app/api/renders_db.py` (agregar después de `delete_render`, línea ~228)
- Test: `app/api/tests/test_renders.py`

**Step 1: Write the failing tests**

Agrega al final de `test_renders.py`:

```python
# ─── Elegir el render (Task 2) ─────────────────────────────────────────────────

def test_choose_a_photo_render_marks_it_and_unmarks_siblings(client, test_property, source_image, fake_openai):
    a = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    b = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "y"}).json()
    r = client.put(f"/api/properties/{test_property['id']}/renders/{a['id']}/choose")
    assert r.status_code == 200, r.text
    assert r.json()["isChosen"] is True

    r = client.put(f"/api/properties/{test_property['id']}/renders/{b['id']}/choose")
    assert r.status_code == 200, r.text
    assert r.json()["isChosen"] is True
    renders = {r["id"]: r for r in client.get(f"/api/properties/{test_property['id']}/renders").json()}
    assert renders[a["id"]]["isChosen"] is False   # b lo apagó


def test_choosing_one_photo_does_not_touch_another_photos_choice(
        client, test_property, source_image, fake_openai):
    second_photo = client.post(
        f"/api/properties/{test_property['id']}/images",
        files={"file": ("2.jpg", io.BytesIO(_png_bytes()), "image/jpeg")}).json()
    a = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    c = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": second_photo["id"], "promptText": "z"}).json()
    client.put(f"/api/properties/{test_property['id']}/renders/{a['id']}/choose")
    client.put(f"/api/properties/{test_property['id']}/renders/{c['id']}/choose")
    renders = {r["id"]: r for r in client.get(f"/api/properties/{test_property['id']}/renders").json()}
    assert renders[a["id"]]["isChosen"] is True
    assert renders[c["id"]]["isChosen"] is True


def test_unchoose_removes_the_mark_without_choosing_another(
        client, test_property, source_image, fake_openai):
    a = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    client.put(f"/api/properties/{test_property['id']}/renders/{a['id']}/choose")
    r = client.delete(f"/api/properties/{test_property['id']}/renders/{a['id']}/choose")
    assert r.status_code == 200, r.text
    assert r.json()["isChosen"] is False


def test_choosing_a_plan_render_scopes_by_floor_and_variant(client, test_property, fake_openai):
    a = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "x", "variant": "original", "floorId": "f1", "floorName": "Planta Baja"},
    ).json()
    other_variant = client.post(
        f"/api/properties/{test_property['id']}/renders/from-plan",
        files={"file": ("plano.png", io.BytesIO(_png_bytes()), "image/png")},
        data={"promptText": "y", "variant": "planned", "floorId": "f1", "floorName": "Planta Baja"},
    ).json()
    client.put(f"/api/properties/{test_property['id']}/renders/{a['id']}/choose")
    r = client.put(f"/api/properties/{test_property['id']}/renders/{other_variant['id']}/choose")
    assert r.status_code == 200, r.text
    renders = {r["id"]: r for r in client.get(f"/api/properties/{test_property['id']}/renders").json()}
    assert renders[a["id"]]["isChosen"] is True     # variante distinta: no lo tocó
    assert renders[other_variant["id"]]["isChosen"] is True


def test_choosing_a_render_without_floor_or_photo_is_rejected(client, test_property, fake_openai):
    """Un render huérfano (su foto o su piso se borraron) no pertenece a ningún
    grupo — no hay «los demás» que apagar, así que elegirlo no tiene sentido."""
    from api import renders_db
    render = renders_db.add_render(test_property["id"], None, "x.png", "image/png",
                                   None, "x", "openai", "gpt-image-2")
    r = client.put(f"/api/properties/{test_property['id']}/renders/{render['id']}/choose")
    assert r.status_code == 422


def test_choosing_a_render_from_another_property_404s(client, test_property, make_property,
                                                        source_image, fake_openai):
    other = make_property()
    a = client.post(f"/api/properties/{test_property['id']}/renders",
                    json={"sourceImageId": source_image["id"], "promptText": "x"}).json()
    r = client.put(f"/api/properties/{other['id']}/renders/{a['id']}/choose")
    assert r.status_code == 404
```

Revisa el import de `io` al inicio de `test_renders.py` (ya se usa en `test_from_plan_without_variant_is_rejected`) — no hace falta agregarlo de nuevo.

**Step 2: Run to verify it fails**

```bash
PYTHONPATH=".:app" .venv/bin/pytest app/api/tests/test_renders.py -k choose -v
```
Esperado: FAIL — `404 Not Found` (la ruta no existe todavía) en todos.

**Step 3: Implement `renders_db.py`**

Agrega después de `delete_render` (línea ~228):

```python
class NoGroup(RuntimeError):
    """El render no tiene piso NI foto — su piso o su foto se borraron. No hay
    grupo dentro del cual «elegirlo» tenga sentido."""


def choose_render(property_id: int, render_id: int) -> dict:
    """Marca este render y apaga cualquier otro del MISMO grupo (piso+variante, o
    foto fuente) en un solo bloque de conexión — mismo patrón que
    `select_cotizacion` (db_proveedores.py). El índice único parcial es la red de
    seguridad si algo se cuela entre las dos sentencias; esta transacción es la
    primera línea."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT floor_id, source_variant, source_image_id FROM property_renders"
            " WHERE id = %s AND property_id = %s", (render_id, property_id)).fetchone()
        if row is None:
            raise NotFound(f"Render {render_id} no encontrado en la propiedad {property_id}")
        if row["floor_id"] is not None:
            conn.execute(
                "UPDATE property_renders SET is_chosen = FALSE"
                " WHERE property_id = %s AND floor_id = %s AND source_variant = %s",
                (property_id, row["floor_id"], row["source_variant"]))
        elif row["source_image_id"] is not None:
            conn.execute(
                "UPDATE property_renders SET is_chosen = FALSE"
                " WHERE property_id = %s AND source_image_id = %s",
                (property_id, row["source_image_id"]))
        else:
            raise NoGroup(f"Render {render_id} no tiene piso ni foto — no se puede elegir")
        chosen = conn.execute(
            "UPDATE property_renders SET is_chosen = TRUE WHERE id = %s RETURNING *",
            (render_id,)).fetchone()
    return _row_to_dict(chosen)


def unchoose_render(property_id: int, render_id: int) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "UPDATE property_renders SET is_chosen = FALSE"
            " WHERE id = %s AND property_id = %s RETURNING *",
            (render_id, property_id)).fetchone()
    if row is None:
        raise NotFound(f"Render {render_id} no encontrado en la propiedad {property_id}")
    return _row_to_dict(row)
```

**Step 4: Add the routes** — `app/api/routes/renders.py`, después de `delete_property_render`:

```python
@router.put("/api/properties/{property_id}/renders/{render_id}/choose",
            operation_id="property_render_choose")
def choose_property_render(property_id: int, render_id: int,
                           _: dict = Depends(get_current_user)):
    try:
        return renders_db.choose_render(property_id, render_id)
    except renders_db.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except renders_db.NoGroup as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/api/properties/{property_id}/renders/{render_id}/choose",
               operation_id="property_render_unchoose")
def unchoose_property_render(property_id: int, render_id: int,
                             _: dict = Depends(get_current_user)):
    try:
        return renders_db.unchoose_render(property_id, render_id)
    except renders_db.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
```

**Step 5: Run to verify it passes**

```bash
PYTHONPATH=".:app" .venv/bin/pytest app/api/tests/test_renders.py -k choose -v
```
Esperado: 6 passed.

**Step 6: Run the whole file, nada se rompió**

```bash
PYTHONPATH=".:app" .venv/bin/pytest app/api/tests/test_renders.py -q
```

**Step 7: Commit**

```bash
git add app/api/renders_db.py app/api/routes/renders.py app/api/tests/test_renders.py
git commit -m "feat(renders): PUT/DELETE .../choose — elegir o quitar la estrella de un render"
```

---

## Task 3: El PDF deja de emparejar-y-sobrar; empieza a elegir

Esta tarea reescribe `_plan_rows` (quita `_PAIRED_RENDERS_MAX`/`leftovers`) y agrega
`_photo_rows`/`_photo_block`. Es la tarea con más riesgo de romper pruebas
existentes — léela completa antes de tocar código.

**Files:**
- Modify: `app/api/lib/prospectus_html.py` (líneas 425-528 y `_opportunity_detail`, ~908-960)
- Modify: `app/api/tests/test_prospectus_html.py` (reescribe el bloque `_plan_rows`)
- Modify: `app/api/tests/test_documents.py` (una prueba deja de tener sentido)

**Step 1: Write the failing tests**

En `test_prospectus_html.py`, reemplaza el bloque completo desde
`def _render(fid, variant, uri="data:x", name=None):` hasta el final de
`test_sin_hojas_todo_es_tira_suelta` (busca ese nombre — es la última prueba del
bloque de `_plan_rows`) por lo siguiente. **No borres `_sheet`, sigue igual.**

```python
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


# ─── _photo_rows — foto fuente + su render elegido ─────────────────────────────

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
```

**Step 2: Run to verify it fails**

```bash
PYTHONPATH=".:app" .venv/bin/pytest app/api/tests/test_prospectus_html.py -v 2>&1 | tail -40
```
Esperado: los nuevos FAIL (`_plan_rows` regresa tupla, no lista; `_photo_rows` no
existe); las pruebas viejas de `leftovers`/cap que NO reemplazaste también van a
fallar — es exactamente lo que Step 3 corrige, bórralas ahí, no antes.

**Step 3: Implement**

Reemplaza TODO el bloque desde el comentario `# Cuántos renders caben junto a una
hoja...` (línea 435) hasta el final de `_plan_side` (línea 513) por:

```python
def _plan_rows(sheets: list[dict], renders: list[dict]) -> list[dict]:
    """Las hojas dibujadas + las cabezas de render → filas por LINAJE de piso.

    Una fila es un piso a lo largo de sus variantes, no una hoja: un piso planeado
    nacido de PARTIR/RE-PARTIR comparte el `id` de su contraparte original
    (`LevantamientoPanel.tsx:231`), y ese id compartido es justo lo que permite
    alinear el antes con el después sin heurística.

    De los renders de cada (floorId, sourceVariant) solo entra el que trae
    `isChosen` — nunca hay más de uno, porque el índice único de la base de
    datos ya lo garantiza (migración 046). Sin estrella, ese lado queda con
    `renders: []`: el PLANO se imprime de todos modos (es el ancla dimensional
    de la PR #45, no depende de que exista un render), solo el hueco de imagen
    queda vacío. No hay tira suelta ni «el más reciente» de respaldo — si nadie
    eligió, el documento no adivina.

    Por eso mismo un render empata por `(floorId, sourceVariant)`, LAS DOS, nunca
    solo la primera: el propio comentario de `LevantamientoPanel.tsx` lo advirtió
    por escrito antes de que esta función existiera.

    El nombre del piso sale de la HOJA, no del render: `floorName` en el render
    está congelado para sobrevivir a un renombre, pero el piso vivo siempre
    existe si hay una hoja que mostrar.
    """
    chosen_by_key = {
        (r["floorId"], r["sourceVariant"]): r
        for r in renders
        if r.get("dataUri") and r.get("isChosen") and r.get("floorId") is not None
    }
    by_key = {(s["floorId"], s["variant"]): s for s in sheets}

    order, seen = [], set()
    for s in sheets:
        if s["floorId"] not in seen:
            seen.add(s["floorId"])
            order.append(s["floorId"])

    rows = []
    for fid in order:
        antes, despues = by_key.get((fid, "original")), by_key.get((fid, "planned"))
        antes_r = chosen_by_key.get((fid, "original"))
        despues_r = chosen_by_key.get((fid, "planned"))
        # Un planeado clonado y aún no editado produce el MISMO string —mismo
        # serializador, misma entrada—. Imprimirlo bajo "Antes / Después" afirmaría
        # una transformación que nadie diseñó. Si las dos variantes tenían estrella
        # propia, se queda con la del lado "antes" — arbitrario entre dos iguales,
        # pero determinista.
        if antes and despues and antes["svg"] == despues["svg"]:
            despues = None
        rows.append({
            "floorName": (antes or despues)["floorName"],
            "antes": {**antes, "renders": [antes_r] if antes_r else []} if antes else None,
            "despues": {**despues, "renders": [despues_r] if despues_r else []} if despues else None,
        })
    return rows


def _photo_rows(images: list[dict], renders: list[dict]) -> list[dict]:
    """Foto fuente + su render elegido — mismo principio que `_plan_rows`, sin
    Antes/Después porque una foto no tiene variantes. Sin estrella, esa foto no
    imprime fila: a diferencia del plano, una foto sin su render elegido no tiene
    nada propio que decir aquí (la foto en sí ya se ve en la galería de arriba)."""
    chosen_by_image = {
        r["sourceImageId"]: r for r in renders
        if r.get("dataUri") and r.get("isChosen") and r.get("sourceImageId") is not None
    }
    rows = []
    for img in images:
        r = chosen_by_image.get(img["id"])
        if r is not None:
            rows.append({"svg": f'<img src="{img["dataUri"]}" alt="">', "renders": [r]})
    return rows


def _plan_side(side: dict | None, label: str, show_label: bool) -> str:
    """Un lado de una fila: la hoja (o foto) y, a su derecha, su render elegido.

    `show_label` solo es cierto cuando la fila trae las DOS variantes: un piso sin
    propuesta no necesita que le digan "Antes" de qué."""
    if side is None:
        return ""
    lab = f'<div class="plan-side-label">{_esc(label)}</div>' if show_label else ""
    imgs = "".join(f'<img src="{r["dataUri"]}" alt="">' for r in side["renders"])
    renders = f'<div class="plan-renders">{imgs}</div>' if imgs else ""
    return (f'<div class="plan-side">{lab}<div class="plan-pair">'
            f'<div class="plan-sheet">{side["svg"]}</div>{renders}</div></div>')


def _plan_block(rows: list[dict]) -> str:
    """La medida junto a la imagen que la aproxima. Sin filas → "", el bloque
    desaparece: si está va, si no está no va."""
    if not rows:
        return ""
    out = []
    for row in rows:
        both = row["antes"] is not None and row["despues"] is not None
        out.append(f'<div class="plan-row"><div class="col-label">{_esc(row["floorName"])}</div>'
                   + _plan_side(row["antes"], "Antes", both)
                   + _plan_side(row["despues"], "Después", both)
                   + '</div>')
    return "".join(out)


def _photo_block(rows: list[dict]) -> str:
    """Foto + su render elegido, mismo layout de pareja que `_plan_block` pero sin
    encabezado de piso — una foto no tiene nombre que anunciar."""
    if not rows:
        return ""
    return "".join(f'<div class="plan-row">{_plan_side(row, "", False)}</div>' for row in rows)
```

Ahora actualiza `_opportunity_detail` (busca `def _opportunity_detail`). Reemplaza
las primeras líneas del cuerpo — desde `rows, leftovers = _plan_rows(...)` hasta
`budget_html = _budget_full(...)` — por:

```python
    rows = _plan_rows(p.get("planSheets") or [], p.get("renderHeads") or [])
    plan_html = _plan_block(rows)

    photo_rows = _photo_rows(p.get("images") or [], p.get("renderHeads") or [])
    photos_html = _photo_block(photo_rows)

    budget = p.get("budget") or {}
    budget_html = _budget_full(budget.get("lines", []), budget.get("chapters", []))
```

Y el guard + `sections`:

```python
    if not (plan_html or photos_html or budget_html):
        return ""

    sections = "".join([
        f'<div class="detail-section"><div class="col-label">Plano y propuesta</div>{plan_html}</div>'
        if plan_html else "",
        # Solo lo que alguien eligió de verdad: sin estrella marcada en ninguna
        # foto de la propiedad, esta sección no existe — no hay tira suelta
        # esperando a los que no se eligieron.
        f'<div class="detail-section"><div class="col-label">Fotos y propuesta</div>{photos_html}</div>'
        if photos_html else "",
        f'<div class="detail-section"><div class="col-label">Presupuesto de obra</div>{budget_html}</div>'
        if budget_html else "",
    ])
    return f'<div class="opp-detail">{sections}</div>'
```

Actualiza también el docstring de `_opportunity_detail`: el párrafo que dice
"Los renders son la cabeza de cada cadena... Antes esta sección traía `renders`
sin deduplicar..." queda obsoleto en su última frase (ya no hay una sola tira,
hay filas por piso y filas por foto, cada una con su elegido). Ajusta la prosa
para reflejar esto — no hace falta que copies texto exacto, pero no dejes la
mención a "la tira" viva.

**Step 4: Arregla la prueba de `test_documents.py` que ya no tiene sentido**

`test_the_opportunity_detail_shows_render_heads_labeled_as_proposal` (línea 334)
construye un render sin `sourceImageId` ni `floorId` — con la tira suelta viva
eso alcanzaba para imprimirse; ahora un render sin grupo no imprime en ningún
lado, así que la prueba tiene que construir una foto real y un render elegido de
esa foto. Reemplázala por:

```python
def test_the_opportunity_detail_shows_a_chosen_render_next_to_its_photo(client, test_property):
    """Un render elegido (isChosen) se imprime junto a la foto de la que nació,
    rotulado como propuesta — nunca disfrazado de foto real."""
    p = get_property(test_property["id"])
    p["images"] = [{"id": 7, "dataUri": "data:image/jpeg;base64,FOTO"}]
    p["renderHeads"] = [{"sourceImageId": 7, "isChosen": True, "floorId": None,
                         "sourceVariant": None, "dataUri": "data:image/jpeg;base64,AAAA"}]
    html = build_prospectus_html([], [], [], [p])
    assert "Fotos y propuesta" in html
    assert "data:image/jpeg;base64,AAAA" in html


def test_a_render_without_a_star_does_not_print_anywhere(client, test_property):
    p = get_property(test_property["id"])
    p["images"] = [{"id": 7, "dataUri": "data:image/jpeg;base64,FOTO"}]
    p["renderHeads"] = [{"sourceImageId": 7, "isChosen": False, "floorId": None,
                         "sourceVariant": None, "dataUri": "data:image/jpeg;base64,AAAA"}]
    html = build_prospectus_html([], [], [], [p])
    assert "Fotos y propuesta" not in html
    assert "data:image/jpeg;base64,AAAA" not in html
```

**Step 5: Run to verify everything passes**

```bash
PYTHONPATH=".:app" .venv/bin/pytest app/api/tests/test_prospectus_html.py app/api/tests/test_documents.py -q
```

**Step 6: Confirma que no queda ninguna mención muerta**

```bash
grep -n "_PAIRED_RENDERS_MAX\|leftovers" app/api/lib/prospectus_html.py app/api/tests/test_prospectus_html.py app/api/tests/test_documents.py
```
Esperado: sin resultados.

**Step 7: Commit**

```bash
git add app/api/lib/prospectus_html.py app/api/tests/test_prospectus_html.py app/api/tests/test_documents.py
git commit -m "feat(prospecto): imprimir solo el render elegido — sin tira suelta, ni de plano ni de foto"
```

---

## Task 4: Frontend — tipos y cliente

**Files:**
- Modify: `app/web/src/lib/types.ts:55-84` (`PropertyRender`)
- Modify: `app/web/src/lib/api.ts` (después de `deletePropertyRender`)
- Test: no hace falta prueba propia — lo cubren las pruebas de componente de las tareas 5 y 6.

**Step 1: `types.ts`** — agrega el campo a `PropertyRender`, justo antes del cierre `}` (después de `createdAt: string`):

```ts
  createdAt: string
  /** Si este render es EL elegido para imprimirse en el prospecto — de su piso
   * (floorId+sourceVariant) o de su foto (sourceImageId), lo que aplique. Cuando
   * mucho un render por grupo trae esto en `true` (migración 046, índice único
   * parcial). */
  isChosen: boolean
```

**Step 2: `api.ts`** — agrega después de `deletePropertyRender`:

```ts
export async function choosePropertyRender(id: number, renderId: number): Promise<PropertyRender> {
  const res = await authFetch(`${BASE}/api/properties/${id}/renders/${renderId}/choose`, { method: 'PUT' })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function unchoosePropertyRender(id: number, renderId: number): Promise<PropertyRender> {
  const res = await authFetch(`${BASE}/api/properties/${id}/renders/${renderId}/choose`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}
```

**Step 3: Typecheck**

```bash
cd /home/eduardo/Documents/repos/new-repos/patrio/.worktrees/plano-en-prospecto/app/web
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx tsc --noEmit
```
Esperado: limpio (nada más referencia `isChosen` todavía, así que no debería
haber errores nuevos ni faltantes).

**Step 4: Commit**

```bash
git add app/web/src/lib/types.ts app/web/src/lib/api.ts
git commit -m "feat(renders): isChosen en el tipo, choose/unchoose en el cliente"
```

---

## Task 5: La estrella en `RendersPanel`

**Files:**
- Modify: `app/web/src/components/detail/RendersPanel.tsx`
- Test: `app/web/src/components/detail/RendersPanel.test.tsx`

**Step 1: Write the failing tests**

Busca cómo el archivo de prueba ya monta `RendersPanel` (mira un test existente
para copiar el patrón exacto de props/mocks) y agrega:

```tsx
it('la estrella vacía llama a onChoose con el id del render', async () => {
  const onChoose = vi.fn().mockResolvedValue(undefined)
  const render = /* usa el mismo builder de render que ya usan otras pruebas del archivo */
    makeRender({ id: 1, floorId: 'f1', sourceVariant: 'original', isChosen: false })
  renderComponent({ renders: [render], onChoose, onUnchoose: vi.fn() })
  await userEvent.click(screen.getByRole('button', { name: '☆' }))
  expect(onChoose).toHaveBeenCalledWith(1)
})

it('la estrella llena llama a onUnchoose', async () => {
  const onUnchoose = vi.fn().mockResolvedValue(undefined)
  const render = makeRender({ id: 1, floorId: 'f1', sourceVariant: 'original', isChosen: true })
  renderComponent({ renders: [render], onChoose: vi.fn(), onUnchoose })
  await userEvent.click(screen.getByRole('button', { name: '★' }))
  expect(onUnchoose).toHaveBeenCalledWith(1)
})

it('un render sin piso ni foto no muestra estrella', () => {
  const render = makeRender({ id: 1, floorId: null, sourceVariant: null, sourceImageId: null, isChosen: false })
  renderComponent({ renders: [render], onChoose: vi.fn(), onUnchoose: vi.fn() })
  expect(screen.queryByRole('button', { name: '☆' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '★' })).not.toBeInTheDocument()
})
```

Ajusta `makeRender`/`renderComponent` a los helpers que el archivo YA tiene —
no inventes un segundo patrón de fixtures. Si el archivo no tiene un helper así,
mira cómo las pruebas de `onDelete`/`onEdit` existentes montan el componente y
sigue exactamente ese molde.

**Step 2: Run to verify it fails**

```bash
cd app/web && npx vitest run src/components/detail/RendersPanel.test.tsx
```

**Step 3: Implement**

En `CommonProps` (interfaz, línea ~9), agrega:

```ts
interface CommonProps {
  prompts: RenderPrompt[]
  renders: PropertyRender[]
  base: string
  onEdit?: (renderId: number, promptText: string) => Promise<PropertyRender>
  onSavePrompt: (p: { name: string; body: string; kind: RenderPromptKind }) => Promise<RenderPrompt>
  onDeleteRender: (renderId: number) => Promise<void>
  /** La estrella: marca este render como EL elegido de su grupo (piso+variante, o
   * foto). El servidor apaga cualquier otro del mismo grupo — este callback solo
   * dispara la llamada, RendersPanel actualiza el estado local de todas las
   * cabezas de ese grupo cuando la promesa resuelve. */
  onChoose: (renderId: number) => Promise<void>
  onUnchoose: (renderId: number) => Promise<void>
}
```

En `RenderCards` (línea 535), pasa los callbacks a cada `RenderCard`:

```tsx
function RenderCards({ heads, renderById, photosById, base, onDeleteRender, onReuse, onEdit, onChoose, onUnchoose }: {
  heads: PropertyRender[]
  renderById: Map<number, PropertyRender>
  photosById: Map<number, PropertyImage>
  base: string
  onDeleteRender: (renderId: number) => Promise<void>
  onReuse: (r: PropertyRender) => void
  onEdit?: (renderId: number, promptText: string) => Promise<PropertyRender>
  onChoose: (renderId: number) => Promise<void>
  onUnchoose: (renderId: number) => Promise<void>
}) {
  const ancestry = ancestryIn(renderById)
  return (
    <>
      {heads.map(h => (
        <RenderCard key={h.id} render={h}
                    parent={h.parentRenderId != null ? renderById.get(h.parentRenderId) ?? null : null}
                    source={photosById.get(h.sourceImageId ?? -1) ?? null}
                    history={ancestry(h)}
                    base={base} onDelete={() => onDeleteRender(h.id)}
                    onReuse={() => onReuse(h)}
                    onEdit={onEdit ? (promptText: string) => onEdit(h.id, promptText).then(() => {}) : undefined}
                    onChoose={() => onChoose(h.id)}
                    onUnchoose={() => onUnchoose(h.id)} />
      ))}
    </>
  )
}
```

Actualiza todos los llamadores de `<RenderCards .../>` dentro de este archivo
(busca `<RenderCards` — hay más de uno, para las cabezas y para `unassigned`) y
pásales `onChoose={onChoose} onUnchoose={onUnchoose}` igual que ya les pasas
`onDeleteRender`/`onEdit`.

En `RenderCard` (línea 569), agrega los props y el botón:

```tsx
function RenderCard({ render, source, parent, history, base, onDelete, onReuse, onEdit, onChoose, onUnchoose }: {
  render: PropertyRender
  source: PropertyImage | null
  parent: PropertyRender | null
  history: PropertyRender[]
  base: string
  onDelete: () => void
  onReuse: () => void
  onEdit?: (promptText: string) => Promise<void>
  onChoose: () => Promise<void>
  onUnchoose: () => Promise<void>
}) {
```

Y en el figcaption, dentro del `<span style={{ marginLeft: 'auto', ... }}>`,
antes de "Trabajar sobre este":

```tsx
          <span style={{ marginLeft: 'auto', display: 'flex', gap: spacing.sm }}>
            {/* Solo tiene sentido elegir un render que PERTENECE a un piso o a una
                foto — uno huérfano (su piso o su foto se borraron) no tiene grupo
                dentro del cual "ser el elegido" signifique algo. */}
            {(render.floorId != null || render.sourceImageId != null) && (
              <button onClick={() => render.isChosen ? onUnchoose() : onChoose()} style={linkBtn}
                      aria-label={render.isChosen ? '★' : '☆'}>
                {render.isChosen ? '★' : '☆'}
              </button>
            )}
            {onEdit && (
              <button onClick={() => setEditing(v => !v)} style={linkBtn}>Trabajar sobre este</button>
            )}
            <button onClick={onReuse} style={linkBtn}>Reusar prompt</button>
            <button onClick={onDelete} style={linkBtn}>Borrar</button>
          </span>
```

**Step 4: Run to verify it passes**

```bash
npx vitest run src/components/detail/RendersPanel.test.tsx
```

**Step 5: Corre toda la suite de floorplan/detail para confirmar que no rompiste nada**

```bash
npx vitest run src/components/detail/
```

**Step 6: Commit**

```bash
git add app/web/src/components/detail/RendersPanel.tsx app/web/src/components/detail/RendersPanel.test.tsx
git commit -m "feat(renders): la estrella en la tarjeta — elegir o quitar el render de su grupo"
```

---

## Task 6: `PropertyDetailPage.tsx` — conectar la estrella al estado

**Files:**
- Modify: `app/web/src/components/PropertyDetailPage.tsx`

**Step 1: Agrega los dos handlers**, junto a `onDeleteRenderItem` (línea ~277):

```tsx
  async function onChooseRender(renderId: number): Promise<void> {
    const chosen = await choosePropertyRender(propertyId, renderId)
    // El servidor ya apagó los demás del grupo en la base de datos; esto solo
    // evita esperar el próximo fetch para verlo reflejado en pantalla.
    setRenders(prev => prev.map(r => {
      if (r.id === chosen.id) return chosen
      const sameFloorGroup = chosen.floorId != null
        && r.floorId === chosen.floorId && r.sourceVariant === chosen.sourceVariant
      const samePhotoGroup = chosen.sourceImageId != null && r.sourceImageId === chosen.sourceImageId
      return (sameFloorGroup || samePhotoGroup) ? { ...r, isChosen: false } : r
    }))
  }
  async function onUnchooseRender(renderId: number): Promise<void> {
    const updated = await unchoosePropertyRender(propertyId, renderId)
    setRenders(prev => prev.map(r => r.id === updated.id ? updated : r))
  }
```

Agrega `choosePropertyRender, unchoosePropertyRender` al import de `../lib/api`
que ya trae `editPropertyRender`, `deletePropertyRender`, etc.

**Step 2: Pásalos a las tres monturas** — busca las tres apariciones de
`onDeleteRender={onDeleteRenderItem}` (una dentro de `FotosPanel`, línea ~1038;
dos dentro de los `LevantamientoPanel`, líneas ~1064 y ~1085) y agrega justo
después de cada una:

```tsx
                  onChoose={onChooseRender}
                  onUnchoose={onUnchooseRender}
```

**Step 3: `FotosPanel.tsx` y `LevantamientoPanel.tsx` tienen que reenviar estos
props hasta `RendersPanel`** — ver Tareas 7 y 8, que agregan el selector Y el
reenvío al mismo tiempo (no hay paso intermedio útil sin el selector).

**Step 4: Typecheck** (va a fallar hasta terminar las Tareas 7-8; es esperado)

```bash
cd app/web && npx tsc --noEmit
```

**Step 5: Commit** — junto con la Tarea 7, ver ahí.

---

## Task 7: `LevantamientoPanel.tsx` — reenviar la estrella

**Files:**
- Modify: `app/web/src/components/LevantamientoPanel.tsx`

Como `LevantamientoPanel` ya monta `RendersPanel` con `source="plan"` y ya
gestiona `selectedFloorId`, esta tarea es solo enchufar los dos props nuevos —
NO hace falta selector nuevo aquí, el de piso ya existe.

**Step 1: Agrega `onChoose`/`onUnchoose` a la interfaz `Props`** de
`LevantamientoPanel` (busca `interface Props` cerca del inicio del archivo),
junto a `onDeleteRender`:

```ts
  onChoose: (renderId: number) => Promise<void>
  onUnchoose: (renderId: number) => Promise<void>
```

**Step 2: Desestructúralos** en la firma de la función del componente (donde ya
desestructura `onDeleteRender`) y pásalos al `<RendersPanel .../>` interno,
junto a `onDeleteRender={onDeleteRender}`:

```tsx
          onChoose={onChoose}
          onUnchoose={onUnchoose}
```

**Step 3: Typecheck**

```bash
cd app/web && npx tsc --noEmit
```
Esperado: los errores de `LevantamientoPanel` desaparecen; los de `FotosPanel`
(Tarea 8) siguen.

**Step 4: Corre las pruebas de este componente**

```bash
npx vitest run src/components/LevantamientoPanel.test.tsx src/components/LevantamientoPanel.interaction.test.tsx
```

**Step 5: Commit**

```bash
git add app/web/src/components/PropertyDetailPage.tsx app/web/src/components/LevantamientoPanel.tsx
git commit -m "feat(renders): la estrella llega a LevantamientoPanel, ya con su selector de piso"
```

---

## Task 8: `FotosPanel.tsx` — el mismo selector, por foto fuente

Esta es la única tarea que agrega UI nueva de verdad: hoy `FotosPanel` mezcla
los renders de TODAS las fotos en una sola lista. Necesita el mismo selector
que `LevantamientoPanel` ya tiene por piso (línea ~324-337 de ese archivo — es
el molde a seguir, mismo patrón visual).

**Files:**
- Modify: `app/web/src/components/detail/FotosPanel.tsx`
- Modify: `app/web/src/components/detail/RendersPanel.tsx` (`PhotosProps` gana `selectedImageId`)
- Test: `app/web/src/components/detail/FotosPanel.test.tsx`

**Step 1: Write the failing test**

```tsx
it('el selector de foto filtra los renders a la foto elegida', async () => {
  const images = [
    { id: 1, filePath: 'a.jpg', fileName: 'cocina.jpg', contentType: 'image/jpeg',
      sortOrder: 0, uploadedAt: '2026-01-01', imageType: 'general' },
    { id: 2, filePath: 'b.jpg', fileName: 'sala.jpg', contentType: 'image/jpeg',
      sortOrder: 1, uploadedAt: '2026-01-01', imageType: 'general' },
  ]
  const renders = [
    makeRender({ id: 10, sourceImageId: 1, floorId: null, sourceVariant: null }),
    makeRender({ id: 20, sourceImageId: 2, floorId: null, sourceVariant: null }),
  ]
  render(<FotosPanel images={images} renders={renders} {/* ...resto de props requeridos, mismo
    patrón que las pruebas existentes de este archivo */} />)
  await userEvent.click(screen.getByText('RENDERS'))
  // sin elegir foto: no debería verse ningún render todavía, o debería verse la
  // primera por default — ajusta el assert exacto a lo que Step 3 implemente.
})
```

Antes de escribir la aserción final, revisa qué pruebas YA existen en
`FotosPanel.test.tsx` para copiar exactamente cómo montan el componente
(imports, providers, props obligatorios) — no inventes un segundo patrón.

**Step 2: Run to verify it fails**

```bash
cd app/web && npx vitest run src/components/detail/FotosPanel.test.tsx
```

**Step 3: Implement**

En `RendersPanel.tsx`, `PhotosProps` (línea ~22) gana un campo:

```ts
interface PhotosProps extends CommonProps {
  source: 'photos'
  images: PropertyImage[]
  /** La foto SELECCIONADA — el selector vive en `FotosPanel` (dueño de la lista
   * de fotos), no aquí, mismo reparto de responsabilidad que `floorId` en
   * `PlanProps`. `null` mientras no haya ninguna foto que seleccionar. */
  selectedImageId: number | null
  onGenerate: (req: { sourceImageId: number; promptId: number | null; promptText: string })
    => Promise<PropertyRender>
  plan?: never
  variant?: never
  floorId?: never
  floorName?: never
  floorCount?: never
  onGeneratePlan?: never
}
```

Y el `scoped` (línea ~185) filtra también por foto en modo `photos`:

```tsx
  const scoped = useMemo(() => {
    const byVariant = renders.filter(r => (source === 'photos' ? r.sourceVariant == null : r.sourceVariant === variant))
    if (source === 'photos') return byVariant.filter(r => r.sourceImageId === selectedImageId)
    return byVariant.filter(r => r.floorId === selectedFloorId || (r.floorId === null && floorCount <= 1))
  }, [renders, source, variant, selectedFloorId, floorCount, selectedImageId])
```

(`selectedImageId` solo existe en `PhotosProps` — TypeScript ya lo sabe por la
unión discriminada `source`; añade `selectedImageId` a la desestructuración de
props del componente principal donde ya desestructura `images`/`plan`/etc.)

En `FotosPanel.tsx`, agrega el estado y el selector — mismo patrón visual que
`LevantamientoPanel.tsx:324-337`:

```tsx
export function FotosPanel({
  images, base, onUpload, onDelete, onChangeType, onReorder,
  prompts, renders, onGenerate, onEdit, onSavePrompt, onDeleteRender, onChoose, onUnchoose,
}: Props) {
  const [tab, setTab] = useState<SubTab>('galeria')
  const [selectedImageId, setSelectedImageId] = useState<number | null>(null)
```

Y donde monta `<RendersPanel source="photos" .../>`, envuélvelo con el selector
y pásale `selectedImageId`, `onChoose`, `onUnchoose`:

```tsx
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {images.length > 0 && (
            <div style={{ flexShrink: 0, display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap',
                          padding: '6px 16px', borderBottom: `1px solid ${colors.border}` }}>
              <span style={label}>FOTO</span>
              {images.map(img => (
                <button key={img.id} onClick={() => setSelectedImageId(img.id)}
                  style={{ ...floorBtn(img.id === (selectedImageId ?? images[0]?.id)),
                           textTransform: 'none', letterSpacing: '0.04em',
                           fontFamily: fonts.sans, fontSize: '11px' }}>
                  {img.fileName}
                </button>
              ))}
            </div>
          )}
          <RendersPanel source="photos" images={images} prompts={prompts} renders={renders} base={base}
            selectedImageId={selectedImageId ?? images[0]?.id ?? null}
            onGenerate={onGenerate} onEdit={onEdit} onSavePrompt={onSavePrompt} onDeleteRender={onDeleteRender}
            onChoose={onChoose} onUnchoose={onUnchoose} />
        </div>
      )}
```

`floorBtn`/`label` no existen en este archivo todavía — impórtalos o
recréalos con el mismo estilo que usa `LevantamientoPanel.tsx` (busca su
definición ahí, cerca de donde declara `floorBtn`, y replica el mismo objeto de
estilos aquí; no inventes uno distinto).

Actualiza `Props` de `FotosPanel` (la interfaz al inicio del archivo) para
agregar `onChoose`/`onUnchoose`, igual que ya tiene `onDeleteRender`.

**Step 4: Wire it from `PropertyDetailPage.tsx`** (retoma la Tarea 6, Step 3):
en la montura de `<FotosPanel .../>`, agrega `onChoose={onChooseRender}
onUnchoose={onUnchooseRender}` junto a `onDeleteRender={onDeleteRenderItem}`.

**Step 5: Run to verify it passes**

```bash
npx vitest run src/components/detail/FotosPanel.test.tsx src/components/detail/RendersPanel.test.tsx
npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add app/web/src/components/detail/FotosPanel.tsx app/web/src/components/detail/RendersPanel.tsx \
        app/web/src/components/PropertyDetailPage.tsx
git commit -m "feat(renders): selector de foto fuente en FOTOS — mismo patrón que el de piso"
```

---

## Task 9: Suite completa + verificación visual contra datos reales

**Step 1: Todo el backend**

```bash
cd /home/eduardo/Documents/repos/new-repos/patrio/.worktrees/plano-en-prospecto
PYTHONPATH=".:app" .venv/bin/pytest app/api/tests/ -q
```

**Step 2: Todo el frontend, con Node 20** (el de CI — el v25 local trae
`localStorage` nativo y da falsos rojos en `TabBar.test.tsx`, ajeno a esto)

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd app/web && npm test
```

**Step 3: Contra el stack vivo de este worktree** (`:8012`/`:5176`, ya con BD
clonada y usuario `delagarzaguerra@gmail.com`):

- [ ] Entra a la propiedad 5 o 10, pestaña PLANO → RENDERS: marca la estrella en
      un render. Confirma que cualquier otro `★` del mismo piso+variante se
      apaga en pantalla al instante, sin recargar.
- [ ] Entra a FOTOS → RENDERS: confirma que aparece el selector de foto fuente,
      y que la estrella ahí también se comporta igual.
- [ ] Descarga el prospecto (`📄 PROSPECTO` sobre esa propiedad marcada como
      favorita). Confirma:
  - [ ] Cada piso imprime SU plano, y a lo más 1 render junto a él.
  - [ ] Un piso sin estrella marcada imprime el plano solo, sin hueco vacío raro.
  - [ ] Si marcaste una foto, aparece "Fotos y propuesta" con esa foto + su
        render — y ninguna otra imagen de render sin marcar aparece en ningún
        lado del documento.
  - [ ] Ya no existe en ningún lado el encabezado "Renders · propuesta de
        diseño" viejo.

**Step 4: Anota resultados reales** (no "debería funcionar") en un mensaje de
cierre antes de considerar la tarea terminada.
