# Levantamientos Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (o
> superpowers:subagent-driven-development en sesión) para implementar tarea
> por tarea. El diseño validado está en
> `docs/plans/2026-08-10-levantamientos-design.md` — leerlo primero.

**Goal:** Convertir el tab PLANO en LEVANTAMIENTO ORIGINAL + LEVANTAMIENTO
PLANEADO (clonable bajo demanda), agregar muebles con dimensiones reales y
paredes fantasma al editor, y repartir los renders por fuente: renders de
foto al tab FOTOS, renders de plano a cada levantamiento con prompt
enriquecido.

**Architecture:** El blob `properties.geometry` sube a `schemaVersion: 3`
con dos variantes independientes; un migrador TS corre al cargar (el backend
sigue siendo blob store). El editor opera sobre una variante (`FloorSet`,
shape idéntico al v2 sin `schemaVersion`); la ficha es dueña del envelope.
Muebles y fantasmas son campos aditivos del `FloorGraph`. Los renders ganan
`source_variant` en BD (migración 040) y el merge FOTOS/renders es
navegacional — el modelo de datos foto≠render no se toca.

**Tech Stack:** React 18 + TS + Vite (estilos inline con `lib/theme.ts`),
SVG a mano (sin librería de canvas), Vitest + Testing Library colocados,
FastAPI + psycopg, Playwright.

**Comandos de verificación:**

- Frontend: `cd app/web && npm test` (vitest run; un archivo:
  `npm test -- src/lib/floorplan/types.test.ts`)
- Backend: `.venv/bin/python -m pytest app/api/tests/ -x -q` desde la raíz
  (usa `TEST_DATABASE_URL`; conftest fuerza `sslmode=disable`)
- E2E: `cd app/e2e && npx playwright test tests/09-propiedad-detalle.spec.ts`
  (requiere stack local; correr solo en Fase 6)

**Reglas transversales (aplican a TODAS las tareas):**

- TDD: test primero, verlo fallar, implementar, verlo pasar, commit.
- El plano se dibuja en 3 sitios: `FloorPlanCanvas.tsx` (editor),
  `lib/floorplan/planImage.ts` (PNG para renders) y
  `app/api/lib/prospectus_html.py` (`_floorplan_svg`, PDF del prospecto).
  Todo elemento nuevo se decide explícitamente en los tres.
- Los nombres de tabs están congelados en tests: al renombrar, actualizar
  en la misma pasada `PropertyDetailPage.test.tsx`, `MediaTabs.test.tsx`,
  `app/e2e/tests/09-propiedad-detalle.spec.ts` y
  `app/e2e/scripts/check-renders-tab.mjs`.
- Estilo del repo: comentarios que explican POR QUÉ (ver los existentes en
  `MediaTabs.tsx:16-30`), commits en español, mensajes tipo
  `feat(plano): …` / `fix(renders): …`.
- Commit al final de cada tarea. No push hasta Fase 6 con evidencia local.

---

## Fase 1 — Refactor puro del editor

### Task 1: Extraer el despacho de herramientas de FloorPlanEditor

`FloorPlanEditor.tsx` (526 líneas) resuelve el pointer-down con una cadena
de `if` por herramienta (`:243-351`). Antes de agregar 2 herramientas más
(división y mueble), extraer sin cambiar comportamiento.

**Files:**
- Modify: `app/web/src/components/FloorPlanEditor.tsx`
- Test: los existentes (`FloorPlanEditor.test.tsx`,
  `FloorPlanEditor.interaction.test.tsx`, `FloorPlanEditor.calibrate.test.tsx`)

**Steps:**
1. Correr `npm test -- src/components/FloorPlanEditor` → verde (línea base).
2. Extraer cada rama de herramienta del `onPointerDown` a funciones con
   nombre dentro del mismo archivo (`handleWallTool`, `handleOpeningTool`,
   `handleRoomTool`, `handleDeleteTool`, `handleSelectTool`), cada una
   recibiendo explícitamente lo que usa (punto del modelo, state, dispatch).
   NO cambiar lógica, NO cambiar el orden de evaluación, NO mover a otro
   archivo (el archivo es grande pero la cohesión es real; YAGNI).
