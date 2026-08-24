# Múltiples planes de proyecto

**Fecha:** 2026-08-24
**Estado:** aprobado, pendiente de plan de implementación
**Proceso:** síntesis de 4 análisis independientes (2 Claude, 2 Codex) sobre el árbol completo, más decisiones de Eduardo (abajo).

## Problema

Hoy cada propiedad tiene EXACTAMENTE UN "plano de proyecto" (la variante `planned`
del envelope de geometría). A veces la firma quiere proponer planes distintos para
el mismo edificio — "Plan A: 4 departamentos" vs "Plan B: locales" — cada uno con
sus propios planos y renders, y elegir en el prospecto cuáles imprimir.

## Alcance v1 (decisión)

**Un plan es presentacional: nombre + geometría (pisos) + renders. Nada más.**
El presupuesto y la proyección siguen siendo singulares de la propiedad — el
README es explícito: ninguna etapa tiene dos respuestas vivas a la misma
pregunta, y la suma del presupuesto ES el costo de obra. Presupuestos-escenario
por plan, supuestos de renta por plan, y el concepto de "plan elegido" (★ un
plan como EL vigente, patrón is_chosen) quedan para un v2 deliberado.

Decisiones de Eduardo (2026-08-24):
1. Un PDF SÍ puede llevar varios planes de la misma propiedad (checkboxes, no radio).
2. Borrar un plan CASCADEA sobre sus renders, con confirmación de dos pasos
   ("Se borrarán N renders") — borra filas y archivos de storage. Un plan borrado
   no deja ningún tab donde esos renders vuelvan a verse; conservarlos sería peso
   muerto invisible. (Por tanto NO hace falta plan_name congelado en renders.)
3. "Plan elegido" es v2.
4. El bloque de presupuesto del PDF se imprime igual, sin cambio, aunque el PDF
   lleve 2+ planes de esa propiedad.

## Arquitectura: envelope v4 (no tabla nueva)

3 de 4 análisis convergieron en evolucionar el envelope, y la filosofía
documentada del repo lo exige: la geometría es un blob del frontend con UN
migrador (`migrateGeometry`) y UN constructor (`withVariant`); Python no la
interpreta (la pasa al bundle en Chromium); "no crear un cuarto serializador"
(diseño 2026-08-16). Una tabla `project_plans` partiría el blob en dos fuentes
con dos formas — rechazada salvo que los planes ganen vida relacional propia
(presupuestos por plan, permisos, historial) en un futuro v2+.

```ts
interface ProjectPlan { id: string; name: string; fs: FloorSet }
interface FloorPlanModel {           // v4
  schemaVersion: 4
  variants: { original: FloorSet; plans: ProjectPlan[] }
}
```

### El truco que hace la migración casi gratis: id legado determinista

El plan migrado desde `planned` recibe el **id literal `'planned'`** — no un
uuid minteado. `property_renders.source_variant` se GENERALIZA: deja de ser el
enum ('original'|'planned') y pasa a ser `'original' | <id de plan>`. Con eso:

- Los renders existentes (`source_variant='planned'`) empatan con el plan
  migrado **sin tocar una sola fila** — cero backfill, cero riesgo de repetir
  el bug de ids efímeros que la migración 048 reparó en producción.
- Los índices únicos de render-elegido (046: `(property_id, floor_id,
  source_variant)`) funcionan **sin cambio**: la variante ES el plan, así que
  N planes clonados del original (que comparten floor ids a propósito — el
  linaje que alinea Antes/Después) ya no colisionan.
- La invariante documentada "llave de pareo (floorId, sourceVariant), nunca
  floorId solo" (2026-08-16) sobrevive intacta con la lectura generalizada.
- Determinista en TS y SQL: un blob migrado en memoria y otro migrado por SQL
  producen el MISMO id — sin carrera.

Planes nuevos: uuid minteado en el cliente y persistido en el MISMO guardado
que crea el plan (nunca id efímero en memoria).

### Migraciones

1. **Geometría** — TS: `migrateGeometry` aprende v3→v4 (planned → `plans:[{id:'planned',
   name:'Plan de proyecto', fs}]`; sin planned → `plans:[]`) y v2→v4; `withVariant`
   se generaliza a `withOriginal`/`withPlan(planId, fs)` (upsert que preserva los
   demás planes — mismo contrato de no-pisar que hoy). SQL: una migración estilo
   048 convierte los blobs persistidos de una vez (para que planSheets/PDF vean
   v4 desde el día uno), con `lock_timeout` (lección 048: el migrate-job del
   deploy se congela en silencio sin él). El migrador TS queda para blobs rezagados.
2. **Renders** — solo DDL: soltar el CHECK de `source_variant` (040 — inline sin
   nombre: descubrirlo vía pg_constraint en un DO block) y reemplazar por
   `CHECK (source_variant IS NULL OR source_variant <> '')`. Cero UPDATE.
   Lint del CI: IF NOT EXISTS también en `migrate:down`. Verificar el número de
   migración contra TODOS los branches remotos antes de nombrar (lección 036).
3. **`make build-plano` obligatorio en el mismo deploy** — el bundle lleva el
   migrador; sin rebuild el PDF sale sin planos EN SILENCIO (lección 2026-08-23).

