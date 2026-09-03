# El presupuesto es la suma de sus renglones

**Fecha:** 2026-08-30
**Estado:** aprobado en diseño, pendiente de plan de implementación
**Proceso:** auditoría del acoplamiento presupuesto↔métricas sobre el árbol completo, contrastada contra la práctica estándar de estimación de costos (AACE Cost Estimate Classification, RICS NRM1, catálogo de conceptos), más decisiones de Eduardo (abajo).

## Problema

Hoy el total del presupuesto **no es** la suma de sus renglones. Es un objetivo
fijado desde afuera, y «Otros, por detallar» absorbe la diferencia. Detallar una
partida no mueve el total: baja el residuo. Y peor, el total se mueve solo cuando
se edita la ficha.

Eduardo lo dijo así:

> «Tiene ese tab de otros que está como que ligado al cálculo de la inversión de
> los metros cuadrados por la inversión por metro cuadrado. Pero esa liga se me
> hace innecesaria y que incomoda. […] Mejor separamos eso y dejamos que el
> presupuesto es algo independiente, vamos poniendo las cosas y pues lo que sume.
> Y así el resultado siempre está exacto.»

Tiene razón, y la razón es más fuerte que la incomodidad. Son dos defectos
distintos:

**1. La absorción borra la varianza.** Cuando detallas Instalación eléctrica y la
cotización real llega en $165K contra una holgura de $120K, esos $45K son el
número más valioso del sistema: dicen que el supuesto de $/m² iba corto. El
residuo se los come y el total no se entera. Un presupuesto que no puede estar
equivocado no enseña nada.

**2. La liga viva reprecia obra cotizada a mano.** `properties_db.py:867-874`
corre en cada PATCH de la ficha:

```python
cost_per_sqm = data.get("constructionCostPerSqm")
sqm = data.get("sqmConstruction", before["sqm_construction"])
if cost_per_sqm is None and "sqmConstruction" in data and before["sqm_construction"]:
    current = budget_db.current_total(conn, property_id)
    cost_per_sqm = current / to_decimal(before["sqm_construction"])
if cost_per_sqm and sqm:
    estimate = budget_db.calculator_estimate(sqm, cost_per_sqm, construction_overhead=1)
    budget_db.set_total(conn, property_id, estimate)
```

Tres caminos, y el tercero es el grave: **corregir el metraje de 200 a 220 m²
infla el presupuesto entero 10%**, incluidos los 13 capítulos cotizados con
proveedor. Un campo rotulado como medida física reprecia la carpintería, y nada
en la UI lo dice.

Lo re-ató `67e05bf` (2026-08-05, *«editar la propiedad vuelve a mover el costo de
obra»*) después de que la 033 lo había desatado.

### Documentación que miente hoy

Dos comentarios describen un estado que el código dejó el 2026-08-05. Ambos se
corrigen en este trabajo — un comentario que describe comportamiento que vive en
**otro archivo** se pudre en silencio, porque nada falla cuando se contradicen:

- `app/README.md:36` — «is the calculator that produces that first line and then
  retires, so no stage ever has two live answers».
- `db/schema.sql:1031` — «El API ya no la lee ni la escribe».

## Qué dice la práctica estándar

La estimación de costos tiene una escalera de madurez formal (AACE):

| Clase | Cuándo | Método | Exactitud típica |
|---|---|---|---|
| **5** Orden de magnitud | Filtrar un negocio | Paramétrico — **$/m²** | −30% … +50% |
| **3** Presupuesto de control | Autorización | Partidas semi-detalladas | −10% … +20% |
| **1** Concurso | Licitación | Take-off completo | −5% … +10% |

**`$/m²` y el presupuesto detallado no son dos fuentes que compiten. Son el mismo
documento en distinta madurez.** Nadie pregunta «¿presupuesto o $/m²?»; pregunta
«¿de qué clase es esta estimación y cuánta holgura carga?».

Tres prácticas casi universales, y cómo salimos hoy:

| Práctica | Hoy |
|---|---|
| El alcance no detallado se carga **explícito** como holgura/contingencia, visible en el total | ✅ «Otros, por detallar» **es** este concepto — se conserva |
| La estimación **nunca cambia sola**; las revisiones son eventos | ❌ se mueve al editar la ficha |
| **Base contra actual**: se congela lo aprobado y se mide la desviación | ❌ no existe (ver *Fuera de alcance*) |

Es decir: cargar el no-detallado como renglón está **bien y se queda**. Lo
no-estándar es la absorción automática y la liga viva.

### La flecha está al revés

