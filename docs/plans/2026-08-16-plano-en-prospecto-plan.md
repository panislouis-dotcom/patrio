# El plano en el prospecto — plan de implementación

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Que el prospecto imprima el plano medido (m², largos de muro, cotas, batientes) junto al render que lo aproxima, emparejado por piso y en Antes/Después cuando existen las dos variantes.

**Architecture:** Python deja de interpretar `properties.geometry`. Se empaqueta `floorToSvg` —el mismo que ya usa el botón `↓ SVG`— y se evalúa en el Chromium que el PDF ya lanza; Python solo pasa el blob y recibe SVG terminados. Se borra `_floorplan_svg`, el cuarto dibujo del mismo modelo.

**Tech Stack:** TypeScript + Vite (lib mode, IIFE) · Python 3.12 + FastAPI · Playwright/Chromium · pytest · vitest

**Diseño:** `docs/plans/2026-08-16-plano-en-prospecto-design.md` — léelo antes de empezar. La sección «Evidencia local» explica por qué la página anfitriona es `file://` y por qué existe `scale`; las dos cosas parecen arbitrarias sin ella.

**Rama:** se trabaja en la rama actual (`fix/render-fidelidad-sin-compositing`), sin worktree nuevo.

---

## Task 1: `ExportOpts.scale` — escala compartida, opt-in

**Files:**
- Modify: `app/web/src/lib/floorplan/exportSvg.ts:25-36`
- Test: `app/web/src/lib/floorplan/exportSvg.test.ts`

**Step 1: Write the failing tests**

Agrega al final de `exportSvg.test.ts`. `rect()` es un helper local nuevo — decláralo arriba del bloque:

```ts
function rect(w: number, h: number, name = 'Recámara'): FloorGraph {
  const pts = [[0, 0], [w, 0], [w, h], [0, h]]
  const vertices = Object.fromEntries(pts.map(([x, y], i) => [`v${i}`, { id: `v${i}`, x, y }]))
  const edges = Object.fromEntries(pts.map((_, i) => [`e${i}`, {
    id: `e${i}`, v1: `v${i}`, v2: `v${(i + 1) % 4}`, thickness: 0.15, openings: [],
  }]))
  return {
    id: 'f1', name: 'Planta Baja', height_m: 2.6, extWall_m: 0.15, intWall_m: 0.10,
    vertices, edges, rooms: [{ name, cx: w / 2, cy: h / 2 }], fixtures: [], manualDimensions: [],
  }
}
const xsOf = (svg: string) => [...svg.matchAll(/\sx[12]?="([-\d.]+)"/g)].map(m => parseFloat(m[1]))
const ysOf = (svg: string) => [...svg.matchAll(/\sy[12]?="([-\d.]+)"/g)].map(m => parseFloat(m[1]))
const box = (svg: string) => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!.slice(1).map(Number)
const wallPx = (svg: string) => parseFloat(svg.match(/<line[^>]*stroke-width="([\d.]+)"/)![1])

describe('floorToSvg con scale compartida', () => {
  it('dibuja dos pisos de distinto tamaño en proporción real y con el mismo grosor de muro', () => {
    // Este es el caso Antes/Después: el mismo piso, ensanchado de 4.2 a 5.0 m.
    const antes = floorToSvg(rect(4.2, 3.1), { scale: 160 })
    const despues = floorToSvg(rect(5.0, 3.1), { scale: 160 })
    const [wa] = box(antes), [wd] = box(despues)
    // 5.0 / 4.2 = 1.190…; los lienzos difieren solo por el ancho real del piso.
    expect((wd - 192) / (wa - 192)).toBeCloseTo(5.0 / 4.2, 2)
    expect(wallPx(despues)).toBeCloseTo(wallPx(antes), 5)
  })

  it('mantiene el alto igual cuando solo cambia el ancho', () => {
    const [, ha] = box(floorToSvg(rect(4.2, 3.1), { scale: 160 }))
    const [, hd] = box(floorToSvg(rect(5.0, 3.1), { scale: 160 }))
    expect(hd).toBe(ha)
  })

  it('no deja ninguna cota fuera del lienzo', () => {
    // Las cadenas de cota se dibujan hasta px(x1)+64 y py(y0)+54, FUERA del bbox del
    // contenido. Con el margen de 64 quedarían cortadas contra el borde derecho.
    const svg = floorToSvg(rect(4.2, 3.1), { scale: 160 })
    const [w, h] = box(svg)
    expect(Math.max(...xsOf(svg))).toBeLessThanOrEqual(w - 24)
    expect(Math.max(...ysOf(svg))).toBeLessThanOrEqual(h - 4)
    expect(Math.min(...xsOf(svg))).toBeGreaterThanOrEqual(0)
    expect(Math.min(...ysOf(svg))).toBeGreaterThanOrEqual(0)
  })

  it('sin scale la salida es idéntica a la de siempre — ↓ SVG no cambia', () => {
    const f = rect(4.2, 3.1)
    expect(floorToSvg(f)).toBe(floorToSvg(f, { width: 1200, height: 900, margin: 64 }))
    expect(box(floorToSvg(f))).toEqual([1200, 900])
  })
})
```

**Step 2: Run tests to verify they fail**

```
cd app/web && npx vitest run src/lib/floorplan/exportSvg.test.ts
```
Esperado: FAIL — los tres primeros porque `scale` no existe en `ExportOpts` (TS) y el lienzo sigue en 1200×900. El cuarto ya pasa: es la prueba de regresión.

