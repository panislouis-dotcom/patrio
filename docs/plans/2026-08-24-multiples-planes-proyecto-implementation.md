# Múltiples planes de proyecto — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (o subagent-driven-development) task-by-task, en orden — hay dependencias reales entre tareas.

**Goal:** N planes de proyecto nombrados por propiedad (cada uno con sus pisos y renders), selección por plan en el PDF del prospecto.

**Architecture:** Envelope de geometría v4 (`variants: { original, plans: [{id,name,fs}] }`) con id legado determinista `'planned'`; `property_renders.source_variant` generalizado a `'original' | <planId>` (solo se relaja un CHECK — cero backfill de filas; los índices de is_chosen funcionan sin cambio). Ver el diseño completo y sus decisiones en `2026-08-24-multiples-planes-proyecto-design.md` — LÉELO antes de cualquier tarea.

**Tech Stack:** TS (React/Vite) para el modelo de geometría y UI; SQL (dbmate) para blobs persistidos y CHECK; FastAPI para validación/borrado; el bundle `plano.iife.js` para el PDF.

**Convenciones para TODA tarea:**
- cwd = `/home/eduardo/Documents/repos/new-repos/patrio/.worktrees/multiples-planes-proyecto`
- TDD: test que falla → implementación mínima → verde → commit. Un commit por tarea (o más si hay fix de review).
- Python: `.venv/bin/pytest app/api/tests/...`. Frontend: `cd app/web && npx vitest run ...` y `npx tsc --noEmit`.
- Los comentarios del código existente son documentación de decisiones — imitar el estilo, no borrarlos.
- Asserts de e2e/tests desactualizados por TU cambio se arreglan en la misma tarea, no se difieren.

---

### Task 1: TS — envelope v4 (tipos + migrador + constructores)

**Files:** `app/web/src/lib/floorplan/types.ts`, test `types.test.ts`

Contratos exactos:
```ts
export interface ProjectPlan { id: string; name: string; fs: FloorSet }
export interface FloorPlanModel {
  schemaVersion: 4
  variants: { original: FloorSet; plans: ProjectPlan[] }
}
/** 'original' | id de plan. Reemplaza a VariantKey en los sitios que hoy lo usan. */
export type PlanKey = 'original' | string
export const LEGACY_PLAN_ID = 'planned'   // id determinista del plan migrado desde v3
export const LEGACY_PLAN_NAME = 'Plan de proyecto'
```
- `migrateGeometry(raw)`: v4 pasa validado (plans malformado ⇒ blob entero rechazado, mismo criterio que v3 con planned); v3 → v4 (`planned` no-null ⇒ `plans:[{id:LEGACY_PLAN_ID, name:LEGACY_PLAN_NAME, fs}]`; null ⇒ `plans:[]`); v2 → v4 (anida como original, `plans:[]`); v1/basura ⇒ null (sin cambio de criterio).
- `withVariant` se reemplaza por `withOriginal(model, fs)` y `withPlan(model, plan: ProjectPlan)` (upsert por id, preserva los demás planes y el original — mismo contrato de no-pisar; sigue siendo EL único constructor del literal `{schemaVersion: 4, ...}`). Agregar `removePlan(model, planId)`.
- `backfillFloorIds` recorre original + todos los planes.
- Tests: migración v3→v4 con/sin planned (id y nombre EXACTOS del legado), v2→v4, v4 passthrough, v4 malformado rechazado, upsert de withPlan preserva hermanos, removePlan.
- Actualizar TODOS los call sites que rompan compilación en esta tarea solo lo mínimo mecánico (p.ej. `withVariant(g,'planned',fs)` → `withPlan(g,{id,name,fs})`) — la UI real del selector es Task 8; aquí solo debe seguir compilando y pasando la suite con UN plan (el legado). `VariantKey` puede quedar como alias deprecado temporal si reduce el diff; se elimina en Task 8.
- Verificar: `npx tsc --noEmit` + `npx vitest run` COMPLETO (no solo types.test).