```
HOY          el total es FIJO   →  el detalle debe CABER adentro
                                   (el residuo absorbe la diferencia)

PRÁCTICA     el detalle es REAL →  el total es LIBRE de moverse
                                   (la desviación contra la base es la señal)
```

## Decisión

**Una regla: el total del presupuesto es la suma de sus renglones. Siempre. Sin
modos, sin fallback, sin campo de «base».**

Lo único que cambia con la madurez es *qué renglones* tiene:

```
prospecto     «Estimado 200 m² × $8,000/m²»   $1,600,000   ← un renglón de holgura;
                                                              lo escribió la calculadora
                                                              y desde ahí es dato tuyo

oferta        Preliminares                       $55,000
              Obra gris                         $158,126
              Instalación eléctrica             $165,000
              «Por detallar»                    $980,000   ← holgura que baja
                                                              a mano, deliberadamente

desarrollo    …13 capítulos, detallado…       $1,720,000   ← el total SE MOVIÓ +$120K
                                                              y ese es el hallazgo
```

### Decisiones de Eduardo

1. **Se quita la liga viva** (`properties_db.py:867-874`). Editar m² o $/m² no
   toca el presupuesto.
2. **Se quita `AJUSTAR`** y con él `set_total`. Para mover el total se mueven los
   renglones.
3. **`is_residual` desaparece por completo** — sin bandera, sin índice único
   parcial, sin renglón especial. Una holgura es un renglón con el nombre que le
   pusiste. Puede haber cero, uno o tres. Se puede borrar. *«Todas se hagan de la
   misma manera.»*
4. **La calculadora es un botón, no una liga.** Escribe **un** renglón al nacer la
   propiedad, y hay un «re-estimar» explícito que **reemplaza ese renglón**. Nunca
   automático.
5. **`$/m²` vuelve a ser supuesto capturado** (`properties.construction_cost_per_sqm`,
   columna que ya existe y que el API dejó de escribir), mostrado **junto a**
   `presupuesto ÷ m²`. Dos números reales, ninguno gobierna al otro. Sólo es
   comparación honesta cuando ninguno es el fallback del otro.
6. **Migración: el residuo se CONVIERTE, no se borra** (`is_residual = FALSE`).

### Por qué convertir y no borrar

`prospectus_html.py:954` lo dice del sistema real:

> «Un presupuesto corto (**la mayoría: una sola línea "Otros, por detallar"**)»

Para la mayoría de las propiedades ese renglón **es** todo el costo de obra, y
alimenta:

```
residuo → construction_budgeted → investment_raw()     finance/underwriting.py:132-158
                                → comisión de obra     finance/fees.py:56
                                → totalInvestment, ROI, proyecciones
                                → el prospecto de inversionistas
```

Borrarlo dejaría a la mayoría del portafolio en **$0 de obra**, y eso viaja a
documentos que se le mandan a inversionistas. «Quitar Otros» son dos peticiones
distintas: quitar **la regla** o quitar **el dinero**. La regla sobra; el dinero
es real — es la estimación Clase 5, sólo que mal alojada. Convertir quita la
regla y deja el número intacto el día de la migración.

En una propiedad ya detallada (Centro: 13 capítulos, residuo de $2) queda un
renglón de $2 que se borra con un click.

### Por qué no el fallback «si no hay presupuesto, usa m² × $/m²»

Se consideró y se descarta. Es la forma exacta de `investmentBasis`: dos fuentes
vivas y un condicional eligiendo, y cada lector río abajo —`investment_raw()`, la
comisión, el prospecto, el ROI— tendría que saber en qué modo está la propiedad.
Además «tiene presupuesto» se vuelve borroso: ¿un renglón es presupuesto? ¿uno en
$0?

La necesidad detrás sí es real —una propiedad nueva tiene que ser evaluable antes
de que alguien detalle nada— y se satisface **materializando** la estimación como
renglón en vez de ramificando sobre ella. Es la diferencia entre un **default**
(corre una vez, escribe dato real, y el dato es la verdad) y un **fallback** (vive
para siempre como rama). Los dos dan número el día uno; sólo el default conserva
una sola fuente.

Lo dice la 033 de su propio residuo: *«convertir una resta determinista en una
segunda captura es donde nace el descuadre»*.

## Alcance

### Migración

- `is_residual = FALSE` en todos los renglones (el número no se mueve).
- `DROP INDEX uq_budget_lines_residual`; `DROP COLUMN is_residual`.
- `COMMENT ON COLUMN` de `construction_cost_per_sqm` y `construction_overhead`
  reescritos: la primera vuelve a ser insumo capturado; el overhead sólo aplica al
  estimar.
