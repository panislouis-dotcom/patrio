# Quitar las plantillas de presupuesto

Decisión (2026-08-14, con Ed): **fuera las plantillas**. Copiar de otra obra se
queda como el único punto de partida que no es captura manual.

Razón: el único valor de una plantilla sobre «copiar de otra obra» es estar
curada — y eso exige que alguien la mantenga, mientras que la obra más reciente
parecida **siempre está más actualizada sin que nadie haga nada**. Mismo
argumento que retiró el catálogo. Además el estado actual es una trampa: se
pueden crear plantillas pero no renombrarlas ni borrarlas (esos endpoints se
quedaron sin cliente al borrar `PlantillasObraPage`), así que hoy solo se
acumulan.

## Verificado antes de tocar código

- [x] **NO hay tabla de plantillas**: una plantilla es `budgets` con `property_id IS NULL`. No hay `DROP TABLE` que hacer.
- [x] `budgets.name` existe SOLO para nombrar plantillas — su propio comentario en 032 lo dice: «un presupuesto de obra hereda el de su propiedad y no necesita otro que pueda contradecirlo». Queda muerta.
- [x] `budgets.notes` solo lo leen/escriben `_TEMPLATES_SQL` (`budget_db.py:581`) y `update_template` (717-718). Los otros `notes` del archivo son de `budget_lines` o de pagos — columnas distintas. Queda muerta.
- [x] `CONSTRAINT budgets_template_needs_name` (`property_id IS NOT NULL OR name <> ''`) pierde sentido.
- [x] `_clean_name` (`budget_db.py:570`) solo lo usan create/update de plantilla → muere.
- [x] `_norm` (403) **NO muere**: lo usa la dedup nueva de `copy_lines` (499-500). Solo se van sus usos de plantilla (689, 713).
- [x] Frontend: los únicos llamadores vivos son `fetchBudgetSources`, `applyBudgetSource` y `createBudgetTemplate`. `fetchBudgetTemplates`/`update`/`delete` ya no existen en `api.ts` — sus 4 endpoints backend están huérfanos hoy.
- [x] Cero plantillas en la BD de dev (`SELECT ... WHERE property_id IS NULL` → vacío).
- [x] Próxima migración libre: **044** (043 es el drop del catálogo, sin commitear aún).

## RIESGO A CONFIRMAR CON ED ANTES DE DESPLEGAR

En la BD de dev hay cero plantillas, pero **no se verificó producción**. La
migración borra las filas `budgets WHERE property_id IS NULL` y sus renglones.
Si en prod alguien ya guardó una plantilla, se pierde. Dado que qa y prod
despliegan solos al mergear, esto NO se puede mergear sin confirmarlo.

## Backend

- [x] Migración `044_drop_budget_templates.sql`: borrar las filas de plantilla (`DELETE FROM budgets WHERE property_id IS NULL` — sus `budget_lines` se van por CASCADE), quitar `CONSTRAINT budgets_template_needs_name`, `DROP COLUMN name`, `DROP COLUMN notes`, y `ALTER COLUMN property_id SET NOT NULL`. Con `down` simétrico. **Decisión sobre el UNIQUE**: no se agrega uno nuevo — `uq_budgets_property` ya garantizaba «una obra, un presupuesto», solo que `WHERE property_id IS NOT NULL`, y ese hueco era exactamente el de las plantillas. Con la columna obligatoria el predicado ya no discrimina nada, así que el índice se recrea COMPLETO con el mismo nombre: no cambia qué se rechaza, cambia que el esquema deje de insinuar un presupuesto huérfano. (Verificado antes: cero `property_id` duplicados en la BD de dev.)
- [x] Añadido a la 044 sobre lo planeado: `budget_price_observations` filtraba `b.property_id IS NOT NULL` para dejar fuera las plantillas y su COMMENT lo explicaba. Sin plantillas el filtro es siempre verdadero y el comentario miente, así que la vista se rehace con `CREATE OR REPLACE` (mismas columnas, mismos tipos) sin ese WHERE y con el comentario corregido. El `down` la devuelve tal cual.
- [x] `routes/budget.py`: borrar los 6 endpoints de plantillas/`templates` y los modelos `TemplateCreate`/`TemplateUpdate`. **`GET /api/budget/sources` SE QUEDA** (es «de dónde puedo copiar»), pero ahora solo lista obras.
- [x] `budget_db.py`: borrar `_TEMPLATES_SQL`, `_template_row`, `list_templates`, `_require_template`, `get_template`, `create_template`, `update_template`, `delete_template`, `_clean_name`. Simplificar `_SOURCES_SQL`/`list_sources`: ya no hay rama de plantilla, `name` sale de `properties`, y el `ORDER BY (b.property_id IS NOT NULL)` que ponía plantillas primero deja de tener sentido.
- [x] **NO tocar** `_norm`, `copy_lines`, `apply_budget` ni la dedup — son de la entrega anterior y siguen vivos.
- [x] `use-refigan.md`: quitar los `operation_id` de plantillas (hay test de contrato que falla si el doc cita algo que no existe).
- [x] Tests: borrar los de plantillas en `test_budget.py`; que `list_sources` siga probado (solo obras); que el esquema ya no acepte un presupuesto sin propiedad.

