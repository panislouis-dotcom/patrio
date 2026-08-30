# El presupuesto es la suma de sus renglones — plan de implementación

**Diseño:** `docs/plans/2026-08-30-presupuesto-independiente-design.md`
**Objetivo:** que el total del presupuesto sea la suma de sus renglones, siempre; que
editar la ficha nunca lo mueva; y que `$/m²` vuelva a ser un supuesto tuyo que se
compara contra el presupuesto en vez de derivarse de él.

## Decisiones (confirmadas con Eduardo)

1. **Total = Σ renglones.** Sin modos, sin fallback, sin campo de «base».
2. **`is_residual` desaparece**: sin bandera, sin índice, sin renglón especial.
3. **`AJUSTAR` se va** junto con `set_total`.
4. **La calculadora es un botón, no una liga**: escribe UN renglón al nacer y hay un
   «re-estimar» explícito que lo reemplaza.
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

- [ ] `053_presupuesto_suma.sql` con `lock_timeout`/`statement_timeout` (patrón de la 048)
- [ ] `UPDATE budget_lines SET is_residual = FALSE WHERE is_residual` — la conversión
- [ ] `DROP INDEX IF EXISTS uq_budget_lines_residual`
- [ ] `COMMENT ON COLUMN budget_lines.is_residual` → marcada como muerta, pendiente de DROP en la 054
- [ ] `COMMENT ON COLUMN properties.construction_cost_per_sqm` → vuelve a ser insumo capturado
- [ ] `COMMENT ON COLUMN properties.construction_overhead` → sólo aplica al estimar
- [ ] Guarda de no-movimiento dentro de la migración: aborta si algún `construction_budgeted` cambió (patrón de la 032:313-341)
- [ ] Idempotente (`IF EXISTS` / `WHERE is_residual`), corre dos veces sin efecto

### PR 1 · Backend — quitar la liga viva

- [ ] `properties_db.py:867-874` — borrar el bloque completo. **Es el arreglo central.**
- [ ] `constructionCostPerSqm` de vuelta a `WRITABLE_FIELDS` (`properties_db.py:169-181`)
- [ ] `budget_db.py:239` — el derivado se publica como `budgetedCostPerSqm`; `constructionCostPerSqm` sale de la columna

### PR 1 · Backend — quitar el residuo

- [ ] Borrar `set_total()` `:1051-1072`, `_settle_residual()` `:393-421`, `current_total()` `:386-391`
- [ ] Borrar `RESIDUAL_CHAPTER` / `RESIDUAL_NAME` `:46-48`
- [ ] Borrar la ruta `PUT /api/properties/{id}/budget/total` (`routes/budget.py:302-313`) y su `TotalUpdate`
- [ ] `delete_line()` `:1040-1044` — fuera la guarda «no se borra»
- [ ] `update_line()` `:1018` — fuera la restricción a `notes`
- [ ] `delete_chapter()` `:1109` — fuera el `AND NOT is_residual`
- [ ] Quitar `FILTER (WHERE NOT l.is_residual)` y equivalentes: `_totals` `:378`, `:469`, `:591`, `:626`, `:824`, `:1167`
- [ ] `ORDER BY l.is_residual, ...` `:270` — reemplazar por orden estable sin la bandera
- [ ] `_totals()` devuelve un solo total (ya no hay «detallado» contra «total»); ajustar call sites

### PR 1 · Backend — la calculadora como botón

- [ ] `create_budget()` `:343-360` — escribe un renglón normal con el estimado, nombrado con su propia aritmética (p. ej. «Estimado inicial · 200 m² × $8,000/m²»)
- [ ] `_require_budget()` `:339` — crea el presupuesto **vacío**, sin renglón fantasma
- [ ] Endpoint `POST /api/properties/{id}/budget/re-estimate` — recalcula `m² × $/m² × overhead` y **reemplaza** el renglón de estimación (o lo crea si no está); nunca toca partidas detalladas
- [ ] `calculator_estimate()` `:127-144` se queda tal cual; sus únicos call sites quedan ser creación y re-estimar