3. Correr los 3 archivos de test del editor → verde idéntico.
4. Commit: `refactor(plano): extrae el despacho de herramientas del pointer-down`

---

## Fase 2 — Schema v3, migrador y los dos tabs

### Task 2: FloorSet + envelope v3 + migrador en types.ts

**Files:**
- Modify: `app/web/src/lib/floorplan/types.ts`
- Test: `app/web/src/lib/floorplan/types.test.ts`

**Step 1 — tests que fallan** (agregar a `types.test.ts`):

- `migrateGeometry` con un blob v2 → envelope v3 con `original` idéntico
  (mismos floors/activeFloor/slab_m) y `planned: null`.
- `migrateGeometry` con un envelope v3 → lo regresa tal cual.
- `migrateGeometry` con `{}`, v1 (`schemaVersion: 1`), o basura → `null`
  (frontera greenfield: igual que hoy, v1 no se migra).
- `isEmpty` con envelope v3 cuyo `original` tiene floors → `false`;
  con `original` sin floors → `true`; con v2 → sigue funcionando (se migra
  antes, pero `isEmpty` no debe tronar con v2 crudo).
- `emptyModel()` produce envelope v3 con `original` = un piso "Planta Baja"
  y `planned: null`.
- `floorElev` opera sobre `FloorSet`.

**Step 2 — implementación:**

```ts
// El editor trabaja sobre UNA variante; el envelope persistido guarda dos.
// FloorSet es el shape v2 sin schemaVersion: la migración v2→v3 es anidarlo.
export interface FloorSet {
  slab_m: number
  activeFloor: number
  floors: FloorGraph[]
}

export type VariantKey = 'original' | 'planned'

export interface FloorPlanModel {
  schemaVersion: 3
  variants: { original: FloorSet; planned: FloorSet | null }
}

export function migrateGeometry(raw: unknown): FloorPlanModel | null {
  // v3: tal cual. v2: se anida como `original`. Cualquier otra cosa (v1,
  // vacío, basura) → null: misma frontera greenfield que ya teníamos.
  ...
}
```

`emptyModel()` → v3. `isEmpty(m)` → `migrateGeometry` interno o chequeo
directo de v3 (decidir al implementar; sin duplicar lógica). `floorElev(fs:
FloorSet, i)`. `clone` no cambia.

**Steps 3-5:** correr `npm test -- src/lib/floorplan` (fallarán consumidores
de tipos — es esperado y se arregla en Task 3; los tests de types.ts deben
pasar), commit junto con Task 3 si el typecheck no compila aislado.

### Task 3: Adaptar reducer, editor y ficha al FloorSet/envelope

**Files:**
- Modify: `app/web/src/lib/floorplan/reducer.ts` (el `model` del estado pasa
  de v2-model a `FloorSet`; `ADD_FLOOR`/`DEL_FLOOR`/`SWITCH_FLOOR` y
  `floorElev` usos)
- Modify: `app/web/src/components/FloorPlanEditor.tsx` (prop `initial:
  FloorSet`; `onSave(fs: FloorSet)`)
- Modify: `app/web/src/components/FloorPlanPanel.tsx`,
  `FloorPlanCanvas.tsx` (solo tipos, si referencian el model raíz)
- Modify: `app/web/src/components/PropertyDetailPage.tsx` — el estado de
  geometría pasa a ser el envelope v3: carga con `migrateGeometry`
  (`:204`), guarda componiendo el envelope (`:256`, `:980`), `planFloor`
  (`:187`) se recalcula por variante.
- Test: los colocados existentes; `PropertyDetailPage.test.tsx` fixtures de
  geometría se actualizan a v3 (o a v2 pasando por el migrador — cubrir
  ambos: al menos un test de la ficha debe cargar un blob v2 y verla
  funcionar, probando la migración end-to-end en UI).

**Steps:** TDD sobre `reducer.test.ts` (los tests existentes se ajustan al
nuevo tipo — el shape de datos es idéntico, debe ser mayormente renombre),
`npm test` completo verde, typecheck (`npx tsc --noEmit`) verde, commit:
`feat(plano): el modelo de geometría versiona en original y planeado (v3)`.