## Frontend

- [x] `BudgetPanel.tsx`: quitar el botón «GUARDAR COMO plantilla» y `createBudgetTemplate`. El bloque «ARRANCAR DESDE» se queda, ahora con una sola sección (obras) en vez de dos. El botón que lo abre pasa de «PLANTILLAS Y OBRAS» a «COPIAR DE OTRA OBRA», simétrico con «COPIAR A OTRAS OBRAS»; el selector va PLANO (sin `optgroup`) y su opción vacía dice «— Elegir obra».
- [x] `api.ts`: borrar `createBudgetTemplate`. `fetchBudgetSources` y `applyBudgetSource` se quedan. Muere también `sourcesWrite`, que solo lo usaba plantillas, y `sourcesRead` se dobla dentro de `fetchBudgetSources`: con un solo llamador el ayudante era indirección de más.
- [x] `types.ts`: borrar `BudgetTemplateDetail`. En `BudgetSource`, `propertyId` pasa de `number | null` a `number` (el `null` significaba «es una plantilla») y se quita ese comentario.
- [x] Ajustar sus tests; no romper los 565 que ya pasan → 564 verdes (el que se fue es el de «guardar como plantilla»).

## Verificación final
- [x] `pytest app/api/tests/` verde — 548 pasando (544 antes: +3 de `sources`, +1 por partir el test de esquema en dos)
- [x] `tsc --noEmit` limpio + `vitest run` verde — 564
- [x] Contra el stack vivo (API `:8011`):
  - `GET /api/budget/sources` responde solo obras, ninguna con `propertyId: null`
  - `GET`/`POST`/`DELETE /api/budget/templates*` → 404
  - `budgets` quedó en 4 columnas (`id`, `property_id NOT NULL`, `created_at`, `updated_at`); `uq_budgets_property` ya es UNIQUE completo, no parcial
  - Datos capturados intactos: 5 presupuestos, 16 renglones
- [ ] **BLOQUEANTE — confirmar el riesgo de plantillas en producción antes de mergear**

## Revisión

Dos hallazgos del backend que no estaban en el plan y valían la pena:

1. **`uq_budgets_property` era un índice PARCIAL** (`WHERE property_id IS NOT NULL`) y ese hueco *eran* las plantillas. Con la columna obligatoria el predicado nunca puede ser falso, así que se recreó completo: no rechaza nada nuevo, pero el esquema deja de insinuar que puede existir un presupuesto huérfano.
2. **`budget_price_observations` filtraba `property_id IS NOT NULL` para excluir plantillas**, con un `COMMENT ON VIEW` que lo decía. Dejarlo habría sido un filtro siempre-verdadero más un comentario describiendo un caso que ya no existe.

Y una deuda que este trabajo destapó: **`list_sources` llevaba sin cobertura backend desde la 043**, porque sus tests vivían en `test_budget_catalog.py` y se fueron con él. Se le agregaron tres.
