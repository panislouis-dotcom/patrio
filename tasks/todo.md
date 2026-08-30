# El presupuesto es la suma de sus renglones — plan de implementación

**Diseño:** `docs/plans/2026-08-30-presupuesto-independiente-design.md`
**Objetivo:** que el total del presupuesto sea la suma de sus renglones, siempre; que
editar la ficha nunca lo mueva; y que `$/m²` vuelva a ser un supuesto tuyo que se
compara contra el presupuesto en vez de derivarse de él.

## Decisiones (confirmadas con Eduardo)

1. **Total = Σ renglones.** Sin modos, sin fallback, sin campo de «base».
2. **`is_residual` desaparece**: sin bandera, sin índice, sin renglón especial.
3. **`AJUSTAR` se va** junto con `set_total`.
4. **La calculadora escribe UNA vez, al nacer la propiedad.** Después NO existe
   ningún camino de escritura de la métrica hacia el presupuesto — ni automático ni
   a botón. Son dos números independientes: la métrica cruda y el presupuesto.
5. **Migración: el residuo se CONVIERTE, no se borra.** Ningún número se mueve el día
   de la migración.
6. **`$/m²` vuelve a capturarse** y se muestra al lado del derivado `presupuesto ÷ m²`.

## Las tres decisiones de implementación que importan

### A. Dos PRs, no uno: expand/contract sobre la columna

Mergear a `main` despliega a producción, y las migraciones corren en un hook PreSync
—**antes** de que entren los pods nuevos—. Si la misma migración que convierte también
hace `DROP COLUMN is_residual`, los pods **viejos** que aún atienden tráfico durante el
rollout ejecutan `FILTER (WHERE NOT l.is_residual)` contra una columna que ya no existe
y devuelven 500. La ventana es corta y real.

Por eso:

- **PR 1** — convierte (`is_residual = FALSE`), tira el índice único parcial, y saca
  todo uso de la columna del código. La columna **se queda**, con default `FALSE`: el
  código viejo la lee y ve lo mismo que el nuevo.
- **PR 2** — `DROP COLUMN`, una vez que en prod ya sólo corre código que no la nombra.

Tirar el índice en PR 1 sí es seguro: ningún código lo nombra, y un índice de más nunca
rompe una lectura.

### B. El derivado y el capturado necesitan nombres distintos en el API

Hoy `constructionCostPerSqm` de salida es `presupuesto ÷ m²` (`budget_db.py:239`) y la
columna del mismo nombre no se escribe. Si el capturado vuelve, dos cosas distintas
comparten nombre — que es justo el olor que este trabajo viene a quitar.

- `constructionCostPerSqm` → **el supuesto capturado** (vuelve a `WRITABLE_FIELDS`).
- `budgetedCostPerSqm` → **el derivado**, `presupuesto ÷ m²`, sólo lectura.

La UI los rotula: *tu estimado* contra *el presupuesto*.

### C. Un presupuesto vacío es legal, y hay que probarlo

`_require_budget()` sigue creando presupuesto al leer —la invariante «toda propiedad
tiene presupuesto» se conserva— pero ahora nace **vacío**. Es la primera vez que
`construction_budgeted = 0` es un estado legítimo y no un síntoma. Todo lo que lo
consume (`investment_raw()`, la comisión de obra, el prospecto) tiene que aguantarlo
sin ramas nuevas: 0 es un número, no un faltante.

---

## Tareas

### PR 1 · Migración

- [x] `053_presupuesto_suma.sql` con `lock_timeout`/`statement_timeout` (patrón de la 048)
- [x] `UPDATE budget_lines SET is_residual = FALSE WHERE is_residual` — la conversión
- [x] `DROP INDEX IF EXISTS uq_budget_lines_residual`
- [x] `COMMENT ON COLUMN budget_lines.is_residual` → marcada como muerta, pendiente de DROP en la 055
- [x] `COMMENT ON COLUMN properties.construction_cost_per_sqm` → vuelve a ser insumo capturado
- [x] `COMMENT ON COLUMN properties.construction_overhead` → sólo aplica al estimar
- [x] Guarda de no-movimiento dentro de la migración: aborta si algún `construction_budgeted` cambió (patrón de la 032:313-341)
- [x] Idempotente (`IF EXISTS` / `WHERE is_residual`), corre dos veces sin efecto