### Backend

- `renders_db.SOURCE_VARIANTS` desaparece como tupla; la validación pasa a ser:
  `'original'` o un id de plan presente en el geometry de la propiedad —
  **resuelto server-side** con un chequeo de membresía en el jsonb (sin
  interpretar la forma profunda; el cliente ya no se auto-certifica).
- `choose_render`/scoping/herencia-al-editar: sin cambio de lógica — la llave
  `(floor_id, source_variant)` ya distingue planes.
- **Borrar plan** (endpoint nuevo `DELETE /api/properties/{id}/plans/{planId}` o
  acción sobre el geometry save — decidir en el plan de implementación): borra
  el plan del blob + sus renders (filas y archivos) en una operación; el
  frontend confirma en dos pasos mostrando el conteo real.
- Concurrencia del blob (dos sesiones editando planes distintos se pisan el
  guardado completo): riesgo YA existente hoy entre original/planned; app
  interna monousuario. Documentado como v2 (`geometry_revision` optimista) —
  no bloquea v1.

### Prospecto / PDF

- `planSheets` emite hojas para original + CADA plan, con `{planId, planName}`.
- `_plan_rows` generaliza: se invoca por plan seleccionado; cada plan imprime su
  propia sección "Plano y propuesta · {nombre}" con el par Antes/Después actual
  por piso (escala compartida por linaje entre original y ESE plan). Nunca N
  columnas en una fila — ilegible en A4.
- La supresión de clon-idéntico (un clon sin editar no es propuesta) se conserva
  POR PLAN.
- Render elegido: uno por (floor, plan) — ya garantizado por el índice de 046
  con la lectura generalizada.
- `ProspectusOptions` gana `planIds: dict[propertyId, list[planId]] | None` con
  el MISMO contrato que `propertyIds`: None = todos los planes, lista = recorte,
  nunca agrega. Default reproduce el documento actual byte por byte.
- `ProspectusMenu`: bajo cada oportunidad con 2+ planes, un botón secundario
  ("Propuestas 2/3") abre sub-panel con un checkbox por plan. Persistencia por
  EXCLUSIONES en localStorage (filosofía documentada del menú: lo desconocido
  entra por omisión), con pruning de planes borrados/renombrados.

### Frontend

- `VariantKey` se generaliza (p.ej. `PlanKey = 'original' | string`); los dos
  tabs siguen: LEVANTAMIENTO ORIGINAL intacto; PLANO DE PROYECTO gana un
  selector de plan (bottom sheet phone-first): nombre del plan activo en el
  header, lista con Renombrar / Duplicar / Borrar, y tres nacimientos:
  PARTIR DEL ORIGINAL (clona conservando floor ids — linaje), DUPLICAR ESTA
  PROPUESTA (plan→plan, conserva ids, NO copia renders), EMPEZAR EN BLANCO.
  RE-PARTIR se vuelve por-plan ("REHACER DESDE ORIGINAL", destructivo solo
  para el plan activo, confirmación de dos pasos como hoy).
- Peligros de estado cazados por el análisis (todos con solución conocida):
  - El remount key del editor (`FloorPlanEditor key={generation}`) debe incluir
    `planId` — si no, cambiar de plan muestra la geometría del anterior.
  - `planEditorRef {variant, api}` → `{planKey, api}`: el GUARDAR del header
    debe saber a QUÉ plan escribe.
  - El efecto de sincronización de prompts en RendersPanel se llavea hoy por
    `plan?.id` (el id del PISO) — dos planes comparten floor ids a propósito,
    así que la llave debe ser compuesta (planId + floorId).
  - `onChooseRender` optimista en PropertyDetailPage compara por
    (floorId, sourceVariant) — correcto ya con la lectura generalizada, pero
    verificar que el planKey viaje.
  - Cambiar de plan con edición sucia AVISA (hoy cambiar de tab pierde en
    silencio; con planes el cambio será mucho más frecuente).
- `generatePropertyRenderFromPlan`/`uploadPropertyRenderFromPlan`: el campo
  `variant` pasa a llevar el planKey (mismo Form field, valor generalizado).

## Fuera de alcance (v2 explícito)

- Presupuestos/escenarios financieros por plan (si llega: el presupuesto del
  plan elegido ES el de la propiedad — se mueve, no se copia).
- "Plan elegido" (★ por propiedad, índice único parcial).
- `geometry_revision` (concurrencia optimista del blob).
- Historial/revisiones por plan.

## Tests afectados (mapa completo en los reportes de agentes)

Frontend: types.test.ts (migrador v4), LevantamientoPanel.test.tsx (nacimientos,
selector), PropertyDetailPage.test.tsx (montajes/guardar), RendersPanel.test.tsx
(scoping por plan), planSheets.test.ts, ProspectusMenu.test.tsx (sub-panel).
Backend: test_renders.py (validación server-side de planKey), test_prospectus_html.py
(_plan_rows por plan), test_documents.py (planIds), migración SQL nueva con su test
(patrón test_backfill_floor_ids.py). E2E: 09-propiedad-detalle.spec.ts (golden path
PARTIR + selector), 02-propiedades.spec.ts (menú). Los asserts desactualizados se
arreglan EN LA MISMA PASADA (lección e2e-staleness).
