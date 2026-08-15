# Renders de todos los pisos — diseño

Fecha: 2026-08-13. Diseño validado con Eduardo tras análisis independiente de
un subagente Claude (Explore) y un subagente Codex, más AskUserQuestion.

## Diagnóstico (confirmado por ambos subagentes, evidencia real)

Hoy la sección RENDERS de un levantamiento SIEMPRE genera desde
`fs.floors[fs.activeFloor]` — el piso "activo" en la navegación del editor
(`LevantamientoPanel.tsx`). No hay selector propio de piso en RENDERS, y
`property_renders` no guarda ninguna identidad de piso — solo
`source_variant` ('original'/'planned'). En cuanto una variante tiene 2+
pisos (la propiedad 5, "Locales Salon Escobedo", ya los tiene: "Planta
Baja"/"Planta Alta"), sus renders quedan indistinguibles entre sí.

**Un prompt/llamada por piso — técnicamente forzado, no solo preferido.**
Verificado por ambos subagentes desde ángulos distintos: Claude leyendo
`api/renders.py` (llama a `images.edit` con `n=1` fijo, una imagen de
entrada), Codex contra la documentación oficial de OpenAI (`images.edit`
sí acepta hasta 16 imágenes de entrada para modelos GPT Image, pero eso
son *referencias múltiples para una sola edición*, no un mapeo N-a-N de
imágenes de entrada a salidas distintas). No existe forma de pedirle a la
API "genera un render de cada uno de estos N pisos" en una sola llamada.
Un collage de todos los pisos en una imagen sería trabajo nuevo (no
extiende el pipeline actual) y reintroduce la ambigüedad que el addendum
anterior (docs/plans/2026-08-12-fidelidad-dimensional-renders.md) gastó en
eliminar.

**Hallazgo de Claude, no anticipado**: `DEL_FLOOR` y renombrar un piso
(`SET_FLOOR_FIELD key:'name'`) YA EXISTEN en el reducer, con tests, pero
NO están conectados a ningún botón en la UI hoy — son funciones latentes,
probablemente a activarse pronto. El diseño de identidad de piso tiene que
sobrevivir a que esto se conecte.

## Decisiones validadas con Eduardo

1. **`FloorGraph` gana un `id` estable** (no el snapshot índice+nombre que
   ambos subagentes recomendaron como "suficiente por ahora" — Eduardo
   eligió la base más sólida). Sobrevive a reordenar pisos, a diferencia
   de un índice; sobrevive a renombrar, a diferencia de un nombre solo.
2. **"Generar todos los pisos" se construye YA**, con confirmación
   explícita, progreso por piso, y tolerancia a fallo parcial — no se
   difiere.
3. **Los 6 renders de prueba de la propiedad 5 (generados durante la
   verificación del addendum anterior) se borraron** — no eran datos de
   negocio reales, eran evidencia de prueba de esta sesión. Quedan
   intactos los 8 renders históricos reales de la propiedad 5
   (2026-08-05 al 07, de antes de este addendum) — esos SÍ son trabajo de
   Eduardo y nunca se tocaron.
4. **Prod**: todo render pre-existente (cualquier propiedad, en prod, al
   desplegar esto) queda con `floor_id`/`floor_name` en NULL — no hay
   forma honesta de reconstruir de qué piso salió. Los 8 renders
   históricos reales de la propiedad 5 son el caso real de prueba para
   esto: nunca tendrán identidad de piso, y el diseño debe mostrarlos sin
   romper ni inventar un dato falso.

## Modelo de identidad de piso

`FloorGraph.id: string` (UUID vía `genId()`, ya existe y se reusa —
mismo generador que usan vértices/muebles). Asignado:
- Al crear un piso nuevo (`emptyFloorGraph`, `ADD_FLOOR`).
- Al cargar un blob viejo que no lo tiene (`migrateGeometry` asigna uno
  fresco a cualquier piso sin `id` — backfill en memoria). Nota honesta:
  este id backfilleado es efímero hasta el próximo GUARDAR — si el
  usuario ve una propiedad multi-piso vieja sin guardar, el id se
  regenera en cada carga. Esto es aceptable: solo importa que el id sea
  estable AL MOMENTO de generar un render (que sí se congela en la BD);
  no afecta nada más porque la app no autoguarda.
- **Riesgo #1 a vigilar en la implementación**: `ADD_FLOOR` clona el piso
  activo completo (`clone(F(m))`) para crear el nuevo — si no se le asigna
  un `id` fresco al clon después de clonar, dos pisos quedarían con el
  mismo id. Bug fácil de cometer, fácil de no notar sin un test explícito.

`id` es un campo de identidad pura — a diferencia de `Edge.kind`/`Fixture`
(addendums anteriores), NO necesita enseñarse a los 3 renderers del plano
(canvas, `planImage.ts`, `prospectus_html.py`): no se dibuja, solo se
transporta.

## Modelo de datos en `property_renders`

`floor_id TEXT NULL` (identidad — coincide con un `FloorGraph.id` real
mientras ese piso exista) + `floor_name TEXT NULL` (snapshot congelado del
nombre al momento de generar, igual que `prompt_text` ya se congela en vez
de solo apuntar por FK). Ambos NULL para renders anteriores a esta
migración — sin backfill inventado.

## Manejo de renders sin piso identificado (prod y el caso real de la prop. 5)

- Levantamiento con **exactamente 1 piso**: no hay ambigüedad que resolver
  — un render con `floor_id=NULL` se muestra bajo ese único piso, sin
  necesidad de una sección separada (es el caso común, la inmensa mayoría
  de propiedades).
- Levantamiento con **2+ pisos** y renders con `floor_id=NULL`: sección
  explícita "Sin piso identificado" — visible siempre (nunca se ocultan
  datos históricos), separada de las secciones por piso.

## Orden de ejecución

### Task 28 — `FloorGraph.id`: identidad estable

**Files:**
- `app/web/src/lib/floorplan/types.ts`: `FloorGraph.id: string` (campo
  requerido en el tipo — no opcional, para que el resto del código nunca
  tenga que verificar su ausencia). `emptyFloorGraph` lo asigna vía
  `genId()`. `migrateGeometry` asigna un `id` fresco a cualquier piso que
  no lo tenga, para AMBAS rutas (v2→v3 y v3 crudo sin el campo — es un
  campo nuevo, hasta blobs v3 ya guardados carecen de él).
- `app/web/src/lib/floorplan/reducer.ts`: `ADD_FLOOR` — después de clonar
  el piso activo, asignar `id: genId()` al clon (NO heredar el id
  clonado). Comentario explícito sobre por qué.
- Tests (TDD, rojo primero): `types.test.ts` — `migrateGeometry` asigna id
  a un piso sin él; dos llamadas a `migrateGeometry` sobre el mismo blob
  sin ids producen ids DISTINTOS entre sí en la misma llamada (cada piso
  su propio id) pero el mismo objeto no cambia su id dentro de una sola
  migración. `reducer.test.ts` — `ADD_FLOOR` produce un piso con id
  distinto al piso fuente clonado (el test que blinda el riesgo #1).

**Definition of done:** suite frontend verde, tsc limpio. Commit:
`feat(plano): cada piso tiene una identidad estable`.

### Task 29 — Backend: `floor_id`/`floor_name` en `property_renders`

**Files:**
- `db/migrations/042_render_floor_identity.sql`: `ALTER TABLE
  property_renders ADD COLUMN floor_id text, ADD COLUMN floor_name text`
  (ambos NULL — sin backfill, comentario explicando por qué no se puede
  reconstruir honestamente). Regenerar `db/schema.sql` (método docker
  dbmate documentado en memoria, NO pg_dump local).
- `app/api/renders_db.py`: `add_render` acepta `floor_id`/`floor_name`.
- `app/api/routes/renders.py`: `create_render_from_plan` gana
  `floor_id: str = Form(...)`, `floor_name: str = Form(...)` (requeridos
  — el frontend siempre los manda una vez cableado, deploy monolítico sin
  gap de versión). `edit_property_render` hereda ambos del padre
  inmediato, mismo patrón que `source_variant`.
- Tests (TDD, rojo primero): render desde plano persiste floor_id/name
  correctos; edición hereda ambos del padre; sin floor_id → 422 (falta
  el campo requerido).

**Definition of done:** suite backend verde, migración aplica limpio.
Commit: `feat(renders): cada render de plano sabe de qué piso nació`.

### Task 30 — Frontend: selector de piso + filtrado por piso en RENDERS

**Files:**
- `app/web/src/components/LevantamientoPanel.tsx`: pasa `fs.floors`
  completo a la sección RENDERS (no un piso ya resuelto).
- Selector de piso dentro de RENDERS, mirando el patrón visual de la tira
  de botones de PLANO (`FloorPlanEditor.tsx:560-566`) pero con estado
  propio — no comparte `activeFloor` con la sub-pestaña PLANO.
- `RendersPanel.tsx`: `scoped` filtra también por `floor_id` del piso
  seleccionado. Sección "Sin piso identificado" para renders con
  `floor_id=NULL` cuando el levantamiento tiene 2+ pisos (ver diseño
  arriba); si tiene exactamente 1 piso, esos renders se muestran bajo ese
  piso sin sección separada.
- Generar-desde-plano manda el `id`/`name` del piso seleccionado (no
  siempre `activeFloor`).
- Tests: selector cambia qué renders se listan; generar desde el piso B
  persiste floor_id/name de B, no de A; renders NULL se agrupan
  correctamente según el caso (1 piso vs 2+).

**Definition of done:** suite frontend verde, tsc limpio, build limpio.
Commit: `feat(renders): cada piso tiene su propia sección de renders`.

### Task 31 — "Generar todos los pisos"

**Files:**
- Botón secundario en RENDERS (no reemplaza el "GENERAR RENDER" existente
  por piso). Confirmación explícita de dos pasos antes de disparar (N
  pisos, ~N×60-90s, N cargos reales — mismo patrón de confirmación que
  `LevantamientoPanel`'s "RE-PARTIR DEL ORIGINAL").
- Generación SECUENCIAL (no paralela — evita saturar la API/picos de
  costo, y da progreso por piso limpio). El frontend orquesta N llamadas
  al endpoint existente de un solo piso — no se inventa un endpoint de
  lote nuevo en el backend, consistente con que el patrón actual completo
  es síncrono request/response.
- Progreso visible: qué piso se está generando ahora mismo, tally de
  completados/fallidos.
- Tolerancia a fallo parcial: si el piso 2 de 3 falla, los pisos 1 y 3 NO
  se pierden ni se revierten. Resumen final claro ("2 de 3 generados.
  Falló: Nivel 3 — [motivo]").
- Tests: confirmación bloquea el disparo hasta confirmar; secuencial (no
  2 llamadas en paralelo); un fallo en medio no descarta los éxitos ya
  logrados; resumen final refleja el estado real.

**Definition of done:** suite frontend verde, tsc limpio, build limpio.
Commit: `feat(renders): un botón genera los renders de todos los pisos, con progreso y tolerancia a fallo parcial`.

### Task 32 — Verificación

- Las 4 capas verdes con evidencia fresca.
- Render real de prueba contra la propiedad 5 (2 pisos reales): generar un
  piso individualmente, confirmar `floor_id`/`floor_name` correctos en la
  BD; si el tiempo/infra lo permite, probar "generar todos" de verdad
  (2 llamadas reales, ~2 minutos) y confirmar ambos renders quedan
  correctamente etiquetados y visibles cada uno bajo su piso.