**Step 3: Implementation**

En `exportSvg.ts:25`:

```ts
export interface ExportOpts { width?: number; height?: number; margin?: number; scale?: number }
```

Reemplaza `exportSvg.ts:29-35` (de `const width = …` hasta la línea de `const scale = …`) por:

```ts
  // `scale` (px por metro) invierte la relación: el LIENZO se dimensiona desde la escala,
  // en vez de la escala desde el lienzo. Es lo que hace comparables a dos variantes del
  // mismo piso — un antes de 4.2 m y un después de 5.0 m ajustados cada uno a su propia
  // caja se dibujan casi del mismo ancho (1085.9 vs 1112.0 px medidos) y el muro hasta
  // adelgaza (37.4 → 32.2 px): un Antes/Después así afirma que no cambió nada.
  // El margen sube a 96 con `scale`: las cadenas de cota llegan hasta px(x1)+64 más el
  // medio ancho de su texto, y con 64 quedarían cortadas contra el borde del lienzo.
  // Sin `scale` no cambia absolutamente nada — `↓ SVG` y `↓ PDF` del editor son byte
  // por byte lo que eran.
  const margin = opts.margin ?? (opts.scale != null ? 96 : 64)
  const verts = Object.values(floor.vertices)
  const xs = verts.map(v => v.x), ys = verts.map(v => v.y)
  const minx = Math.min(...xs, 0), maxx = Math.max(...xs, 1)
  const miny = Math.min(...ys, 0), maxy = Math.max(...ys, 1)
  const spanx = maxx - minx || 1, spany = maxy - miny || 1
  const fitW = opts.width ?? 1200, fitH = opts.height ?? 900
  const scale = opts.scale ?? Math.min((fitW - 2 * margin) / spanx, (fitH - 2 * margin) / spany)
  const width = opts.scale == null ? fitW : Math.round(spanx * scale + 2 * margin)
  const height = opts.scale == null ? fitH : Math.round(spany * scale + 2 * margin)
```

**Step 4: Run tests to verify they pass**

```
cd app/web && npx vitest run src/lib/floorplan/exportSvg.test.ts
```
Esperado: PASS, todo el archivo (las pruebas viejas incluidas).

**Step 5: Commit**

```bash
git add app/web/src/lib/floorplan/exportSvg.ts app/web/src/lib/floorplan/exportSvg.test.ts
git commit -m "feat(plano): floorToSvg acepta una escala compartida, opt-in"
```

---

## Task 2: `planSheets` — el blob entero a hojas dibujadas

**Files:**
- Create: `app/web/src/lib/floorplan/planSheets.ts`
- Test: `app/web/src/lib/floorplan/planSheets.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { planSheets } from './planSheets'
// reusa el helper rect() de Task 1 — cópialo aquí, o extráelo a un testHelpers.ts si
// prefieres; no lo importes desde exportSvg.test.ts.

const floor = (w: number, h: number, id: string) => ({ ...rect(w, h), id })
const blank = (id: string) => ({ ...rect(1, 1), id, vertices: {}, edges: {}, rooms: [] })
const v2 = (f: any) => ({ schemaVersion: 2, slab_m: 0.15, activeFloor: 0, floors: [f] })
const v3 = (o: any[], p: any[] | null) => ({
  schemaVersion: 3,
  variants: {
    original: { slab_m: 0.15, activeFloor: 0, floors: o },
    planned: p === null ? null : { slab_m: 0.15, activeFloor: 0, floors: p },
  },
})

describe('planSheets', () => {
  it('un blob v2 da una hoja original', () => {
    const s = planSheets(v2(floor(4.2, 3.1, 'f1')))
    expect(s).toHaveLength(1)
    expect(s[0].variant).toBe('original')
    expect(s[0].svg).toContain('m²')
  })

  it('un blob v2 SIN ids de piso no revienta y produce hoja', () => {
    // migrateGeometry rellena el id con crypto.randomUUID(). Ese id efímero jamás
    // empatará con el floor_id de un render — y así debe ser.
    const { id, ...noId } = floor(4.2, 3.1, 'f1') as any
    const s = planSheets(v2(noId))
    expect(s).toHaveLength(1)
    expect(s[0].floorId).toBeTruthy()
  })

  it('v3 con las dos variantes da dos hojas con el MISMO floorId', () => {
    const s = planSheets(v3([floor(4.2, 3.1, 'abc')], [floor(5.0, 3.1, 'abc')]))
    expect(s.map(x => x.variant)).toEqual(['original', 'planned'])
    expect(s[0].floorId).toBe('abc')
    expect(s[1].floorId).toBe('abc')
  })

  it('las dos variantes de un linaje comparten escala', () => {
    const s = planSheets(v3([floor(4.2, 3.1, 'abc')], [floor(5.0, 3.1, 'abc')]))
    const wall = (svg: string) => parseFloat(svg.match(/<line[^>]*stroke-width="([\d.]+)"/)![1])
    expect(wall(s[1].svg)).toBeCloseTo(wall(s[0].svg), 5)
  })

  it('omite un piso planeado en blanco — un lienzo vacío no es propuesta', () => {
    const s = planSheets(v3([floor(4.2, 3.1, 'abc')], [blank('nuevo')]))
    expect(s).toHaveLength(1)
    expect(s[0].variant).toBe('original')
  })

  it('un planeado clonado sin editar produce el MISMO svg', () => {
    const s = planSheets(v3([floor(4.2, 3.1, 'abc')], [floor(4.2, 3.1, 'abc')]))
    expect(s[1].svg).toBe(s[0].svg)
  })

  it('basura, v1 y vacío dan []', () => {
    expect(planSheets({ schemaVersion: 1 })).toEqual([])
    expect(planSheets({})).toEqual([])
    expect(planSheets(null)).toEqual([])
    expect(planSheets('nope')).toEqual([])
  })
})
```