### PR 1 · Migración 054 — el renglón sembrado se marca, no se adivina

Surgió en revisión: identificar «el renglón que puso el sistema» por coincidencia de
`created_at` falla en los dos sentidos. `_require_budget` crea el presupuesto al vuelo, así
que la PRIMERA partida tecleada a mano cae en la misma transacción y se lee como sembrada;
y las semillas corren con `psql -f` sin `-1`, autocommit por statement, así que las que SÍ
son sembradas no coinciden. Se registra el hecho en vez de inferirlo.

- [x] `054_renglon_sembrado.sql` — `budget_lines.seeded BOOLEAN NOT NULL DEFAULT FALSE`
- [x] Backfill con el predicado de hoy: única partida, sin ejecución, `created_at` igual al del presupuesto
- [x] `seed_estimate_line` la pone en `TRUE`; `_COPIED_LINE_COLUMNS` la arrastra —
      la procedencia tiene que sobrevivir a la copia o un escenario de plan nace
      leyéndose como trabajo tecleado (desviación aprobada, la encontró una prueba roja)
- [x] `_UNTOUCHED_BUDGET` usa `seeded` en lugar de la igualdad de `created_at`
- [x] `seed_zz_presupuestos.sql` la pone explícita; se cae la necesidad del `BEGIN;`/`COMMIT;`
- [x] Mismo archivo: el nombre sembrado sale con puntos colgando (`100. m² × $9,000./m²`) — igualar a `estimate_line_name`
- [x] Nota en la migración: los pods VIEJOS del rollout escriben `seeded = FALSE`; ventana sub-minuto, se corrige a mano
- [x] `seeded` viaja al payload por el `l.*` de `_LINES_SQL` — queda en el contrato del wire desde que existe


### PR 1 · Backend — quitar la liga viva

- [x] `properties_db.py:867-874` — borrar el bloque completo. **Es el arreglo central.**
- [x] `constructionCostPerSqm` de vuelta a `WRITABLE_FIELDS` (`properties_db.py:169-181`)
- [x] `budget_db.py:239` — el derivado se publica como `budgetedCostPerSqm`; `constructionCostPerSqm` sale de la columna

### PR 1 · Backend — quitar el residuo

- [x] Borrar `set_total()` `:1051-1072`, `_settle_residual()` `:393-421`, `current_total()` `:386-391`
- [x] Borrar `RESIDUAL_CHAPTER` / `RESIDUAL_NAME` `:46-48`
- [x] Borrar la ruta `PUT /api/properties/{id}/budget/total` (`routes/budget.py:302-313`) y su `TotalUpdate`
- [x] `delete_line()` `:1040-1044` — fuera la guarda «no se borra»
- [x] `update_line()` `:1018` — fuera la restricción a `notes`
- [x] `delete_chapter()` `:1109` — fuera el `AND NOT is_residual`
- [x] Quitar `FILTER (WHERE NOT l.is_residual)` y equivalentes: `_totals` `:378`, `:469`, `:591`, `:626`, `:824`, `:1167`
- [x] `ORDER BY l.is_residual, ...` `:270` — reemplazar por orden estable sin la bandera
- [x] `_totals()` devuelve un solo total (ya no hay «detallado» contra «total»); ajustar call sites

### PR 1 · Backend — la calculadora escribe una sola vez

- [x] `create_budget()` `:343-360` — escribe un renglón normal con el estimado, nombrado con su propia aritmética: «Estimado inicial · 200 m² × $8,000/m²» (confirmado con Eduardo)
- [x] `_require_budget()` `:339` — crea el presupuesto **vacío**, sin renglón fantasma
- [x] `calculator_estimate()` `:127-144` se queda tal cual; su ÚNICO call site queda ser `create_budget()`
- [x] Verificar por grep que no queda ningún otro camino que escriba el presupuesto desde m²/$/m²

