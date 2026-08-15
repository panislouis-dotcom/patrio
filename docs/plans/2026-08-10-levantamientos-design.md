# Levantamientos: Original y Planeado, muebles, divisiones y renders por fuente

Fecha: 2026-08-10
Estado: diseño validado con Eduardo

## Qué cambia y por qué

El tab PLANO se convierte en dos: **LEVANTAMIENTO ORIGINAL** (cómo está la
propiedad) y **LEVANTAMIENTO PLANEADO** (cómo va a quedar). "Plano" queda
reservado para una feature futura más completa. El tab RENDERS desaparece:
un render generado desde una foto es una propuesta sobre la evidencia, así
que vive con FOTOS; un render generado desde un levantamiento es una
propuesta sobre la medición, así que vive con su levantamiento. Cada fuente
en su lugar conceptual.

Barra de medios final:

    MAPA · FOTOS · LEVANTAMIENTO ORIGINAL · LEVANTAMIENTO PLANEADO · PRESUPUESTO

Los dos tabs de levantamiento se muestran siempre (sin compuerta de etapa).
Si los labels completos aprietan la barra, el fallback acordado es
`LEV. ORIGINAL` / `LEV. PLANEADO`.

## Decisiones de producto (validadas)

1. **Relación entre levantamientos: re-clonable bajo demanda.** El Planeado
   nace clonando el Original y de ahí divergen. Un botón "Re-partir del
   Original" (con confirmación: descarta el Planeado actual) lo vuelve a
   clonar cuando el Original se afinó después.
2. **Muebles con dimensiones reales editables.** No son iconos decorativos:
   cada mueble tiene medidas reales en metros, respeta la escala del plano,
   y alimenta la precisión de los renders.
3. **Cuartos abiertos: pared fantasma manual.** Sin detección automática
   (ambigua). Una herramienta "DIVISIÓN" dibuja una arista punteada donde el
   usuario decide; divide cuartos para nombres y áreas, pero no es muro en
   renders, PDF ni exports.
4. **Renders separados por fuente.** FOTOS: renders desde fotos reales (flujo
   actual). Cada levantamiento: renders desde SU plano con prompt base
   enriquecido (medidas, cuartos, muebles).
5. **El prospecto usa el Planeado si existe, si no el Original.** Es el pitch
   al inversionista: muestra la propuesta.

## Modelo de datos

### Geometría: schemaVersion 3

`properties.geometry` (JSONB, blob store sin validación backend — sin cambio
de API ni migración SQL para esto):

    { schemaVersion: 3,
      variants: {
        original: { floors: FloorGraph[], activeFloor, slab_m },
        planned:  { floors: FloorGraph[], activeFloor, slab_m } | null } }

- Cada variante es un plano completo e independiente (multi-piso).
- **Migrador en TS** (v2 → v3): corre al cargar; el blob v2 existente se
  vuelve `original`, `planned: null`. Se persiste en v3 al primer guardado.
  `isEmpty()` se actualiza para v3.
- Los lectores externos se adaptan: `_floorplan_svg` en Python (prospecto)
  acepta v2 y v3 (elige Planeado si existe); el export PNG para renders
  exporta la variante del tab que lo pide.

### FloorGraph: dos campos nuevos, ambos aditivos

- `Edge.kind?: 'wall' | 'ghost'` (default `'wall'`, retrocompatible). El
  trazado de caras (`traceFaces`) es genérico sobre aristas, así que una
  fantasma divide cuartos sin tocar el algoritmo. Se excluye de: espesores
  bulk (`SET_FLOOR_PARAM`), `exteriorEdgeIds`, cadenas de cotas
  (`dimensions.ts`), export BIM (`export.ts`), PNG de renders
  (`planImage.ts`) y SVG del prospecto (`prospectus_html.py`).
- `FloorGraph.fixtures?: Fixture[]` con
  `{ id, kind, x, y, rot, w_m, h_m }`. Catálogo explícito (estructura de
  datos, no strings) con dimensiones reales por defecto: cama individual
  1.00×1.90, matrimonial 1.40×1.90, queen 1.60×2.00, king 1.93×2.03, silla,
  mesa, escritorio, sillón, inodoro, lavabo, regadera, tina, lavadora,
  estufa, refrigerador. Extensible agregando entradas. UI: botón "MUEBLE" →
  paleta → colocar/arrastrar; inspector edita medidas y rotación. Sigue el
  patrón de `Opening` (seleccionable, arrastrable, inspector).

### Renders: columna nueva

    ALTER TABLE property_renders ADD COLUMN source_variant text
      CHECK (source_variant IN ('original','planned'));

- Renders desde foto: `NULL` (viven en FOTOS).
- Renders desde plano existentes: backfill a `'original'`.
- Cada sección lista solo lo suyo (`chain_is_plan` ya clasifica cadenas).

## UI

- **FOTOS** gana sub-navegación **GALERÍA | RENDERS**. RENDERS es el
  `RendersPanel` actual sin la fuente "El plano". El merge es navegacional:
  tablas separadas, badge "Propuesta · no es una foto" intacto, tests de
  separación foto/render vigentes.
- **Cada levantamiento** gana sub-navegación **PLANO | RENDERS**. Su sección
  de renders exporta el PNG de su variante y compone el prompt enriquecido.
- Tab Planeado sin datos: empty state con "Partir del Original" y "Empezar
  en blanco".

## Prompt base enriquecido (renders de levantamiento)

`compose_plan_prompt` se extiende con los datos duros del levantamiento:
nombre y área (m²) de cada cuarto, dimensiones generales, altura de piso,
muebles colocados con medidas. Encima: presets de estilo de la biblioteca
actual + texto libre. La cláusula estructural fija (la que impide que el
modelo invente otra casa) se conserva.

## Bug conocido que se corrige de paso

`create_render_from_plan` (`app/api/routes/renders.py:132`) es `async def`
pero llama a OpenAI y a storage sin `asyncio.to_thread`: bloquea el event
loop ~60 s por render y el servidor deja de atender. Se corrige al tocar ese
endpoint.

## Riesgos y guardas

- **Tres renderers del plano** (canvas TSX, `planImage.ts`, `prospectus_html.py`):
  todo elemento nuevo se enseña a los tres o hay inconsistencia silenciosa.
  Muebles visibles en los tres; fantasmas invisibles en los dos externos.
  Cada uno con test.
- **Nombres de tabs congelados en tests** (`PropertyDetailPage.test.tsx`,
  `MediaTabs.test.tsx`, `09-propiedad-detalle.spec.ts`,
  `check-renders-tab.mjs`): se actualizan en la misma pasada del renombre.
- **Bug latente preexistente** (no bloqueante, se documenta):
  `interiorPolygons` descarta solo una cara exterior; con islas
  desconectadas en una planta duplica áreas. Fuera de alcance aquí.
- `FloorPlanEditor.tsx` (526 líneas, cadena de `if` en pointer handling) se
  refactoriza ANTES de agregar herramientas — extracción pura, sin cambio de
  comportamiento.

## Orden de ejecución

1. Refactor puro del editor (extraer manejo de herramientas).
2. Schema v3 + migrador + los dos tabs + re-clonación + empty state.
3. Paredes fantasma.
4. Muebles con catálogo.
5. Renders: sub-tabs FOTOS y levantamientos, `source_variant`, prompt
   enriquecido, fix del event loop.
6. Prospecto (Planeado si existe) + e2e de cierre.

Cada fase es entregable y verificable por sí sola.