### Task 4: Tabs LEVANTAMIENTO ORIGINAL / PLANEADO + re-clonación

**Files:**
- Modify: `app/web/src/components/PropertyDetailPage.tsx:942-1034` — el
  entry `plano` se reemplaza por dos entries; NO tocar `MediaTabs.tsx`.
- Create: `app/web/src/components/LevantamientoPanel.tsx` — contenedor por
  variante: monta `FloorPlanEditor` con el `FloorSet` de su variante; para
  `planned` inexistente muestra empty state con dos acciones: "PARTIR DEL
  ORIGINAL" (clona `original`) y "EMPEZAR EN BLANCO". Para `planned`
  existente, botón "RE-PARTIR DEL ORIGINAL" con confirmación explícita
  (descarta el planeado actual — usar `window.confirm` NO: seguir el patrón
  de confirmación que ya exista en el repo; si no hay, botón de dos pasos
  como el delete de renders en `RendersPanel.tsx`).
- Test: `PropertyDetailPage.test.tsx` (assert de orden `:574-582` →
  `['MAPA','FOTOS','LEVANTAMIENTO ORIGINAL','LEVANTAMIENTO PLANEADO','RENDERS','PRESUPUESTO']`
  — RENDERS sigue existiendo hasta Fase 5, no lo quites aquí),
  `MediaTabs.test.tsx` fixture, tests nuevos de `LevantamientoPanel`:
  clonar, re-clonar con confirmación, empezar en blanco, editar planeado no
  toca original.

**Nota de alcance:** en esta tarea el tab RENDERS actual queda como está
(sigue usando el piso activo del ORIGINAL vía `planFloor`). Se muda en Fase 5.

**Steps:** TDD, `npm test` verde, commit:
`feat(ficha): PLANO se convierte en LEVANTAMIENTO ORIGINAL y PLANEADO`.

### Task 5: Prospecto lee v3 (planeado si existe)

**Files:**
- Modify: `app/api/lib/prospectus_html.py` — `_floorplan_svg` (`:628`):
  helper `_pick_floors(geometry)` que acepta v2 (`floors` en raíz) y v3
  (`variants.planned.floors` si planned existe y tiene pisos, si no
  `variants.original.floors`). Defensivo con `.get()` como el código actual.
- Test: `app/api/tests/test_prospectus_html.py` — casos: v2 sigue
  funcionando, v3 solo original, v3 con planned (gana planned), v3 basura.

**Steps:** pytest de ese archivo en rojo→verde, suite backend verde, commit:
`feat(prospecto): el plano del PDF usa el levantamiento planeado si existe`.

### Task 6: E2E del renombre (misma pasada)

**Files:**
- Modify: `app/e2e/tests/09-propiedad-detalle.spec.ts:344-370` — títulos y
  selectores: `PLANO` → `LEVANTAMIENTO ORIGINAL`; agregar assert de que
  `LEVANTAMIENTO PLANEADO` existe y aterriza en su empty state con las dos
  acciones.

**Steps:** revisar que no queden referencias a `'PLANO'` en e2e
(`grep -rn "PLANO" app/e2e/`), commit:
`test(e2e): los tabs de levantamiento sustituyen a PLANO`.
(La corrida e2e real es en Fase 6; estos specs se validan por lectura +
la suite unitaria ya cubre el renombre.)

---

## Fase 3 — Paredes fantasma

### Task 7: Edge.kind 'ghost' en el motor

**Files:**
- Modify: `app/web/src/lib/floorplan/types.ts` — `Edge.kind?: 'wall' |
  'ghost'` (ausente = wall, retrocompatible; comentar por qué es opcional).
- Modify: `app/web/src/lib/floorplan/reducer.ts` — `Tool` gana `'ghost'`;
  la acción de crear muro acepta kind; `SET_FLOOR_PARAM` (bulk de
  espesores `:183-192`) NO pisa aristas ghost; colocar puerta/ventana sobre
  una ghost se rechaza (no-op).
- Modify: `app/web/src/lib/floorplan/rooms.ts` — `exteriorEdgeIds`
  (`:64-69`) nunca devuelve una ghost.