### Task 2: SQL — migración 050 (blobs v3→v4 + CHECK de source_variant)

**Files:** `db/migrations/050_geometry_v4_planes.sql`, test nuevo `app/api/tests/test_geometry_v4_migration.sql-style` (patrón de `test_backfill_floor_ids.py`), `db/schema.sql` regenerado

- Parte A (blobs): UPDATE de `properties.geometry` donde `schemaVersion=3` → v4 con el plan legado `{id:'planned', name:'Plan de proyecto'}` (SQL espejo del migrador TS — mismo resultado byte-lógico). v2/v1/basura NO se tocan (el migrador TS los resuelve al leer; el PDF los ignora hoy igual). `SET LOCAL lock_timeout='5s'` (lección 048).
- Parte B (CHECK): soltar el CHECK inline de 040 sobre `source_variant` (nombre autogenerado — descubrirlo vía `pg_constraint` en un DO block) y crear `CHECK (source_variant IS NULL OR source_variant <> '')` con nombre explícito. CERO updates a property_renders.
- `migrate:down`: no-op documentado (irreversible a propósito, como 048), con guards IF EXISTS — el lint del CI lo exige.
- Regenerar `db/schema.sql` con el dbmate de Docker (`ghcr.io/amacneil/dbmate` con `--network host`, receta en memoria del proyecto) y revisar el diff.
- Test: sembrar un blob v3 con planned + renders 'planned'/'original'/null → correr migración → afirmar v4 con id 'planned', renders intactos, CHECK nuevo acepta un uuid y rechaza ''.
- Aplicar a la BD del worktree (`patrio_multiples_planes`) al terminar.

### Task 3: Backend — validación server-side del planKey en renders

**Files:** `app/api/renders_db.py`, `app/api/routes/renders.py`, `app/api/tests/test_renders.py`

- Eliminar `SOURCE_VARIANTS`; nueva función `plan_exists(property_id, plan_key) -> bool`: True si `plan_key=='original'` o si el jsonb de geometry contiene un plan con ese id (query de membresía: `geometry->'variants'->'plans' @> [{"id": ...}]` — SIN interpretar la forma profunda).
- `create_render_from_plan` y `upload_render_from_plan`: `variant` (mismo Form field) ahora acepta 'original' o un planId EXISTENTE; 422 con mensaje claro si el plan no existe. El resto (floorId/floorName/herencia al editar/choose) NO cambia.
- Tests: generar/subir con planId válido pasa y persiste `source_variant=<planId>`; planId inexistente 422; 'original' sigue OK; elegir renders del mismo piso en DOS planes distintos NO se desmarcan entre sí (la prueba de la colisión resuelta); editar hereda el planId del padre.

### Task 4: Backend — borrar plan con cascada de renders

**Files:** `app/api/routes/properties.py` (o renders.py — donde quede más orgánico), `app/api/properties_db.py`/`renders_db.py`, tests

- `DELETE /api/properties/{id}/plans/{plan_id}`: en una conexión — quita el plan del blob (SQL jsonb, sin interpretar forma profunda: filtrar el array plans por id), borra las filas de `property_renders` con ese `source_variant` y junta sus `file_path` + `source_plan_path` para borrar de storage después del commit (patrón de `delete_render` existente). 404 si el plan no existe. Devuelve `{deletedRenders: N}`.
- `GET .../plans/{plan_id}/renders-count` o incluir el conteo en la propiedad — lo que el frontend necesita para el mensaje de confirmación ("Se borrarán N renders"). Elegir lo más simple.
- Tests: borrar plan con renders (filas y archivos fuera, blob sin el plan, los demás planes intactos); plan inexistente 404; renders de OTROS planes y de fotos intactos.

### Task 5: planSheets por plan + rebuild del bundle