- Idempotente (`IF EXISTS`), con `lock_timeout` — la 048 dejó ese precedente.

### Backend

Se va:
- `properties_db.py:867-874` — la liga viva. **Este es el arreglo central.**
- `set_total()` `budget_db.py:1051-1072`, `_settle_residual()` `:393-421`,
  `current_total()` `:386-391`.
- `PUT /api/properties/{id}/budget/total` (`routes/budget.py:302`).
- Guardas del residuo: `delete_line()` `:1040-1044` («no se borra»),
  `update_line()` `:1018` (sólo `notes`), el filtro `AND NOT is_residual` de
  borrado de capítulo `:1109`, y los `FILTER (WHERE NOT l.is_residual)` de
  `_totals` `:378` y demás (`:469`, `:591`, `:626`, `:824`, `:1167`).
- `RESIDUAL_CHAPTER` / `RESIDUAL_NAME` `:46-48`.

Se queda y cambia:
- `calculator_estimate()` `:127-144` — vive, ahora sólo la llama la creación y el
  botón «re-estimar».
- `create_budget()` `:343-360` — escribe un renglón normal (`is_residual` ya no
  existe), nombrado con el cálculo que lo produjo.
- `_require_budget()` `:339` — sigue creando presupuesto al leer (la invariante
  «toda propiedad tiene presupuesto» se conserva), pero **vacío**: sin renglón
  fantasma.
- `totals_sql()` `:182-203` — deja de filtrar por `is_residual`; ya suma todo.
- `constructionCostPerSqm` vuelve a `WRITABLE_FIELDS` (`properties_db.py:169-181`)
  y deja de derivarse en la salida (`budget_db.py:239`).
- Endpoint nuevo: re-estimar (reemplaza el renglón de estimación).

### Frontend

- `BudgetPanel.tsx:1528` — fuera `AJUSTAR` y su modo `adjusting`.
- `BudgetPanel.tsx:1098` vs `:1008` — hoy la UI muestra **dos** `$/m²` distintos
  (la columna cruda sembrada y el derivado `total ÷ m²`). Queda uno capturado y
  uno derivado, **rotulados**, uno al lado del otro: *tu estimado* contra *el
  presupuesto*.
- El renglón de estimación se edita y se borra como cualquier otro.
- `PropertyDetailPage.tsx:964,985-995` — los campos de m² y $/m² dejan de tener
  efecto colateral sobre el presupuesto.

### Prospecto

- Sin dependencia estructural del residuo (`prospectus_html.py:954` sólo lo
  menciona en un comentario de maquetación, que se actualiza).
- **Rótulo de clase:** cuando el presupuesto es un solo renglón de estimación, el
  prospecto lo dice — un inversionista tiene que saber que $1.6M es paramétrico y
  no cotizado. **Derivado, no capturado**, para que no haya nada que mantener en
  sync.

## Fuera de alcance (explícito)

- **Base contra actual.** La práctica que de verdad valdría la pena después:
  congelar el presupuesto al pasar a `oferta` y mostrar `base → actual →
  desviación`. El gate de `status` da el momento natural del snapshot. No entra
  aquí, pero «total = suma» y «las revisiones son explícitas» lo dejan agregable.
- **Clases de estimación como campo.** Nada de capturar Clase 5/3/1. El rótulo del
  prospecto se deriva.
- **`DROP COLUMN construction_overhead`.** Sigue pendiente junto con la reescritura
  de `db/seeds`.
- **Copiar proporcional** (`budget_db.py:650-730`) no se toca: es otra feature
  (copiar el presupuesto de otra propiedad dimensionado), no la absorción.

## Verificación

- Suite backend y frontend en verde; `tsc` limpio.
- **Prueba de no-movimiento:** para toda propiedad, `construction_budgeted` antes
  == después de la migración. Aparear por **nombre**, no por id — la suite e2e
  recicla ids (lección del 2026-08-03).
- Editar m² y editar $/m² dejan el total **idéntico** — prueba nombrada por el
  caso, porque es el defecto que motivó el trabajo.
- Agregar una partida **sube** el total en su importe exacto.
- Borrar el último renglón deja el presupuesto en 0 sin romper `investment_raw()`
  ni el prospecto.
- Los tests que hoy fijan la liga viva (`test_budget.py:604-659`) se **invierten**:
  afirmaban que el total se movía; ahora afirman que no.
- PDF real de una propiedad estimada y una detallada, revisado a ojo.