- Test: `rooms.test.ts` (una ghost que divide un rectángulo → 2 cuartos con
  2 nombres y áreas correctas — LA prueba de la feature), `reducer.test.ts`
  (bulk no toca ghost; opening sobre ghost es no-op; crear ghost).

**Steps:** TDD, commit: `feat(plano): paredes fantasma dividen cuartos abiertos`.

### Task 8: Herramienta DIVISIÓN en el editor

**Files:**
- Modify: `app/web/src/components/FloorPlanEditor.tsx` — botón `DIVISIÓN`
  en la toolbar (`:27` lista de herramientas); reutiliza el flujo de crear
  muro con `kind: 'ghost'`.
- Modify: `app/web/src/components/FloorPlanCanvas.tsx` — ghost se pinta
  punteada y delgada (`strokeDasharray`), color tenue del theme; mismo
  hit-testing (`data-el="edge"`).
- Modify: `app/web/src/components/FloorPlanPanel.tsx` — el inspector de una
  arista ghost no ofrece espesor ni vanos; permite convertir ghost↔wall
  (barato y útil: cerrar un vano en el Planeado).
- Test: `FloorPlanEditor.interaction.test.tsx` (crear división, arrastrarla,
  borrarla), `FloorPlanPanel.test.tsx` (inspector ghost), snapshot del
  canvas si el patrón existente lo usa.

**Steps:** TDD, commit: `feat(plano): herramienta división para separar espacios sin muro`.

### Task 9: Fantasmas invisibles fuera del editor

**Files:**
- Modify: `app/web/src/lib/floorplan/dimensions.ts` — las cadenas de cotas
  y cotas por arista ignoran ghosts (`:22-54`).
- Modify: `app/web/src/lib/floorplan/export.ts` — ghosts fuera de `walls`
  (`:32-39`).
- Modify: `app/web/src/lib/floorplan/planImage.ts` — el PNG para renders NO
  dibuja ghosts (`:28-32`) — si no, el modelo de imagen construye un muro
  inexistente.
- Modify: `app/api/lib/prospectus_html.py` — el bucle de aristas salta
  `edge.get("kind") == "ghost"`.
- Test: `dimensions.test.ts`, `export.test.ts`, `planImage.test.ts` (el SVG
  string no contiene la ghost), `test_prospectus_html.py` (SVG del PDF sin
  la ghost).

**Steps:** TDD en los 4 frentes, suites frontend y backend verdes, commit:
`fix(plano): las divisiones no son muros en cotas, exports, renders ni PDF`.

---

## Fase 4 — Muebles

### Task 10: Fixture + catálogo + acciones del reducer

**Files:**
- Modify: `app/web/src/lib/floorplan/types.ts`:

```ts
export type FixtureKind =
  | 'cama_individual' | 'cama_matrimonial' | 'cama_queen' | 'cama_king'
  | 'silla' | 'mesa' | 'escritorio' | 'sillon'
  | 'inodoro' | 'lavabo' | 'regadera' | 'tina'
  | 'lavadora' | 'estufa' | 'refrigerador'

export interface Fixture {
  id: string
  kind: FixtureKind
  x: number; y: number   // centro, metros (mismo sistema que vértices)
  rot: number            // grados, CCW
  w_m: number; h_m: number  // editables; el catálogo solo da el default
}

// Dimensiones reales por defecto (metros). El catálogo es dato, no lógica:
// agregar un mueble nuevo es agregar una entrada.
export const FIXTURE_CATALOG: Record<FixtureKind, { label: string; w_m: number; h_m: number }> = {
  cama_individual:  { label: 'Cama individual',  w_m: 1.00, h_m: 1.90 },
  cama_matrimonial: { label: 'Cama matrimonial', w_m: 1.40, h_m: 1.90 },
  cama_queen:       { label: 'Cama queen',       w_m: 1.60, h_m: 2.00 },
  cama_king:        { label: 'Cama king',        w_m: 1.93, h_m: 2.03 },
  silla:            { label: 'Silla',            w_m: 0.45, h_m: 0.45 },
  mesa:             { label: 'Mesa',             w_m: 1.60, h_m: 0.90 },
  escritorio:       { label: 'Escritorio',       w_m: 1.20, h_m: 0.60 },
  sillon:           { label: 'Sillón',           w_m: 2.00, h_m: 0.90 },
  inodoro:          { label: 'Inodoro',          w_m: 0.40, h_m: 0.65 },
  lavabo:           { label: 'Lavabo',           w_m: 0.55, h_m: 0.45 },
  regadera:         { label: 'Regadera',         w_m: 0.90, h_m: 0.90 },
  tina:             { label: 'Tina',             w_m: 0.80, h_m: 1.70 },
  lavadora:         { label: 'Lavadora',         w_m: 0.60, h_m: 0.60 },
  estufa:           { label: 'Estufa',           w_m: 0.76, h_m: 0.66 },
  refrigerador:     { label: 'Refrigerador',     w_m: 0.90, h_m: 0.80 },
}
```

  `FloorGraph.fixtures?: Fixture[]` (opcional = retrocompatible) y
  `emptyFloorGraph` lo inicializa `[]`.