**Files:** `app/web/src/lib/floorplan/planSheets.ts`, `planSheets.test.ts`

- `PlanSheet` gana `planId: string | null` (null = original) y `planName: string | null`; itera original + CADA plan de `plans` (antes: original + planned). La escala compartida por linaje ahora se calcula entre el original y CADA plan por separado (el Antes/Después de cada sección compara original vs ESE plan — verificar contra el algoritmo actual de escala por `f.id`).
- Un plan cuyo FloorSet está vacío no emite hojas (mismo criterio que planned vacío hoy).
- Tests: dos planes emiten hojas etiquetadas; escala por linaje correcta por par; vacíos omitidos.
- **`make build-plano` en esta tarea y commitear** cualquier cambio necesario; verificar que `app/api/assets/plano.iife.js` quedó regenerado (el server del worktree lo usa en Task 6).

### Task 6: PDF — sección por plan + ProspectusOptions.planIds

**Files:** `app/api/lib/prospectus_html.py`, `app/api/routes/documents.py`, tests `test_prospectus_html.py`/`test_documents.py`

- `_plan_rows(sheets, renders, plan_id)`: se generaliza para parear original vs UN plan (llaves `(floorId,'original')` y `(floorId, plan_id)`); `_opportunity_detail` la invoca por cada plan SELECCIONADO y presente, imprimiendo sección "Plano y propuesta · {planName}" (con 1 solo plan sin nombre custom, el título actual se conserva para que el default siga byte-idéntico — revisar el contrato de ProspectusOptions). Supresión de clon-idéntico POR PLAN. Renders elegidos por `(floorId, planId)`.
- `ProspectusOptions.planIds: dict[int, list[str]] | None` (propertyId → planIds): None = todos; lista = recorte, nunca agrega; propiedad ausente del dict = todos sus planes. Espejo en `ProspectusSections`/frontera igual que los campos existentes.
- Tests: 2 planes seleccionados ⇒ 2 secciones etiquetadas; recorte por planIds; default (None) byte-compatible con el doc actual para una propiedad con solo el plan legado; clon idéntico suprimido por plan.

### Task 7: Frontend api.ts + types — planKey thread

**Files:** `app/web/src/lib/api.ts`, `app/web/src/lib/types.ts`, tests

- `generatePropertyRenderFromPlan`/`uploadPropertyRenderFromPlan`: el Form field `variant` lleva el planKey (tipo `PlanKey`); `PropertyRender.sourceVariant: string | null` (ya no unión literal). `ProspectusOptions.planIds` en la interfaz TS.
- Tests de api.test.ts ajustados.

### Task 8: UI — selector de planes en PLANO DE PROYECTO

**Files:** `PropertyDetailPage.tsx`, `LevantamientoPanel.tsx`, componente nuevo del selector (p.ej. `PlanSwitcher.tsx`), tests

La tarea más grande. Contratos:
- El tab PLANO DE PROYECTO monta un wrapper que: resuelve la lista de planes del envelope, mantiene `activePlanId` (default: primer plan; sin planes ⇒ estado vacío actual con PARTIR DEL ORIGINAL / EMPEZAR EN BLANCO que ahora CREAN el primer plan con nombre editable, default "Plan de proyecto"), y monta `LevantamientoPanel` con `key` que incluye el planId (remount al cambiar — obligatorio, el editor captura `initial` al montar).
- Selector phone-first (bottom sheet o dropdown compacto — al gusto del implementador siguiendo el estilo visual del repo): nombre del plan activo siempre visible en el header del tab; lista con Renombrar (inline), Duplicar (clona fs conservando floor ids, NO copia renders, nombre "Copia de X"), Borrar (confirmación dos pasos con el conteo real de renders — API de Task 4), + NUEVO PLAN (nacimientos: partir del original / duplicar actual / en blanco).
- `LevantamientoPanel`: prop `variant: VariantKey` → `planKey: PlanKey` (+ recibe el `fs` del plan activo resuelto por el wrapper, o sigue resolviendo del envelope — elegir lo que menos rompa; leer el componente primero). RE-PARTIR → "REHACER DESDE ORIGINAL" (solo el plan activo).
- `planEditorRef` guarda `{planKey, api}`; `saveFloorSet` escribe vía `withOriginal`/`withPlan`. GUARDAR del header va al plan correcto.
- Cambio de plan con editor sucio ⇒ confirmación (dos pasos estilo del repo, no window.confirm).
- Renombrar/crear/borrar/duplicar PERSISTEN de inmediato (operaciones de envelope, como hoy clonar — no pasan por GUARDAR).
- Tests: montaje con 0/1/N planes, remount al cambiar, guardar al plan activo, nacimientos, renombrar, borrar con confirmación, aviso de sucio. E2E de Task 11 cubre el golden path.

