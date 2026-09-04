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
- [x] Prueba de conservación de la migración — **resuelta por la guarda dentro de la
      migración, no por un pytest.** `conftest` aplica TODAS las migraciones de golpe,
      así que un pytest jamás ve el «antes»: tendría que reconstruirlo con datos
      sintéticos y acabaría probando la maqueta, no la migración. Las guardas de la
      053 y la 054 corren contra los datos REALES en el PreSync y abortan el deploy
      si algún `construction_budgeted` se mueve —demostrado disparándolas a mano con
      perturbaciones inyectadas—. Es más fuerte que la prueba que pedía este renglón.
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
- [x] `cd app/e2e && npm test` verde — **213 passed, 0 failed** contra HEAD, con servidor
      levantado de nuevo (la primera corrida no contaba: el uvicorn tenía cargado código
      anterior a los commits de atribución). El ~18% de flake **no se reprodujo**: 1,047
      ejecuciones locales, cero fallos, cero reintentos. Queda como pregunta abierta del
      ENTORNO de CI —`retries: 1` sólo en CI, `vite preview` sobre bundle contra dev server,
      Postgres compartido, caché fría de Playwright—, no como «la suite está sana».
- [x] Migración corrida contra una base fresca 000→053 y contra una copia con datos
- [x] **Reporte pre-flight**: por propiedad, `construction_budgeted` antes → después. Todos iguales.
- [x] A mano en el navegador: editar m² y ver que el presupuesto **no** se mueve
- [x] A mano: agregar una partida y ver que el total **sí** sube
- [x] PDF real de una propiedad estimada y una detallada, revisados a ojo

## Review

**Estado: listo para merge.** 38 commits sobre `origin/main`, HEAD `101d668`, árbol limpio.

Se declaró «listo» una vez ANTES de tiempo: la verificación adversarial encontró después un
bug de dinero en uno de los arreglos, descrito en el punto 6. Este encabezado se escribe
de nuevo sólo ahora, con esa corrección adentro.

### Verificación independiente (corrida por el lead, base propia, no reportada por agentes)

| Comprobación | Resultado en `4d25d60` |
|---|---|
| `pytest app/api/tests/ -q` | **748 passed**, 0 skipped |
| `npx tsc --noEmit` (`app/web`) | **exit 0** |
| `npx vitest run` (`app/web`) | **47 archivos, 759 passed** |
| `app/e2e` | **213 passed, 0 failed** contra HEAD |
| `db/schema.sql` contra reconstrucción `000→054` desde cero | **idéntico byte a byte** |
| Símbolos retirados (`is_residual`, `set_total`, `AJUSTAR`, …) | sin una sola referencia viva |

El chequeo del `schema.sql` es el que encontró que la `054` nunca se había regenerado, con
la suite en verde y dos revisores aprobando. Se hace desde una base construida como
`make reset-db` (`DROP SCHEMA public CASCADE; CREATE SCHEMA public`), nunca con un
`CREATE DATABASE` a secas, que hereda el comentario de `template1` y mete un hunk fantasma.

### Lo que la revisión final encontró, y que la suite verde no

1. **`scripts/seed-e2e-user.py` quedó fuera de la migración.** Seguía escribiendo
   `is_residual = TRUE` sin poner `seeded`, así que las dos propiedades semilla de E2E se
   leían como trabajo capturado: `DELETE` daba **422** donde en `main` daba 204, y habría
   reventado en el `DROP COLUMN` de la PR 2. El backfill de la `054` sólo arregla las filas
   que existían cuando corrió; un escritor fuera de su alcance produce `seeded = FALSE` para
   siempre. Mi propio barrido de greps lo perdió por estar acotado a `app/` y `db/`.
2. **El cliente ofrecía una copia proporcional que el servidor rechaza de plano.** La regla
   está partida en dos cláusulas con dos dueños: el alcance por capítulos lo sabe el cliente,
   el estado del destino lo sabe el servidor. Contestar las dos de un solo lado producía o un
   predicado duplicado o un 422 después de haber prometido un número. Se resolvió publicando
   `replaceable` (misma expresión `_UNTOUCHED_BUDGET`, hoy con cuatro lectores) y dejando la
   cláusula de capítulos donde vive su dato.
3. **Un estimado copiado y escalado contradecía su propia cuenta.** `proportional` y la
   atribución entre obras son condiciones ortogonales y coinciden: el renglón aterrizaba con
   $2,340,000 y un nombre cuya aritmética da $1,500,000. El importe siempre estuvo bien; el
   nombre no. Hoy lo dice: «… (de «Casa Edison», importe ajustado a esta obra)».