- Modify: `app/web/src/lib/floorplan/reducer.ts` — `Sel` gana
  `{t:'fixture'; id}`; `DragState.kind` gana `'fixture'`; acciones
  `ADD_FIXTURE` (kind → centro del viewport con dims del catálogo),
  `MOVE_FIXTURE`, `SET_FIXTURE_PARAM` (w_m/h_m/rot), `DELETE` reutiliza el
  flujo de borrado por selección. Undo/redo vía el mecanismo existente
  (`dragBase`).
- Test: `reducer.test.ts` — add usa dims del catálogo, move, resize,
  rotate, delete, undo de un drag completo como UNA entrada de historial.

**Steps:** TDD, commit: `feat(plano): muebles con dimensiones reales en el modelo`.

### Task 11: Muebles en el editor (paleta, canvas, inspector)

**Files:**
- Modify: `app/web/src/components/FloorPlanEditor.tsx` — botón `MUEBLE`
  abre paleta (lista desde `FIXTURE_CATALOG`, sin hardcodear kinds);
  seleccionar un kind lo coloca y activa select para arrastrarlo.
- Modify: `app/web/src/components/FloorPlanCanvas.tsx` — cada fixture: rect
  rotado a escala + glyph simple por familia (cama: rect con almohada;
  silla/mesa/etc.: formas mínimas — mantener sobrio, es plano técnico) +
  `data-el="fixture"`. Label pequeño con el nombre si el zoom lo permite
  (seguir el patrón de labels de cuarto `:164-185`).
- Modify: `app/web/src/components/FloorPlanPanel.tsx` — inspector de
  fixture: kind (read-only), `w_m`, `h_m`, rotación (input + botón 90°).
- Test: `FloorPlanEditor.interaction.test.tsx` (colocar desde paleta,
  drag, borrar), `FloorPlanPanel.test.tsx` (editar medidas),
  `FloorPlanCanvas` según patrón existente.

**Steps:** TDD, commit: `feat(plano): paleta de muebles, arrastre e inspector`.

### Task 12: Muebles visibles en renders y PDF

**Files:**
- Modify: `app/web/src/lib/floorplan/planImage.ts` — dibuja fixtures (rects
  rotados + label del kind) en el SVG/PNG que ve el modelo de imagen.
- Modify: `app/api/lib/prospectus_html.py` — `_floorplan_svg` dibuja
  fixtures tenues (rect + sin label o label mínimo).
- Test: `planImage.test.ts` (el SVG contiene el rect del fixture con
  transform correcto), `test_prospectus_html.py` (SVG con fixture).

**Steps:** TDD, commit: `feat(plano): los muebles llegan al render y al prospecto`.

---

## Fase 5 — Renders por fuente

### Task 13: Migración 040 + variante en renders_db

**Files:**
- Create: `db/migrations/040_render_source_variant.sql`:

```sql
-- Un render nace de una foto (source_variant NULL: vive con FOTOS) o de un
-- levantamiento ('original' | 'planned': vive con su levantamiento).
ALTER TABLE property_renders ADD COLUMN source_variant text
  CHECK (source_variant IN ('original', 'planned'));

-- Backfill: todo render-desde-plano existente nació del único plano que
-- había, que ahora es el levantamiento original. Las cadenas de edición
-- heredan la variante de su raíz.
WITH RECURSIVE chain AS (
  SELECT id, id AS root FROM property_renders WHERE parent_render_id IS NULL
  UNION ALL
  SELECT r.id, c.root FROM property_renders r JOIN chain c ON r.parent_render_id = c.id
)
UPDATE property_renders pr SET source_variant = 'original'
FROM chain c
JOIN property_renders root ON root.id = c.root
WHERE pr.id = c.id AND root.source_plan_path IS NOT NULL;
```

- Modify: `app/api/renders_db.py` — `add_render` acepta y persiste
  `source_variant`; los SELECT de `list_renders`/`list_render_heads`/
  `get_render` devuelven `sourceVariant`; el edit hereda la variante del
  padre (resolver en `routes` o con la raíz vía `chain_is_plan`-style, el
  que quede más simple).
- Test: `app/api/tests/test_renders.py` — migración aplicada en fixture;
  render de foto queda NULL; from-plan con variant persiste; editar un
  render de plano hereda la variante; backfill (insertar cadena pre-040 no
  aplica en tests — cubrir la herencia en runtime).

**Steps:** aplicar migración a la BD de test (mecanismo existente del
conftest), TDD, commit:
`feat(renders): cada render de plano sabe de qué levantamiento nació`.

### Task 14: Endpoint from-plan con variante + fix del event loop

**Files:**
- Modify: `app/api/routes/renders.py` — `create_render_from_plan` (`:132`):
  gana campo multipart `variant` (`'original'|'planned'`, obligatorio; 422
  si otra cosa). **Fix del bug**: el handler es `async def` y llama a
  OpenAI/storage sin `to_thread`, congelando el server ~60 s; convertirlo a
  `def` síncrono como los otros dos endpoints (FastAPI lo corre en
  threadpool) y quitar los `asyncio.to_thread` sueltos. `edit` propaga la
  variante del padre.
- Test: `test_renders.py` — variant inválida → 422; el handler ya no es
  corrutina (test de sanidad: `not inspect.iscoroutinefunction`); flujo
  from-plan completo con variant.

**Steps:** TDD, suite backend completa verde, commit:
`fix(renders): generar desde plano ya no congela el servidor; lleva variante`.

### Task 15: API frontend + prompt enriquecido (planFacts)

**Files:**
- Modify: `app/web/src/lib/types.ts` — `PropertyRender.sourceVariant?:
  'original' | 'planned' | null`.
- Modify: `app/web/src/lib/api.ts` — `generatePropertyRenderFromPlan` manda
  `variant`; `listPropertyRenders` tipa el campo nuevo.
- Create: `app/web/src/lib/floorplan/planFacts.ts` — función pura
  `planFacts(fs: FloorSet): string`: párrafo con los datos duros del
  levantamiento para sembrar el prompt — por cuarto: nombre y área m²
  (reusar `roomAreas`); dimensiones generales del piso activo (bounding box
  de vértices); altura (`height_m`); muebles con medidas (desde
  `fixtures`, labels del catálogo). Números con 2 decimales, unidades
  explícitas. Es la evolución del `planSeed` de `RendersPanel.tsx:23` — el
  seed viejo se elimina (transición completa, sin código muerto).
- Test: `planFacts.test.ts` — piso con 2 cuartos nombrados + 1 mueble →
  string contiene nombres, áreas, medidas del mueble; piso vacío → string
  mínimo sin basura tipo "NaN" o "undefined".

**Steps:** TDD, commit: `feat(renders): el prompt de plano se siembra con medidas, cuartos y muebles`.

### Task 16: FOTOS con sub-navegación GALERÍA | RENDERS

**Files:**
- Modify: `app/web/src/components/detail/RendersPanel.tsx` — gana prop
  `source: 'photos' | 'plan'`. En `'photos'`: sin botón "El plano", lista
  solo cadenas cuya raíz es foto. En `'plan'`: sin tira de fotos, fuente =
  el plano de la variante que le pasen (`variant`, `floorSet`), lista solo
  cadenas de su variante, siembra con `planFacts`. El badge "Propuesta · no
  es una foto" queda intacto en ambos. Si el split ensucia el componente,
  extraer `RenderList`/`RenderCard` compartidos y dos contenedores finos —
  decidir por simplicidad al ver el código.