**Step 2: Run to verify it fails**

```
cd app/web && npx vitest run src/lib/floorplan/planSheets.test.ts
```
Esperado: FAIL — `Cannot find module './planSheets'`.

**Step 3: Implementation**

Crea `app/web/src/lib/floorplan/planSheets.ts`:

```ts
import { migrateGeometry, type FloorGraph, type VariantKey } from './types'
import { floorToSvg } from './exportSvg'

/** Una hoja dibujada: un piso de una variante, ya en SVG. */
export interface PlanSheet { variant: VariantKey; floorId: string; floorName: string; svg: string }

// Lado largo objetivo de una hoja, en px. El SVG se escala a %100 en el PDF, así que este
// número solo fija la resolución del dibujo y la proporción entre las dos variantes.
const SHEET_MAX_PX = 900

const drawn = (f: FloorGraph) => Object.keys(f.vertices).length > 0

function span(f: FloorGraph): number {
  const vs = Object.values(f.vertices)
  const xs = vs.map(v => v.x), ys = vs.map(v => v.y)
  // El piso degenerado (un vértice) tiene extensión cero: el mínimo evita dividir entre cero.
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.01)
}

/**
 * El blob persistido de una propiedad → las hojas que el prospecto debe imprimir.
 *
 * Es la ÚNICA función que el bundle del servidor expone, y no tiene geometría propia:
 * compone `migrateGeometry` (que ya entiende v2 en la raíz, v3 en `variants`, y rechaza
 * lo malformado) con `floorToSvg` (que ya dibuja m², largos, cotas y batientes). Por eso
 * el plano del PDF y el del botón `↓ SVG` no pueden divergir: son la misma función.
 *
 * Un piso sin vértices se omite — "EMPEZAR EN BLANCO" persiste un planeado con una planta
 * vacía, y ese lienzo no es propuesta todavía (misma regla que el viejo `_pick_floors`).
 *
 * La escala se fija por LINAJE, no por hoja: las dos variantes de un mismo piso comparten
 * `floorId` (`LevantamientoPanel.tsx:231`) y tienen que leerse comparables, o el
 * Antes/Después miente sobre cuánto cambió.
 */
export function planSheets(raw: unknown): PlanSheet[] {
  const model = migrateGeometry(raw)
  if (!model) return []

  const pairs: [VariantKey, FloorGraph][] = []
  for (const f of model.variants.original?.floors ?? []) if (drawn(f)) pairs.push(['original', f])
  for (const f of model.variants.planned?.floors ?? []) if (drawn(f)) pairs.push(['planned', f])

  const lineage = new Map<string, number>()
  for (const [, f] of pairs) lineage.set(f.id, Math.max(lineage.get(f.id) ?? 0, span(f)))

  return pairs.map(([variant, f]) => ({
    variant, floorId: f.id, floorName: f.name,
    svg: floorToSvg(f, { scale: SHEET_MAX_PX / lineage.get(f.id)! }),
  }))
}
```

**Step 4: Run to verify it passes**

```
cd app/web && npx vitest run src/lib/floorplan/planSheets.test.ts
```
Esperado: PASS, 7 pruebas.

**Step 5: Commit**

```bash
git add app/web/src/lib/floorplan/planSheets.ts app/web/src/lib/floorplan/planSheets.test.ts
git commit -m "feat(plano): planSheets convierte el blob persistido en hojas dibujadas"
```

---

## Task 3: empaquetar el bundle y meterlo a la imagen

**Files:**
- Create: `app/web/vite.plano.config.ts`
- Create: `app/api/assets/.gitkeep`
- Modify: `app/web/package.json` (scripts)
- Modify: `makefile`
- Modify: `Dockerfile:6` y después de `COPY app/api/ ./api/`
- Modify: `.gitignore`

**Step 1: Config de Vite en modo librería**

`app/web/vite.plano.config.ts`:

```ts
import { defineConfig } from 'vite'
import { resolve } from 'path'

// Bundle de UN solo propósito: darle al API el mismo `floorToSvg` que usa el editor,
// para que el prospecto no tenga una segunda implementación del plano. IIFE porque el
// Chromium de Playwright lo carga con add_script_tag, sin módulos ni red.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/lib/floorplan/planSheets.ts'),
      name: 'Plano',
      formats: ['iife'],
      fileName: () => 'plano.iife.js',
    },
    outDir: 'dist-plano',
    emptyOutDir: true,
    target: 'es2020',
  },
})
```

**Step 2: script en `package.json`**

Agrega junto a `"build"`:
```json
"build:plano": "vite build --config vite.plano.config.ts",
```

**Step 3: target en el `makefile`**

```makefile
build-plano: ## Empaquetar floorToSvg para que el API dibuje planos en el prospecto
	cd app/web && npm run build:plano
	mkdir -p app/api/assets && cp app/web/dist-plano/plano.iife.js app/api/assets/plano.iife.js
```

