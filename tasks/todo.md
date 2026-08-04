# Una sola manera de calcular la inversión total

> **BITÁCORA CERRADA — SUPERADA POR LAS MIGRACIONES 032-034.**
> Este documento describe la migración 027 y su regla era cierta cuando se escribió.
> Ya no lo es en un punto: el último término de la fórmula —`m² × costo/m² × overhead`—
> dejó de ser fuente. El costo de obra es hoy **la suma del presupuesto por partidas**,
> y `m² × $/m²` quedó como la calculadora que produce su primer renglón.
> La regla vigente vive en `docs/glosario.md`; el diseño, en `presupuesto-de-obra.md`.
> Se conserva sin reescribir porque es el registro de una entrega, no un contrato.

## Decisión del usuario

> "no me gusta que haya 2 opciones quiero que todas se hagan de la misma manera.
> la manera en la que la inversion total se autocalcula"

La inversión total **siempre** sale del desglose. Se elimina la captura manual del
total y con ella la pregunta "¿cuál de los dos números creo?".

## Regla nueva (una sola, sin ramas)

```
inversión = precio_compra × (1 + pct_adquisición)
          + permisos + subdivisión
          + m²_obra × costo_m² × overhead
```

- Un componente ausente vale 0. No hay "desglose completo" vs "incompleto".
- Suma 0 ⇒ `None` (nada capturado) — preserva los "—" de hoy en toda la app.
- Muere: `total_investment_captured`, `investmentBasis`, `has_breakdown()`,
  `basis_kind()`, y la verificación de reconciliación entre los dos totales.

**Por qué no se pierde capacidad**: un total all-in de $9.5M se expresa como
`precio_compra = 9,500,000` con `pct_adquisición = 0`. La puerta que se cierra no
decía nada que la que queda no pueda decir.

## Migración de datos (medida, no estimada)

15 de 18 propiedades ya tienen desglose completo — **no se tocan**. Las 3 que solo
tienen total tecleado:

| id | propiedad | total | queda como |
|----|-----------|------:|------------|
| 13 | Casa Centro | 3,730,000 | purchase_price=3,730,000 · pct=0 |
| 15 | Edificio Uno | 9,500,000 | purchase_price=9,500,000 · pct=0 |
| 18 | [SEED] Propiedad E2E | 5,000,000 | purchase_price=5,000,000 · pct=0 |

`pct = 0` **explícito**, no NULL: NULL significa "supón 6.5%" y le sumaría
$617,500 a Edificio Uno sin que nadie lo pida. Los otros cuatro costos a 0.
Invariante: ningún total cambia ni un peso.

## Fases

- [x] **A · Backend + migración 027** — backfill de las 3 filas, DROP de la
      columna y su CHECK, gate de `desarrollo` del trigger reescrito
      (`purchase_price` capturado en vez de "base resoluble"); `underwriting.py`
      sin ramas; `checks.py` sin reconciliación; contrato sin `investmentBasis`.
- [x] **B · Frontend** — muere la fila INVERSIÓN CAPTURADA y su hint "NO SE USA";
      INVERSIÓN TOTAL siempre derivada; el modal de →desarrollo deja de pedirla.
- [x] **C · Docs + e2e** — glosario, skill `use-refigan.md`, spec 09.

## Verificación

- pytest + vitest + e2e verdes; `tsc --noEmit` limpio.
- **Prueba de no-movimiento**: los 18 totales resueltos antes y después de la
  migración, comparados fila por fila. Cualquier diferencia es un fallo.
- Navegador: ficha de Edificio Uno (en_renta, la que migra) y de una prospecto.

## Review

**Cerrado.** 786 pruebas verdes: 363 pytest · 223 vitest · 200 e2e · `tsc` limpio.
Todas ejecutadas sobre el árbol final, no heredadas de corridas intermedias.

**Prueba de no-movimiento: 18 propiedades, 0 movieron.** La corrí de forma
independiente de quien hizo el cambio: los insumos crudos previos a la 027 pasados
por la regla vieja, contra la BD migrada pasada por el `underwriting` de hoy.

Un susto que resultó ser del método, no del código: dos filas `[SEED]` aparecieron
como "movieron". La suite e2e las borra y recrea, así que viven en ids nuevos (354,
355) y mi comparación por id buscaba asientos vacíos. Comparando por nombre, iguales.
Lección: **un comparador que asume identidad estable miente cuando el sistema la
recicla** — y miente en la dirección peligrosa, reportando fallo donde no lo hay.

### Verificaciones propias sobre la migración (corre en prod, contra datos reales)

- El `CREATE OR REPLACE` del trigger conserva las cuatro ramas de la versión 025;
  solo sustituye la exigencia de inversión. `vendida` nunca vivió ahí — la cubre el
  CHECK `properties_vendida_needs_sale`, intacto.
- La aritmética del SQL espeja `underwriting.investment()` incluyendo los dos
  defaults por ausencia (pct 6.5%, overhead 1.3) y la lectura de `overhead = 0`
  como identidad. Los `::numeric` evitan que Postgres promueva a flotante y ensucie
  la comparación contra el total tecleado.
- La guarda aborta —con nombre y cifras— si en prod hubiera una fila con total
  tecleado Y desglose que lo contradiga. En local no hay ninguna.

### Hallazgo fuera del encargo

Una fixture de e2e mandaba `landPrice`, nombre muerto desde la 025. El API ignoraba
el campo desconocido **en silencio**: la propiedad nacía con costo 0 y la prueba
pasaba porque nada afirmaba sobre el costo. Ninguna suite verde lo iba a encontrar,
porque el error no lanzaba excepción — devolvía un cero, y un cero se ve igual que
un dato real. Lo destapó endurecer el contrato, no agregar una prueba.

### Queda para Ed

Casa Centro y Edificio Uno migraron como compra all-in (`pct = 0`). El total es
exacto, el desglose no existe porque nunca se capturó. Cuando quiera repartirlo
entre compra, permisos y obra, los campos están visibles y editables y el total se
recalcula solo.

> Nota posterior (migraciones 032-034): sigue siendo cierto para compra, costos de
> adquisición, permisos y subdivisión. **La obra ya no**: dejó de ser un par de campos
> de la ficha y se reparte por renglones en la pestaña PRESUPUESTO.