### PR 1 · Frontend

- [ ] `BudgetPanel.tsx:1528` — fuera `AJUSTAR`, su estado `adjusting` y el comentario `:1283`
- [ ] `BudgetPanel.tsx:1008` / `:1098` — dejar de mostrar dos `$/m²` sin rótulo; mostrar *tu estimado* (capturado, editable) contra *el presupuesto* (`budgetedCostPerSqm`, derivado)
- [ ] El renglón de estimación se edita y se borra como cualquier otro (sin caso especial)
- [ ] Botón «re-estimar» que llama al endpoint nuevo, con confirmación de que reemplaza ese renglón
- [ ] `PropertyDetailPage.tsx:964,985-995` — m² y $/m² quedan como campos sin efecto colateral
- [ ] `lib/api.ts` — fuera `setBudgetTotal`; alta de `reEstimateBudget`

### PR 1 · Prospecto

- [ ] `prospectus_html.py:954` — actualizar el comentario de maquetación (ya no hay residuo)
- [ ] Rótulo derivado: si el presupuesto es un solo renglón de estimación, el PDF lo dice («estimado paramétrico, no cotizado»). Derivado, sin campo nuevo.

### PR 1 · Tests

- [ ] **Invertir** `test_budget.py:604-659`: hoy afirman que el total se movía al editar la ficha; pasan a afirmar que **no** se mueve. Los tres caminos (solo $/m², ambos, solo m²), cada uno nombrado por su caso.
- [ ] Agregar una partida **sube** el total exactamente su importe
- [ ] Borrar una partida **baja** el total exactamente su importe
- [ ] Un presupuesto sin renglones da `construction_budgeted = 0` y no rompe `investment_raw()`, la comisión de obra ni el prospecto
- [ ] El renglón de estimación se puede editar y borrar (antes eran 400)
- [ ] `re-estimate` reemplaza el renglón de estimación y **no toca** las partidas detalladas
- [ ] Prueba de conservación de la migración, **apareando por nombre y no por id** (la suite e2e recicla ids — lección 2026-08-03)
- [ ] Tests que nombren `is_residual` / `RESIDUAL_*`: borrados o reescritos, ninguno dejado en skip
- [ ] Vitest de `BudgetPanel`: sin `AJUSTAR`, los dos `$/m²` rotulados, renglón de estimación borrable

### PR 1 · Documentación que hoy miente

- [ ] `app/README.md:36` — la calculadora ya no «retires»; describe el modelo nuevo
- [ ] `db/schema.sql:1031` — se regenera con la migración; verificar que quede correcto
- [ ] `tasks/lessons.md` — nota: un comentario que describe comportamiento que vive en OTRO archivo se pudre en silencio (`67e05bf` re-ató la liga sin tocar ninguno de los dos comentarios que la negaban, y eso indujo un diagnóstico equivocado en esta misma sesión)

### PR 2 · Contract (después de que PR 1 esté vivo en prod)

- [ ] Confirmar que prod sirve el sha de PR 1 (`/api/version`)
- [ ] `054_drop_is_residual.sql` — `ALTER TABLE budget_lines DROP COLUMN IF EXISTS is_residual`
- [ ] `grep -rn is_residual app/ db/` devuelve vacío salvo las migraciones históricas

## Verificación

- [ ] `pytest app/api/tests/ -q` verde
- [ ] `cd app/web && npm test` verde
- [ ] `cd app/web && npx tsc --noEmit` limpio
- [ ] `cd app/e2e && npm test` verde (ojo: la suite trae ~18% de flake, ver `docs`)
- [ ] Migración corrida contra una base fresca 000→053 y contra una copia con datos
- [ ] **Reporte pre-flight**: por propiedad, `construction_budgeted` antes → después. Todos iguales.
- [ ] A mano en el navegador: editar m² y ver que el presupuesto **no** se mueve
- [ ] A mano: agregar una partida y ver que el total **sí** sube
- [ ] PDF real de una propiedad estimada y una detallada, revisados a ojo

## Review

_(pendiente — se llena al terminar)_