### PR 1 · Frontend

- [x] `BudgetPanel.tsx:1528` — fuera `AJUSTAR`, su estado `adjusting` y el comentario `:1283`
- [x] `BudgetPanel.tsx:1008` / `:1098` — dejar de mostrar dos `$/m²` sin rótulo; mostrar *tu estimado* (capturado, editable) contra *el presupuesto* (`budgetedCostPerSqm`, derivado)
- [x] El renglón de estimación se edita y se borra como cualquier otro (sin caso especial)
- [x] `PropertyDetailPage.tsx:964,985-995` — m² y $/m² quedan como campos sin efecto colateral
- [x] `lib/api.ts` — fuera `setBudgetTotal`, sin función nueva que la sustituya

### PR 1 · Prospecto

- [x] `prospectus_html.py:954` — actualizar el comentario de maquetación (ya no hay residuo)
- [x] Rótulo derivado: si el presupuesto es un solo renglón de estimación, el PDF lo dice («estimado paramétrico, no cotizado»). Derivado, sin campo nuevo.

### PR 1 · Tests

- [x] **Invertir** `test_budget.py:604-659`: hoy afirman que el total se movía al editar la ficha; pasan a afirmar que **no** se mueve. Los tres caminos (solo $/m², ambos, solo m²), cada uno nombrado por su caso.
- [x] Agregar una partida **sube** el total exactamente su importe
- [x] Borrar una partida **baja** el total exactamente su importe
- [x] Un presupuesto sin renglones da `construction_budgeted = 0` y no rompe `investment_raw()`, la comisión de obra ni el prospecto
- [x] El renglón de estimación se puede editar y borrar (antes eran 400)
- [ ] Prueba de conservación de la migración, **apareando por nombre y no por id** (la suite e2e recicla ids — lección 2026-08-03)
- [x] Tests que nombren `is_residual` / `RESIDUAL_*`: borrados o reescritos, ninguno dejado en skip
- [x] Vitest de `BudgetPanel`: sin `AJUSTAR`, los dos `$/m²` rotulados, renglón de estimación borrable

### PR 1 · Documentación que hoy miente

- [x] `app/README.md:36` — la calculadora ya no «retires»; describe el modelo nuevo
- [x] `db/schema.sql:1031` — se regenera con la migración; verificar que quede correcto
- [x] `tasks/lessons.md` — nota: un comentario que describe comportamiento que vive en OTRO archivo se pudre en silencio (`67e05bf` re-ató la liga sin tocar ninguno de los dos comentarios que la negaban, y eso indujo un diagnóstico equivocado en esta misma sesión)

### PR 2 · Contract (después de que PR 1 esté vivo en prod)

- [ ] Confirmar que prod sirve el sha de PR 1 (`/api/version`)
- [ ] `055_drop_is_residual.sql` — `ALTER TABLE budget_lines DROP COLUMN IF EXISTS is_residual`
- [ ] `grep -rn is_residual app/ db/` devuelve vacío salvo las migraciones históricas

## Verificación

- [x] `pytest app/api/tests/ -q` verde
- [x] `cd app/web && npm test` verde
- [x] `cd app/web && npx tsc --noEmit` limpio
- [ ] `cd app/e2e && npm test` verde (ojo: la suite trae ~18% de flake, ver `docs`)
- [x] Migración corrida contra una base fresca 000→053 y contra una copia con datos
- [x] **Reporte pre-flight**: por propiedad, `construction_budgeted` antes → después. Todos iguales.
- [x] A mano en el navegador: editar m² y ver que el presupuesto **no** se mueve
- [x] A mano: agregar una partida y ver que el total **sí** sube
- [x] PDF real de una propiedad estimada y una detallada, revisados a ojo

## Review

_(pendiente — se llena al terminar)_