4. **`_proportional_factor` mezclaba dos conjuntos de filas.** Latente —`_require_replaceable`
   impide la combinación por ruta— pero medido: pidiendo un solo capítulo contra un objetivo
   de $300,000 el factor viejo entregaba **$21,951**. El error escala con la razón entre el
   presupuesto entero y el capítulo pedido, así que empeora cuanto más se acota la copia.
5. **Una copia proporcional y luego una directa duplicaban el estimado.** Lo introdujo el
   arreglo del punto 3: la nota de escalado vive en el NOMBRE, y el nombre es la llave de la
   dedup, así que la llave pasó a depender del MODO de copia. Secuencia alcanzable por el
   API: proporcional A→F, teclear un renglón, directa A→F → `(1 añadido, 0 saltados)`, tres
   renglones, el estimado contado dos veces. Hoy `_identidad()` quita la nota de los DOS
   lados de la comparación —quitarla de uno solo se ve bien de ida y falla en la copia de la
   copia— y la secuencia da `(0, 1)`. **Este defecto lo causó una instrucción mía**: pedí la
   marca en el nombre sabiendo que el nombre es la llave, y no seguí la consecuencia.
6. **15 frases de prosa describían el mundo anterior a esta rama.** La peor, `api.ts:871`,
   le prometía al frontend que copiar renglones deja el total quieto «porque el residuo baja
   lo que ellos suben» — exactamente lo que esta rama abolió, al revés, en el archivo que se
   consulta primero. Y la `053` decía tres veces que el `DROP` va en la `054`, que dejó de ser
   cierto cuando la `054` se la quedó `seeded`; una de las tres es un `COMMENT ON COLUMN`, o
   sea **dato que se escribe en el catálogo de producción**, apuntando a una migración que
   nunca va a existir. Por eso hoy apunta a «PR 2 · Contract» y no a un número.

### Sobre el proceso, porque cuesta caro

Una observación retirada por su propio autor se retransmitió como instrucción antes de estar
pensada, y `conftest.py` fue y volvió tres veces por eso. Lo zanjó leer el código en vez de
arbitrar entre dos agentes: el helper inserta capítulo `'Otros'` y unidad `'lote'`, que son
`ESTIMATE_CHAPTER` y `LUMP_SUM_UNIT` — la fila ES un estimado sembrado, así que marcarla
como trabajo tecleado la deja incoherente consigo misma. La regla que faltaba: **verificar
antes de retransmitir, y leer el código antes de arbitrar.**

### Huecos conocidos, declarados y no tapados

- **`app/e2e` no pasa `tsc`**: 61 errores, todos de la clase `@types/node` ausente más un
  error de tipos de Playwright. **Cero** en el spec nuevo. Es previo a esta rama y no se
  arregla aquí; instalar la dependencia era ampliar el alcance.
- **`replaceable` en el cliente es una FOTO** de la última lectura entera. Una celda que se
  autoguarda voltea el predicado en el servidor sin pasar por `receive`, así que hay una
  ventana en la que el bloqueo previo no se entera. Bloquea antes de pedir; **no manda**: la
  autoridad sigue siendo el 422, que se sigue enseñando con su motivo.
- **El flake de ~18% de CI sigue sin explicarse.** No se reprodujo en 1,047 ejecuciones
  locales. Es una pregunta del entorno de CI, no de esta rama.

### Decisiones que se tomaron aquí y conviene no deshacer

- **`chapters: null` y `chapters: [todos los capítulos]` NO son la misma petición.** `entero`
  alimenta a `reemplaza`, y `reemplaza` gobierna un `DELETE FROM budget_lines`. Colapsarlas
  por comodidad de UI convertiría «marqué todo» en «bórrame el estimado del destino». El
  regreso a «todo el presupuesto» es un botón explícito, no una inferencia — y hay una prueba
  que fija que volver a marcar todas las casillas **no** alcanza.
- **El estimado copiado se ATRIBUYE, no se recorta.** El nombre es la única memoria de esa
  cuenta y además es la llave de la dedup, así que la atribución es idempotente
  (`strpos(l.name, ' (de «') = 0`): A→B→C conserva «(de «A»)».
- **La columna `is_residual` se queda.** Expand/contract: las migraciones corren en un hook
  PreSync, antes de que entren los pods nuevos. El `DROP` es la PR 2.