**Step 4: `.gitignore`**

```
app/web/dist-plano/
app/api/assets/plano.iife.js
```

Y `touch app/api/assets/.gitkeep` para que el directorio exista en el repo.

**Step 5: `Dockerfile`**

En la etapa 1, después de `RUN VITE_API_BASE="" npm run build`:
```dockerfile
RUN npm run build:plano
```

Después de `COPY app/api/ ./api/` (tiene que ir DESPUÉS o el COPY del código lo pisa):
```dockerfile
# El mismo floorToSvg que dibuja el editor, para que el prospecto no tenga un segundo
# plano que mantener sincronizado. Lo evalúa api/lib/plano_js.py en este mismo Chromium.
COPY --from=frontend-build /build/dist-plano/plano.iife.js ./api/assets/plano.iife.js
```

**Step 6: Verify**

```bash
make build-plano
head -c 120 app/api/assets/plano.iife.js; echo
grep -c "planSheets" app/api/assets/plano.iife.js
```
Esperado: el archivo existe, empieza con `var Plano=(function(`  (o similar IIFE), y `planSheets` aparece.

**Step 7: Commit**

```bash
git add app/web/vite.plano.config.ts app/web/package.json makefile Dockerfile .gitignore app/api/assets/.gitkeep
git commit -m "build(plano): empaquetar floorToSvg como bundle IIFE para el API"
```

---

## Task 4: `render_plan_sheets` — evaluarlo en Chromium

**Files:**
- Create: `app/api/lib/plano_js.py`
- Test: `app/api/tests/test_plano_js.py`

**Step 1: Write the failing tests**

Esta es la prueba que importa más de todo el plan: es la única que NO mockea, y por lo tanto la única que puede cazar un bundle roto antes de producción.

```python
import pytest
from api.lib import plano_js


def _rect(w, h, fid=None):
    pts = [(0, 0), (w, 0), (w, h), (0, h)]
    V = {f"v{i}": {"id": f"v{i}", "x": x, "y": y} for i, (x, y) in enumerate(pts)}
    ids = list(V)
    E = {f"e{i}": {"id": f"e{i}", "v1": ids[i], "v2": ids[(i + 1) % 4],
                   "thickness": 0.15, "openings": []} for i in range(4)}
    f = {"name": "Planta Baja", "height_m": 2.6, "extWall_m": 0.15, "intWall_m": 0.10,
         "vertices": V, "edges": E, "rooms": [{"name": "Recámara", "cx": w / 2, "cy": h / 2}],
         "fixtures": [], "manualDimensions": []}
    if fid is not None:
        f["id"] = fid
    return f


V2_SIN_IDS = {"schemaVersion": 2, "slab_m": 0.15, "activeFloor": 0, "floors": [_rect(4.2, 3.1)]}
V3 = {"schemaVersion": 3, "variants": {
    "original": {"slab_m": 0.15, "activeFloor": 0, "floors": [_rect(4.2, 3.1, "abc")]},
    "planned": {"slab_m": 0.15, "activeFloor": 0, "floors": [_rect(5.0, 3.1, "abc")]}}}

pytestmark = pytest.mark.skipif(not plano_js._BUNDLE.exists(),
                                reason="corre `make build-plano` primero")


@pytest.mark.asyncio
async def test_dibuja_un_blob_v2_sin_ids_de_piso():
    """El caso que revienta si la página anfitriona no es un contexto seguro:
    migrateGeometry rellena ids con crypto.randomUUID(), que no existe en
    about:blank ni con set_content. Medido — ver el diseño, evidencia 1."""
    out = await plano_js.render_plan_sheets({7: V2_SIN_IDS})
    assert len(out[7]) == 1
    assert out[7][0]["variant"] == "original"
    assert out[7][0]["floorId"]
    assert "m²" in out[7][0]["svg"]


@pytest.mark.asyncio
async def test_las_dos_variantes_comparten_floor_id_y_escala():
    out = await plano_js.render_plan_sheets({7: V3})
    sheets = out[7]
    assert [s["variant"] for s in sheets] == ["original", "planned"]
    assert sheets[0]["floorId"] == sheets[1]["floorId"] == "abc"
    import re
    grosor = lambda s: float(re.search(r'<line[^>]*stroke-width="([\d.]+)"', s).group(1))
    assert grosor(sheets[1]["svg"]) == pytest.approx(grosor(sheets[0]["svg"]))


@pytest.mark.asyncio
async def test_varias_propiedades_en_un_solo_chromium():
    out = await plano_js.render_plan_sheets({7: V2_SIN_IDS, 9: V3, 11: {}})
    assert len(out[7]) == 1 and len(out[9]) == 2 and out[11] == []


@pytest.mark.asyncio
async def test_sin_geometrias_no_lanza_navegador():
    assert await plano_js.render_plan_sheets({}) == {}


@pytest.mark.asyncio
async def test_bundle_ausente_degrada_a_vacio_y_avisa(monkeypatch, caplog):
    """Un PDF no se muere porque un plano no dibujó — misma degradación que un
    fetch de imagen fallido en documents.py:44."""
    monkeypatch.setattr(plano_js, "_BUNDLE", plano_js._BUNDLE.with_name("no-existe.js"))
    with caplog.at_level("WARNING"):
        assert await plano_js.render_plan_sheets({7: V2_SIN_IDS}) == {}
    assert "make build-plano" in caplog.text
```