- Create: `app/web/src/components/detail/FotosPanel.tsx` — sub-navegación
  interna `GALERÍA | RENDERS` (seguir el patrón visual del filtro
  ANTES/DESPUÉS de `PhotoGallery.tsx:204`); monta `PhotoGallery` y
  `RendersPanel source='photos'` sin modificarlos.
- Modify: `app/web/src/components/PropertyDetailPage.tsx` — el entry
  `fotos` monta `FotosPanel`; **el tab RENDERS de nivel superior se
  elimina** (transición completa). Assert de orden queda:
  `['MAPA','FOTOS','LEVANTAMIENTO ORIGINAL','LEVANTAMIENTO PLANEADO','PRESUPUESTO']`.
- Test: `RendersPanel.test.tsx` (modo photos: sin fuente plano; filtro por
  raíz), `FotosPanel.test.tsx` (sub-nav, galería default, renders montan),
  `PropertyDetailPage.test.tsx` (orden nuevo; el test "RENDERS abre su
  propio panel" `:584-593` se rehace como "FOTOS ofrece GALERÍA y
  RENDERS"). Los tests de separación foto/render NO se tocan — deben
  seguir verdes tal cual.

**Steps:** TDD, commit: `feat(ficha): los renders de foto viven dentro de FOTOS`.

### Task 17: RENDERS dentro de cada levantamiento

**Files:**
- Modify: `app/web/src/components/LevantamientoPanel.tsx` — sub-navegación
  `PLANO | RENDERS`; RENDERS monta `RendersPanel source='plan'` con su
  variante y su `FloorSet`; el export PNG usa `floorToPngBlob` del piso
  activo de ESA variante.
- Modify: `app/web/src/components/PropertyDetailPage.tsx` — pasa renders +
  callbacks a los dos `LevantamientoPanel`; `planFloor` (`:187`) muere si
  ya nadie lo usa.
- Test: `LevantamientoPanel.test.tsx` — cada variante lista solo sus
  renders; generar desde el planeado manda `variant='planned'`; el empty
  state del planeado no ofrece RENDERS (sin plano no hay render).

**Steps:** TDD, `npm test` + `npx tsc --noEmit` verdes, commit:
`feat(levantamiento): cada levantamiento genera y lista sus propios renders`.

---

## Fase 6 — Cierre

### Task 18: E2E + verificación integral

**Files:**
- Modify: `app/e2e/tests/09-propiedad-detalle.spec.ts` — barra final
  (5 tabs), FOTOS ofrece GALERÍA|RENDERS, cada levantamiento ofrece
  PLANO|RENDERS.
- Modify: `app/e2e/scripts/check-renders-tab.mjs` — el flujo manual ahora
  entra por FOTOS → RENDERS.
- Sweep: `grep -rn "RENDERS\|PLANO" app/e2e/ app/web/src --include="*.test.*"`
  para cazar asserts obsoletos (lección: se arreglan en esta misma pasada,
  no se difieren).

**Steps:**
1. Suites completas: `cd app/web && npm test && npx tsc --noEmit`;
   `.venv/bin/python -m pytest app/api/tests/ -q`.
2. Levantar stack local y correr
   `npx playwright test tests/09-propiedad-detalle.spec.ts` (y la suite e2e
   completa si el tiempo lo permite; mínimo 09 y 16).
3. Verificación visual con navegador (playwright/chrome-devtools): abrir
   una propiedad, recorrer los 5 tabs, dibujar una división, colocar un
   mueble, clonar el planeado. Capturas como evidencia.
4. Commit final + push de la rama `feat/levantamientos` (con evidencia
   local en mano — regla del repo).

**Definition of done:** los 5 tabs correctos, migración v2→v3 transparente
para propiedades existentes, división separa cuartos y no aparece en PDF ni
renders, mueble con medidas reales visible en los tres renderers, renders
repartidos por fuente con prompt enriquecido, todas las suites verdes.