### Task 9: RendersPanel — scoping por plan

**Files:** `RendersPanel.tsx`, `RendersPanel.test.tsx`, `PropertyDetailPage.tsx` (onChooseRender optimista), `LevantamientoPanel.tsx` (pasar planKey)

- `PlanProps.variant: VariantKey` → `planKey: PlanKey`; `scoped` filtra `sourceVariant === planKey` (la generalización es literal); "Sin piso identificado" igual. El efecto de sincronización de prompts se llavea por `(planKey, plan?.id)` compuesto — dos planes comparten floor ids a propósito.
- `onChooseRender` optimista en PropertyDetailPage: `sameFloorGroup` compara `sourceVariant` — ya correcto con la lectura generalizada; verificar con test que elegir en Plan A no desmarca Plan B (espejo frontend del test de Task 3).
- generar/subir renders mandan el planKey activo.

### Task 10: ProspectusMenu — sub-panel de planes

**Files:** `ProspectusMenu.tsx`, `ProspectusMenu.test.tsx`

- Por oportunidad con 2+ planes: botón secundario "Propuestas (n/m)" abre sub-panel con checkbox por plan (nombre + conteo de pisos). Con 0-1 planes: NADA cambia (el menú actual se conserva).
- Persistencia: exclusiones por (propertyId, planId) en el mismo localStorage `prospectoExclusiones` (rama nueva del shape), pruning al abrir contra los planes vivos. `options.planIds` solo se manda si hay algo excluido (mismo patrón que propertyIds).
- El menú necesita saber los planes por propiedad: la lista de propiedades ya carga `geometry` crudo — resolver con `migrateGeometry` en el cliente (ya es dependencia del front) o pedir al backend un resumen; elegir lo más simple y honesto.
- Tests: sub-panel solo con 2+, exclusión persiste y poda, payload correcto, default sin exclusiones no manda planIds.

### Task 11: E2E

**Files:** `app/e2e/tests/09-propiedad-detalle.spec.ts`, `02-propiedades.spec.ts`

- 09: golden path actualizado — PARTIR DEL ORIGINAL crea el primer plan nombrado; crear un SEGUNDO plan, cambiar entre planes, verificar que el editor muestra la geometría correcta; renombrar. Asserts viejos del flujo planned se actualizan aquí mismo.
- 02: menú del prospecto con el sub-panel de propuestas (si la propiedad seed tiene 2+ planes; si no, seed mínimo en el spec).
- Correr contra el stack del worktree (:8021/:5191) con el seed e2e documentado.

### Task 12: Verificación manual + cierre

- Suites completas: pytest + vitest + tsc. `make build-plano` verificado.
- Manual en :5191: crear 2 planes en una propiedad real, dibujar diferencias, generar un render en cada uno (o subir), elegirlos, generar el prospecto seleccionando ambos ⇒ 2 secciones etiquetadas; excluir uno ⇒ 1 sección; borrar un plan ⇒ confirma conteo y desaparecen sus renders.
- Actualizar memoria del proyecto si surgieron lecciones nuevas.