**Step 2: Run to verify it fails**

```
cd app/api && ../../.venv/bin/pytest tests/test_plano_js.py -v
```
Esperado: FAIL — `ModuleNotFoundError: api.lib.plano_js`. Si en cambio salen todas SKIPPED, corre `make build-plano` primero — el skip es real y correcto, pero no te está probando nada.

**Step 3: Implementation**

Crea `app/api/lib/plano_js.py`:

```python
"""Los planos del prospecto, dibujados por el MISMO `floorToSvg` que usa el editor.

Python no interpreta `properties.geometry`: lo pasa entero al bundle y recibe SVG
terminados. Es lo que evita un cuarto dibujo del mismo modelo en un cuarto lenguaje —
ver docs/plans/2026-08-16-plano-en-prospecto-design.md.
"""
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

_BUNDLE = Path(__file__).resolve().parent.parent / "assets" / "plano.iife.js"
_EVAL_TIMEOUT_MS = 30_000


async def render_plan_sheets(geometries: dict[int, dict]) -> dict[int, list[dict]]:
    """`{property_id: geometry}` → `{property_id: [PlanSheet]}`.

    Un solo lanzamiento de Chromium para todo el prospecto, no uno por propiedad.

    La página anfitriona es un `file://` temporal y NO `set_content`/`about:blank`:
    `migrateGeometry` rellena los ids de piso faltantes con `crypto.randomUUID()`, que
    solo existe en contexto seguro. Medido contra Playwright real:

        about:blank / set_content -> isSecureContext False -> no es función
        file://                   -> isSecureContext True  -> funciona

    Con `set_content` esto reventaría para todo blob v2 y todo piso guardado antes de
    que `id` existiera —justo las propiedades viejas— y el `except` de abajo lo
    degradaría a "sin planos", en silencio. No lo cambies sin releer eso.

    Cualquier falla —bundle ausente, evaluación con excepción, Chromium caído— devuelve
    vacío y avisa al log. La sección desaparece del PDF, igual que un `_strip` vacío; un
    prospecto no se muere porque un plano no dibujó.
    """
    if not geometries:
        return {}
    if not _BUNDLE.exists():
        logger.warning(
            "bundle del plano ausente en %s — el prospecto saldrá SIN planos. "
            "Corre `make build-plano`.", _BUNDLE)
        return {}

    from playwright.async_api import async_playwright

    items = list(geometries.items())
    try:
        with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w",
                                         encoding="utf-8") as f:
            f.write("<!doctype html><html><body></body></html>")
            host = f.name
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(args=["--hide-scrollbars"])
                try:
                    page = await browser.new_page()
                    page.set_default_timeout(_EVAL_TIMEOUT_MS)
                    await page.goto(f"file://{host}", wait_until="load")
                    await page.add_script_tag(path=str(_BUNDLE))
                    drawn = await page.evaluate(
                        "blobs => blobs.map(b => Plano.planSheets(b))",
                        [g or {} for _, g in items])
                finally:
                    await browser.close()
        finally:
            os.unlink(host)
    except Exception:
        logger.warning("no se pudieron dibujar los planos del prospecto", exc_info=True)
        return {}

    return {pid: sheets for (pid, _), sheets in zip(items, drawn)}
```

**Step 4: Run to verify it passes**

```
make build-plano
cd app/api && ../../.venv/bin/pytest tests/test_plano_js.py -v
```
Esperado: PASS, 5 pruebas. Ninguna SKIPPED.

**Step 5: Commit**

```bash
git add app/api/lib/plano_js.py app/api/tests/test_plano_js.py
git commit -m "feat(prospecto): render_plan_sheets evalúa floorToSvg en el Chromium del PDF"
```

---

## Task 5: `_plan_rows` — el pareo, puro

**Files:**
- Modify: `app/api/lib/prospectus_html.py` (función nueva, junto a `_strip`)
- Test: `app/api/tests/test_prospectus_html.py`

**Step 1: Write the failing tests**

```python
from api.lib.prospectus_html import _plan_rows

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
    # los renders del planeado siguen siendo del MISMO dibujo: se quedan en la fila
    assert len(rows[0]["antes"]["renders"]) == 2
    assert left == []


def test_el_nombre_sale_de_la_hoja_no_del_render():
    rows, _ = _plan_rows([_sheet("abc", "original", name="Planta Alta")],
                         [_render("abc", "original", name="Nombre Viejo")])
    assert rows[0]["floorName"] == "Planta Alta"


def test_orden_original_primero_luego_los_pisos_solo_planeados():
    rows, _ = _plan_rows(
        [_sheet("a", "original"), _sheet("b", "original"), _sheet("z", "planned")], [])
    assert [r["floorName"] for r in rows] == ["Planta Baja"] * 3
    assert [r["antes"] is not None for r in rows] == [True, True, False]


def test_sin_hojas_todo_es_tira_suelta():
    rows, left = _plan_rows([], [_render("abc", "original")])
    assert rows == [] and len(left) == 1
```

**Step 2: Run to verify it fails**

```
cd app/api && ../../.venv/bin/pytest tests/test_prospectus_html.py -k plan_rows -v
```
Esperado: FAIL — `ImportError: cannot import name '_plan_rows'`.

**Step 3: Implementation**

Agrega a `prospectus_html.py`, justo después de `_strip`:

```python
def _plan_rows(sheets: list[dict], renders: list[dict]) -> tuple[list[dict], list[dict]]:
    """Las hojas dibujadas + las cabezas de render → filas por LINAJE de piso, más lo
    que no empató.

    Una fila es un piso a lo largo de sus variantes, no una hoja: un piso planeado
    nacido de PARTIR/RE-PARTIR comparte el `id` de su contraparte original
    (`LevantamientoPanel.tsx:231`), y ese id compartido es justo lo que permite
    alinear el antes con el después sin heurística.

    Por eso mismo un render empata por `(floorId, sourceVariant)`, LAS DOS, nunca solo
    la primera: el propio comentario de allá lo advirtió por escrito antes de que esta
    función existiera. Lo que no empata —render de foto, render anterior al 7-ago con
    columnas NULL (`042` se negó a inventarles piso), render cuyo piso ya se borró—
    vuelve como `leftovers` y alimenta la `_strip` de siempre. La salida de hoy es el
    piso de la salida nueva, nunca peor.

    El nombre del piso sale de la HOJA, no del render: `floorName` en el render está
    congelado para sobrevivir a un renombre, pero si el piso todavía existe manda el
    vivo. Un render cuyo piso se borró es leftover, y ahí su nombre congelado es la
    única etiqueta honesta que queda.
    """
    by_key = {(s["floorId"], s["variant"]): s for s in sheets}
    paired: dict[tuple, list] = {key: [] for key in by_key}
    leftovers = []
    for r in renders:
        if not r.get("dataUri"):
            continue
        key = (r.get("floorId"), r.get("sourceVariant"))
        (paired[key] if key in paired else leftovers).append(r)

    order, seen = [], set()
    for s in sheets:
        if s["floorId"] not in seen:
            seen.add(s["floorId"])
            order.append(s["floorId"])

    rows = []
    for fid in order:
        antes, despues = by_key.get((fid, "original")), by_key.get((fid, "planned"))
        # Un planeado clonado y aún no editado produce el MISMO string —mismo
        # serializador, misma entrada—. Imprimirlo bajo "Antes / Después" afirmaría una
        # transformación que nadie diseñó. La igualdad de strings compara exactamente lo
        # que el lector vería, sin diff geométrico. Sus renders son del mismo dibujo, así
        # que se quedan en la fila; no son sobrantes.
        if antes and despues and antes["svg"] == despues["svg"]:
            paired[(fid, "original")] += paired[(fid, "planned")]
            despues = None
        rows.append({
            "floorName": (antes or despues)["floorName"],
            "antes": {**antes, "renders": paired[(fid, "original")]} if antes else None,
            "despues": {**despues, "renders": paired[(fid, "planned")]} if despues else None,
        })
    return rows, leftovers
```

**Step 4: Run to verify it passes**

```
cd app/api && ../../.venv/bin/pytest tests/test_prospectus_html.py -v
```
Esperado: PASS, todas.

**Step 5: Commit**

```bash
git add app/api/lib/prospectus_html.py app/api/tests/test_prospectus_html.py
git commit -m "feat(prospecto): _plan_rows empareja plano y render por piso y variante"
```

---

## Task 6: imprimir las filas — HTML y CSS

**Files:**
- Modify: `app/api/lib/prospectus_html.py` (`_BODY_CSS` ~:287-319, `_opportunity_detail` :1009)
- Test: `app/api/tests/test_prospectus_html.py`

**Step 1: Write the failing tests**

```python
def test_el_detalle_imprime_el_plano_junto_a_su_render():
    p = {"planSheets": [_sheet("abc", "original", "<svg>PLANO</svg>")],
         "renderHeads": [_render("abc", "original")], "budget": {}}
    html = _opportunity_detail(p)
    assert "PLANO" in html and "plan-row" in html


def test_una_sola_variante_no_lleva_etiquetas_antes_despues():
    p = {"planSheets": [_sheet("abc", "original")],
         "renderHeads": [], "budget": {}}
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
```

**Step 2: Run to verify it fails**

```
cd app/api && ../../.venv/bin/pytest tests/test_prospectus_html.py -k "plano_junto\|antes_despues\|tira_de_siempre" -v
```
Esperado: FAIL.

**Step 3: Implementation**

CSS — reemplaza el bloque `.plano*` de `_BODY_CSS` (el que quedará huérfano en Task 8; puedes escribirlo aquí y borrar el viejo allá):

```css
.plan-row { margin: 0 0 7mm 0; break-inside: avoid; }
.plan-side { margin-bottom: 3mm; }
.plan-side-label { font-family: 'Inter', sans-serif; font-size: 7pt; letter-spacing: .12em;
                   text-transform: uppercase; color: #7A7A7A; margin-bottom: 1.5mm; }
.plan-pair { display: flex; gap: 4mm; align-items: flex-start; }
.plan-sheet { flex: 1 1 50%; min-width: 0; }
.plan-sheet svg { width: 100%; height: auto; max-height: 85mm; }
.plan-renders { flex: 1 1 50%; min-width: 0; display: flex; flex-direction: column; gap: 2mm; }
.plan-renders img { width: 100%; height: auto; max-height: 85mm; object-fit: contain; }
/* Una hoja sin render no debe estirarse a media página: sin pareja se queda a su ancho. */
.plan-pair > .plan-sheet:only-child { flex: 0 0 62%; }
```

Funciones nuevas, junto a `_plan_rows`:

```python
def _plan_side(side: dict | None, label: str, show_label: bool) -> str:
    """Un lado de una fila: la hoja y, a su derecha, los renders que le tocan.

    `show_label` solo es cierto cuando la fila trae las DOS variantes: un piso sin
    propuesta no necesita que le digan "Antes" de qué."""
    if side is None:
        return ""
    lab = (f'<div class="plan-side-label">{_esc(label)}</div>') if show_label else ""
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
```

En `_opportunity_detail`, reemplaza las dos primeras líneas del cuerpo por:

```python
    rows, leftovers = _plan_rows(p.get("planSheets") or [], p.get("renderHeads") or [])
    plan_html = _plan_block(rows)
    renders_html = _strip(leftovers, "", 3) if leftovers else ""
```

y en `sections` antepón el bloque del plano:

```python
    sections = "".join([
        f'<div class="detail-section"><div class="col-label">Plano y propuesta</div>{plan_html}</div>'
        if plan_html else "",
        f'<div class="detail-section"><div class="col-label">Renders · propuesta de diseño</div>{renders_html}</div>'
        if renders_html else "",
        f'<div class="detail-section"><div class="col-label">Presupuesto de obra</div>{budget_html}</div>'
        if budget_html else "",
    ])
```

y la guarda temprana:

```python
    if not (plan_html or renders_html or budget_html):
        return ""
```

Actualiza el docstring de `_opportunity_detail`: el párrafo que dice que el plano técnico NO va aquí queda obsoleto — sustitúyelo explicando que sí va, por qué (el render no es dimensionalmente exacto) y que lo que entra ya no es el plano B/N que `fe302aa` retiró.

**Step 4: Run to verify it passes**

```
cd app/api && ../../.venv/bin/pytest tests/test_prospectus_html.py -v
```

**Step 5: Commit**

```bash
git add app/api/lib/prospectus_html.py app/api/tests/test_prospectus_html.py
git commit -m "feat(prospecto): imprimir el plano junto a su render, Antes/Después por piso"
```

---

## Task 7: conectar la ruta

**Files:**
- Modify: `app/api/routes/documents.py:1-20` (import), `:97-120` (`generate_prospectus`)
- Test: `app/api/tests/test_documents.py`

**Step 1: Write the failing tests**

```python
async def test_el_prospecto_dibuja_el_plano_de_una_oportunidad(monkeypatch, ...):
    """`render_plan_sheets` se falsea AQUÍ a propósito: la que prueba el bundle de
    verdad es test_plano_js.py. Si las dos mockean, un bundle roto pasa la suite."""
    async def fake(geoms):
        assert set(geoms) == {<id de la oportunidad>}      # solo oportunidades
        return {pid: [{"floorId": "abc", "variant": "original",
                       "floorName": "Planta Baja", "svg": "<svg>PLANO</svg>"}]
                for pid in geoms}
    monkeypatch.setattr("api.routes.documents.plano_js.render_plan_sheets", fake)
    html = await _capture(...)
    assert "PLANO" in html


async def test_una_oportunidad_sin_geometria_no_rompe_el_prospecto(monkeypatch, ...):
    monkeypatch.setattr("api.routes.documents.plano_js.render_plan_sheets",
                        lambda geoms: _async({}))
    html = await _capture(...)
    assert "plan-row" not in html      # y el resto del deck intacto
```

Sigue el patrón de `_capture` (`test_documents.py:51`) para el resto del arnés.

**Step 2: Run to verify it fails**

**Step 3: Implementation**

Import: agrega `plano_js` a `from api.lib import ...` (o `from api.lib import plano_js`).

En `generate_prospectus`, justo después de `opportunities = _by_status(favorites, "oferta", "prospecto")` y antes de `_embed_opportunity_extras`:

```python
    # El plano solo entra a las páginas de oportunidad: es lo único a lo que un
    # inversionista todavía puede entrar. `geometry` ya viene en la fila (_FETCH_SQL es
    # SELECT p.*), así que esto no es una segunda lectura del mismo dato. No va en
    # to_thread: render_plan_sheets ya es I/O asíncrona.
    sheets = await plano_js.render_plan_sheets(
        {p["id"]: (p.get("geometry") or {}) for p in opportunities})
    for p in opportunities:
        p["planSheets"] = sheets.get(p["id"], [])
```

**Step 4: Run the whole suite**

```
cd app/api && ../../.venv/bin/pytest -q
```

**Step 5: Commit**

```bash
git add app/api/routes/documents.py app/api/tests/test_documents.py
git commit -m "feat(prospecto): dibujar el plano de cada oportunidad al generar el deck"
```

---

## Task 8: borrar el cuarto serializador

**Files:**
- Modify: `app/api/lib/prospectus_html.py` — borra `_pick_floors` (:641), `_floorplan_svg` (:663) y el bloque CSS `.plano*` que quede sin uso
- Modify: `app/api/tests/test_prospectus_html.py` — borra las ~20 pruebas de esas dos funciones y el import
- Modify: `app/api/tests/test_documents.py` — borra `test_opportunity_detail_omits_the_technical_plano` y equivalentes

**Step 1: Confirma que nadie las llama**

```bash
grep -rn "_floorplan_svg\|_pick_floors\|plano-svg\|plano-fixture" app/ | grep -v node_modules
```
Esperado tras borrar: sin resultados.

**Step 2: Corre todo**

```bash
cd app/api && ../../.venv/bin/pytest -q
cd app/web && npx vitest run
```

**Step 3: Commit**

```bash
git add -A app/api
git commit -m "refactor(prospecto): borrar _floorplan_svg — el plano ya lo dibuja floorToSvg"
```

---

## Task 9: evidencia visual, un PDF real

No hay assert de texto que cace un plano mal escalado. Esto es lo que exige la regla
de evidencia local antes de empujar.

**Step 1:** levanta el stack y siembra (`make app`, la propiedad 5 tiene dos pisos reales
según el comentario de `042`). Marca como favorita al menos una propiedad en `oferta` o
`prospecto` que tenga levantamiento.

**Step 2:** `make build-plano` — sin esto el PDF sale sin planos y sin error visible.

**Step 3:** descarga el deck desde el botón `📄 PROSPECTO` y ábrelo.

**Step 4: revisa a ojo, contra el editor**
- [ ] El plano imprime m² por cuarto, largos de muro y cotas — no muros pelones
- [ ] Ninguna cota queda cortada contra el borde de su hoja
- [ ] Con dos variantes: el antes y el después están a la MISMA escala (un muro se ve
      igual de grueso en los dos) y sus anchos guardan la proporción real
- [ ] Un clon sin editar imprime UNA hoja, no dos idénticas bajo Antes/Después
- [ ] Los renders de foto siguen en su tira de siempre, abajo
- [ ] Una oportunidad sin levantamiento no imprime encabezado vacío
- [ ] El presupuesto sigue fluyendo después, sin salto de página forzado
- [ ] `↓ SVG` y `↓ PDF` del editor salen exactamente como antes

**Step 5:** corre la suite completa (`make test-all`) y anota resultados reales.

**Step 6:** avísale a Louis antes de mandar — `fe302aa` fue decisión suya.

---

## Notas para quien ejecute

- **No mockees `render_plan_sheets` en `test_plano_js.py`.** Es la única prueba que carga
  el bundle de verdad; si también se mockea, un bundle roto pasa toda la suite en verde y
  llega a producción con un prospecto sin planos.
- **No cambies `file://` por `set_content`.** Está medido: `crypto.randomUUID` no existe
  fuera de contexto seguro y `migrateGeometry` lo llama.
- **No le quites el `?? 64` a `margin` cuando no hay `scale`.** La descarga del editor
  depende de que la salida sea byte-idéntica.
- Si algo se tuerce, para y re-planea — no sigas empujando.

---

# Revisión — qué salió (2026-08-16)

Las nueve tareas quedaron. Commits: `34aa733`, `93e1bb2`, `943c1fe`, `0126d77`,
`30d574e`, `6b0cd93`, `42eab74`, `0c88ab4`, `dd84059`, `776c4f2`.

**Suites:** Python 619 pasando; web 703 pasando + 1 falla PREEXISTENTE y ajena
(`TabBar.test.tsx`, `localStorage.getItem is not a function`) — se verificó con
los cambios en `git stash`: ya fallaba antes de esta rama.

**Se borró:** `_floorplan_svg`, `_pick_floors`, sus constantes, su CSS y sus 22
pruebas — 576 líneas. Cero referencias colgando. Ya no hay un cuarto dibujo del
mismo modelo.

## Lo que las pruebas de mutación confirmaron

No basta con que una prueba pase; tiene que poder fallar. Dos se mutaron a
propósito:

- `file://` → `set_content` en `plano_js.py`: **2 pruebas rojas**. El guard de
  contexto seguro muerde de verdad.
- pareo por `floorId` solo, sin `sourceVariant`: **2 pruebas rojas**, incluida la
  que lleva el nombre del bug. La advertencia de `LevantamientoPanel.tsx:231`
  queda fijada por prueba, no por comentario.

## Hallazgos que cambiaron el plan sobre la marcha

1. **CI se saltaba la prueba que importa.** El job de API no tenía Node ni
   navegador, así que `test_plano_js.py` —la única que carga el bundle real—
   se SALTABA completa. Un bundle roto habría pasado el pipeline en verde.
   Arreglado en `0126d77`, verificado local con el comando exacto del workflow.
2. **`pytest-asyncio` no existe en este proyecto.** El plan pedía
   `@pytest.mark.asyncio`; se usó `asyncio.run()` y no se agregó dependencia.
3. **`max-height: 85mm` volvía ilegible el plano.** Solo se vio en un PDF real:
   los dos lotes de la propiedad 5 son angostos y profundos, el tope de ALTO
   mandaba y el ancho se desplomaba a ~42mm. Ningún assert de texto lo detecta —
   por eso el paso 9 existe. Arreglado en `776c4f2`.

## Pendientes, no bloqueantes

- **Etiquetas encimadas en plantas apretadas.** Los largos por muro (`px(mx)+11`,
  `exportSvg.ts`) se montan sobre el muro y sobre nombres largos («ESCALERAS»,
  «almacén DP2»). Es comportamiento PREEXISTENTE de `floorToSvg`, idéntico en la
  descarga `↓ SVG` del editor — no lo introdujo este trabajo. Tocarlo cambia
  también la descarga, así que se deja anotado en vez de cambiarlo de lado.
- **`TabBar.test.tsx`** sigue rojo por su cuenta.
- **Antes/Después no se ha visto con datos reales:** ninguna propiedad tiene
  variante `planned` dibujada todavía. La ruta está probada en unit y en el
  bundle real, pero nadie la ha visto impresa.
- **Avisarle a Louis:** `fe302aa` fue decisión suya.
