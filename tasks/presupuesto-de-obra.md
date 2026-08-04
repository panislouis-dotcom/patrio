# Presupuesto de obra — análisis y diseño

> Documento de exploración. Nada de esto está implementado ni acordado todavía.

## Lo que pidió Ed

Una pestaña PRESUPUESTO junto a MAPA / FOTOS / PLANOS, cuya suma alimente el costo
de construcción. Textual:

- "cuando vemos una oportunidad ponemos el gasto estimado pero luego queremos
  poderlo actualizar en función de actualizar el inventario"
- **"pero no quiero que sean números distintos"**
- "tal vez el inventario empieza con una sola fila de otros con el total definido
  y luego la vamos actualizando"
- "tal vez queremos poder tener alguna especie de template o templates y con el
  tiempo ir mejorándolo"
- "muchas cosas se van a repetir pero tal vez va a haber cosas nuevas ya sean
  generales o por proyecto"

Y contestó el alcance: **tres cifras por partida** (presupuestado, comprometido,
pagado) · **dos niveles** (capítulo → partida) · **solo captura el equipo
interno** · **cada partida ligada a un proveedor desde el inicio**.

## La tensión, nombrada

"No quiero que sean números distintos" y "quiero presupuestado + comprometido +
pagado" no se contradicen, pero solo si el diseño distingue dos cosas:

| | |
|---|---|
| **El mismo concepto medido dos veces** | Duplicación. Es lo que se rechaza, y lo que la migración 027 acaba de eliminar de la inversión total. |
| **Conceptos distintos que coexisten** | Control de obra. Lo que planeas, lo que firmaste, lo que pagaste. Tres hechos, no tres versiones. |

Si la interfaz no hace esa diferencia obvia, renace el problema que se acaba de
matar.

## Hallazgos que cambian el diseño

### 1. Las tres cifras ya existen en la plataforma, con otro nombre

`PropertyInvestor` tiene `interestedAmount` / `committedAmount` / `fundedAmount`.
Un monto planeado y dos etapas de ejecución contra ese plan — **la misma forma de
negocio**, aplicada al dinero que entra en vez del que sale. No es un concepto
nuevo: es un embudo que el producto ya modela.

### 2. La interfaz está casi resuelta por código propio

`ProcesoInstanceDetail.tsx` ya hace en producción lo que el presupuesto necesita:

- jerarquía colapsable (`collapsed: Set<number>`, `toggleCollapse`, chevron ▶/▼)
- **los padres suman solos** — `getProgress()` deriva el valor del capítulo de sus
  hijos; nunca se captura. Mismo principio que `totalInvestment`, que jamás se teclea
- **sin botón EDITAR/GUARDAR**: cada celda siempre activa, guarda al cambiar, con
  parche optimista
- **selector de proveedor por renglón** (`ProcesoNodeDetail.tsx:419-427`),
  filtrando los `vetado`

El presupuesto no inventa patrones: **compone tres que ya funcionan** — el árbol
colapsable, el embudo de tres montos, y el catálogo de proveedores.

### 3. Pero la maquinaria de plantillas NO se debe reusar tal cual

Las plantillas de proceso se leen **en vivo**, no se copian al instanciar. Y los
borrados van en cascada:

```
template_nodes ──CASCADE──▶ instance_node_states  (avance, fechas, proveedor)
               ──CASCADE──▶ node_files            (fotos de obra)
               ──CASCADE──▶ node_comments
process_templates ──CASCADE──▶ process_instances  (todas)
```

`delete_node_route` solo valida que el nodo exista. `handleDelete()` no confirma
nada. **Borrar un nodo de plantilla destruye el avance capturado, las fotos y los
comentarios de todas las propiedades que la usaban.**

Hoy no hay nada que perder — la base local tiene 0 instancias — pero es la
doctrina que el presupuesto iba a heredar. Para un checklist da igual que un
nombre se actualice retroactivamente; **para dinero es inaceptable** que editar un
precio de catálogo altere el presupuesto ya cerrado de una propiedad vendida.

**Doctrina para el presupuesto: copiar al instanciar.** Cada partida nace con su
propio nombre, unidad, cantidad y precio, más un `source_item_id` que apunta al
catálogo solo para trazabilidad y que nunca se vuelve a leer en vivo.

### 4. Ya hubo un intento y murió

`projects.budget` (JSON) existió desde la migración 000 y se borró en la 023: el
dato era *"fabricated seed-era JSON (never captured through the app)"*. Nunca se
usó.

Por qué murió, y qué hace distinto a éste: aquel era un blob sin estructura, sin
plantillas que abarataran empezar, y **desconectado de cualquier cifra que
importara**. Nadie captura datos que no mueven nada. Éste mueve el costo de
construcción, la inversión, el ROI y el PDF del inversionista — y arranca con una
sola fila en vez de una hoja en blanco.

## La pregunta central — DECIDIDA

Con cuatro candidatos a ser "el costo de obra" —la fórmula, y las sumas de
presupuestado, comprometido y pagado— ¿cuál alimenta `totalInvestment`, del que
cuelgan el ROI, el cap rate y el PDF del inversionista?

La trampa: *"usa el presupuesto si existe, si no la fórmula"* **ya es una rama
condicional** — exactamente el patrón que la 027 eliminó.

Hubo desacuerdo real. **Codex sostuvo** que `totalInvestment` no debe cambiar de
fuente jamás y que el presupuesto debe vivir aparte sin tocarlo nunca. El
argumento es serio —ningún número cambia de significado por etapa— pero deja **dos
respuestas vivas** a la pregunta "¿cuánto va a costar la obra?", y contradice de
frente lo que Ed pidió.

La distinción que resuelve el desacuerdo:

| | |
|---|---|
| `rentMonthlyProjected` vs `rentMonthlyActual` | Lo que crees que vas a cobrar vs lo que el inquilino paga. **Dos hechos distintos.** Coexisten para siempre; compararlos es el aprendizaje. |
| Fórmula vs suma de partidas | Los dos son planes del **mismo gasto futuro**, uno grueso y otro detallado. **Un hecho a dos resoluciones.** |

"El mismo concepto medido dos veces" es exactamente lo que 027 mató.

### La decisión de Ed, y lo que simplificó

**(1) El presupuesto es el costo de obra. (2) Existe desde `prospecto`** — hay que
poder presupuestar antes de ofertar.

La segunda respuesta elimina la parte más frágil del diseño. Si el presupuesto
solo naciera en `desarrollo` haría falta **un momento de traspaso**, y toda costura
se rompe. Naciendo con la propiedad, no hay traspaso que diseñar:

- Al capturar una propiedad se siembra **una fila «Otros, por detallar»** con el
  estimado grueso. Esa fila YA es el presupuesto.
- `m² × $/m²` deja de ser una fórmula que compite y se vuelve **una calculadora**
  para llegar al primer número. El resultado vive en el presupuesto, no en un
  campo paralelo.
- Nunca hay dos respuestas vivas, en ninguna etapa, ni por un instante — y no
  porque una gane, sino porque nunca hubo dos.
- **Sin gate de etapa.** El presupuesto acompaña a la propiedad como el desglose de
  costos, no como una herramienta que se abre (a diferencia de procesos y reparto).

De las tres cifras, la que alimenta `totalInvestment` es **presupuestado** — el
plan. `comprometido` y `pagado` son ejecución contra ese plan y generan métricas
NUEVAS (avance de obra en dinero); nunca redefinen la inversión.

### Consecuencias sobre las columnas de hoy

- **`sqm_construction` sobrevive intacto.** Es metraje físico, no costo; lo usan el
  analizador de mercado y el PDF, indiferentes a lo que cueste la obra.
- **`construction_cost_per_sqm` deja de capturarse** y pasa a derivarse
  (presupuesto ÷ metraje). Es el mismo movimiento que la 027 hizo con la inversión
  capturada: un campo menos que mantener y uno menos que pueda contradecir a otro.
  Dejarlo vivo pero ignorado sería recrear el bug «NO SE USA» que se arregló hoy.
- **`construction_overhead` queda sin resolver** — ver preguntas abiertas.

### Dos correcciones que vinieron de Codex y se adoptan

**La fila «otros» se decrementa sola, y el total no crece al detallar.**
*Detallar no crea costo, solo lo distribuye.* Si repartes $300k entre cocina y
fachada, «otros» no es una opinión: es el remanente. Dejarlo editable a mano
convierte una resta determinista en una segunda captura, y ahí nace el descuadre.
Si de verdad creció el alcance, eso es **otra operación** (aumentar el
presupuesto); mezclarla con "detallar" las vuelve indistinguibles.

**No se congela ningún baseline.** Era redundante: la proyección original ya queda
visible como historia. El baseline ya existe, solo hay que no borrarlo.

**Cuando lo pagado supera lo presupuestado** —lo normal en obra, no la excepción—
se muestra la variación por partida y en total. No se esconde, no se bloquea, y el
presupuestado **no se corrige solo** para que empate: el presupuesto era un plan,
el pago es un hecho, y la información útil es la brecha.

## El catálogo que aprende

### La doctrina correcta ya existe en el repo, y es para dinero

La referencia en vivo de las plantillas de proceso **es la excepción, no la regla** —
y es la excepción justo en el único subsistema cuyo objeto no es dinero. Para dinero
el repo ya tiene dos patrones mejores:

- **`remodel_costs`**: catálogo con `valid_from` / `valid_until` / `source`. Un precio
  no se edita: se le pone fecha de fin y se inserta el nuevo, con procedencia. Es
  literalmente «el catálogo que mejora sin borrar lo que fue verdad».
- **`analysis_snapshots`**: copia congelada de insumos, supuestos y hasta la identidad
  de la evidencia (`comparable_ids`).

**El presupuesto copia al instanciar.** Cada renglón nace con su propio nombre,
unidad, cantidad y precio; `item_id` apunta al catálogo con `ON DELETE SET NULL` —
**procedencia, no dependencia**. Editar el catálogo nunca toca un presupuesto ya
capturado.

### Ninguna cifra total se guarda

`presupuestado = cantidad × precio_unitario`. `pagado = SUM(pagos)`. Siempre
derivados. Guardar un `paid_amount` sería el antipatrón que el glosario ya declaró
muerto: *"Ya no se captura ningún total."*

### `closed_at` es la pieza de la que depende todo

Sin ella, $50,000 pagados pueden ser un anticipo o el costo final, y nada distingue
uno de otro. **La historia de precios solo lee renglones cerrados.** Contar anticipos
la envenena en silencio: precios sistemáticamente bajos, sin que nada se vea roto.

### Los precios se aprenden de lo PAGADO, nunca de lo presupuestado

Sugerir desde el presupuestado histórico es un bucle de autoconfirmación:
presupuestas $1,000 → el catálogo aprende $1,000 → la próxima vez sugiere $1,000. El
catálogo repetiría para siempre una suposición que alguien hizo una vez y jamás
tocaría la realidad.

**Pero el presupuestado se guarda, porque su diferencia es el hallazgo.** El sesgo
vale más que el precio unitario mismo, y con tres obras ya es accionable:

> *"Tu presupuesto de instalaciones se queda 18% corto, en 4 de 4 obras."*

Lo que se ve al agregar un renglón — nunca la cifra sola:

```
Colocación de piso cerámico · m²
  Sugerido    $1,180 /m²      mediana de 4 obras cerradas
  Rango       $980 – $1,450
  Última vez  sep-2026 · Casa Modesto 415 · Acabados del Norte · $1,210
  Sesgo       lo presupuestado quedó 12% abajo de lo pagado (4 de 4)
```

**Mediana, no promedio**: con tres obras un renglón atípico destruye un promedio. Y
**la historia es una VISTA, no una tabla** — no hay nada que sincronizar, así que no
se puede desincronizar.

### El catálogo se pudre si no se cuida al escribir

Inventar una partida no debe costar nada: se crea a mano con `item_id = NULL` dentro
de un capítulo. Obligar a pasar por el catálogo primero es la forma más rápida de que
nadie use el módulo. **Es exactamente el hueco que procesos nunca resolvió**: ahí,
agregar algo a una obra obliga a editar la plantilla de todas.

Pero sin deduplicación al teclear, en seis obras hay «Piso cerámico», «Colocación
piso cerámico» y «Piso ceramico 60x60» como tres partidas distintas, y la historia de
precios queda partida en tres. Un aviso al escribir —*"¿es la misma que X del
catálogo?"*— **es la única pieza de interfaz que evita que el catálogo se pudra**, y
es barata.

**Promover es explícito y con un clic**, desde una cola ordenada por frecuencia. Al
promover se religan hacia atrás todos los renglones del grupo: la partida nace al
catálogo **ya sabiendo lo que cuesta**. Automático no: sin curador, un catálogo que
crece solo se llena de duplicados casi iguales, y el problema no es agregar, es
fusionar. La máquina ordena, el humano decide.

### Una plantilla es un presupuesto sin propiedad

Copiar es **una** operación usada tres veces: arrancar desde plantilla, arrancar desde
otra obra, guardar ésta como plantilla. Un solo camino de código. Se pueden tener
«Remodelación casa antigua», «Obra nueva» y «Adecuación de local» sin una línea extra.

**Composición de bloques, no.** Es lo que hace procesos con `source_template_id`, y
ahí se ve el costo: la expansión está truncada a un solo nivel, más un detector de
ciclos completo. Arrancar desde otra obra y borrar tres renglones cuesta treinta
segundos y cero código.

## Tres defectos latentes encontrados de paso

Ninguno bloquea este feature; los tres son del mismo tipo —una garantía que se cree
tener y no se tiene— y conviene saberlos.

1. **La cascada de plantillas era evitable.** `process_instances.template_id` **es
   nullable**: el FK pudo haber sido `ON DELETE SET NULL` y las instancias habrían
   sobrevivido huérfanas pero íntegras. Se eligió `CASCADE`. Eso mueve el hallazgo de
   «decisión discutible» a «descuido».
2. **`cotizaciones.is_selected` no tiene unicidad en la base.** Los índices son
   `pkey`, `node_state` y `proveedor` — ninguno único sobre la selección. La regla
   «una sola seleccionada» vive en dos `UPDATE` de código sin transacción explícita.
   Es la razón para NO leer la cotización seleccionada como fuente del monto
   comprometido en v1.
3. **El congelamiento de duraciones solo existe en la interfaz.**
   `durationLockedAt` es un campo de paso en el API —sin validación que rechace un
   cambio— y el bloqueo es un `disabled` en el front. Un congelamiento que vive en la
   UI no es un congelamiento.

## Invariantes que cualquier diseño debe respetar

1. **Una sola fórmula sin ramas para `totalInvestment`.** Dos maneras de calcular
   un número es dos números (`docs/glosario.md` §4).
2. **Ausente = 0; suma 0 = «nada capturado» → se imprime «—»**, nunca $0.
3. **`sqm_construction` es metraje físico y sobrevive intacto** — lo usan el
   analizador de mercado y el PDF, independientes del costo.
4. **`construction_cost_per_sqm` es precio unitario compuesto** — es justo lo que un
   presupuesto por partidas no tiene. Candidato a re-derivarse (suma ÷ metraje).
5. **Overhead: un 0 capturado es identidad, nunca ×0** — multiplicar por cero
   borraría obra que alguien sí capturó. Hay un test que lo fija.
6. **Vocabulario muerto que no debe resucitar**: `investmentBasis`,
   `totalInvestmentCaptured`.
7. **Familia de borrado**: el presupuesto pertenece a la de RESTRICT con 422
   legible (como `profit_split_config`), no a la de CASCADE silencioso. Perder
   captura manual sin avisar es perder trabajo real.

## Lo que NO entra en la primera versión

- Layout de tarjetas para teléfono. Sería el primer breakpoint responsivo de toda
  la app; el colapso de capítulos ya reduce la vista inicial a 5 renglones.
- Reordenamiento por arrastre: no existe en ningún lado del repo.
- Centavos en precios unitarios. Toda la app redondea a pesos enteros; romper esa
  convención en una pantalla es peor que la imprecisión.
- Retenciones, IVA, estimaciones de obra, órdenes de cambio como entidad propia.
- Que el catálogo sugiera precios automáticamente. **Pero los datos que lo harán
  posible se capturan desde el día uno** — obra, fecha, proveedor, cantidad,
  unidad, pagado. Esa capacidad no se reconstruye después.

## El overhead — decidido, con la puerta abierta a revertirlo

**Decisión tomada (Ed puede tumbarla):** el overhead se aplica **una sola vez, al
sembrar**, y queda dentro del número.

Hoy la fórmula es `m² × $/m² × 1.3`; ese 30% de indirectos ya vive dentro de la
cifra. Cuando esa cifra se convierte en la fila «Otros, por detallar», el
multiplicador ya cumplió su función y **no se vuelve a aplicar jamás**, porque desde
ahí la suma del presupuesto es el costo.

Metraje, precio por m² y overhead quedan los tres como **entradas de una
calculadora** que produce el primer renglón, no como campos que sigan alimentando
nada. El riesgo de inflar 30% en silencio desaparece por construcción.

Desglosar los indirectos en su propio capítulo es una decisión por obra, no una regla
del sistema. La plantilla por omisión lo ofrecerá.

## Preguntas abiertas

**1. ¿Cuándo se «cierra» una partida — al último pago, al recibir el trabajo?**
Define el gatillo de `closed_at`, del que depende toda la historia de precios. **Si
las partidas nunca se cierran, el catálogo nunca aprende.** Conviene que el cierre
sea automático al marcar el último pago como finiquito, no un botón aparte que se
olvide.

**~~3. ¿Hay presupuestos de obras pasadas en Excel?~~** CONTESTADA: no hay. El
catálogo arranca vacío y empieza a sugerir precios desde la tercera obra cerrada.
Consecuencia: la deduplicación al escribir importa MÁS, no menos — sin historia que
importar, la única fuente del catálogo es lo que se teclee de aquí en adelante, y un
catálogo partido en tres variantes del mismo nombre nunca llega a tener tres
observaciones de nada.

**4. ¿Las cantidades se miden (m², ml, pza) o casi todo se contrata «a lote»?** Si
domina el lote, el aprendizaje se degrada a "cuánto costó este tipo de trabajo la
última vez" — sirve, pero la interfaz cambia.

**5. ¿Los capítulos que usas coinciden con las categorías de proveedores que ya
cargaste?** Si sí, se siembran ligados y el filtro del selector funciona desde el
primer día.

**6. Cuando una partida se paga de más, ¿el sistema lo señala y ya, o exige una nota
explicando por qué?**

**7. ¿Tiene sentido separar precios por zona dentro del centro de Monterrey?** Si sí,
hay que agregar `zone_id` a `properties` — hoy solo lo tienen `comparables` y
`remodel_costs`, así que la historia se rebana por estrategia y tipo de activo, no
por zona.

## Plan por fases

Cada fase deja la rama verde y con evidencia local. Ejecución con subagentes
(implementador → revisión de conformidad → revisión de calidad), como el resto de
las entregas de este proyecto.

### Fase 1 — Datos
- Migración con las cinco tablas: `budget_chapters`, `budget_items` (catálogo);
  `budgets`, `budget_lines`, `budget_line_payments` (la obra).
- **Siembra de las 18 propiedades**: una fila «Otros, por detallar» con el costo de
  obra que hoy produce la fórmula, overhead ya aplicado.
- `construction_cost_per_sqm` deja de ser insumo y pasa a derivarse (suma ÷ metraje).
  `sqm_construction` sobrevive intacto; `construction_overhead` se retira como
  multiplicador vivo.
- **Prueba de no-movimiento sobre las 18**, como en la 027: ningún costo de obra ni
  ninguna inversión total cambia un peso.
- Vista `budget_price_observations` (solo renglones cerrados).

### Fase 2 — Backend
- Capa de dominio del presupuesto; `totalInvestment` pasa a leer la suma
  presupuestada. **Sin ramas**: la suma es la única fuente en toda etapa.
- Endpoints por renglón, capítulo y pago. Cada respuesta devuelve
  `{línea, property}` para que la ficha se refresque de una sola vez.
- Métricas nuevas: obra comprometida, obra pagada, y su variación contra lo
  presupuestado.
- Gate de borrado: el presupuesto entra a la familia RESTRICT con 422 legible.

### Fase 3 — La pestaña
- Cuarta pestaña junto a MAPA / FOTOS / PLANOS, **sin gate de etapa**.
- Tabla jerárquica componiendo lo que ya existe: colapso y rollup de
  `ProcesoInstanceDetail`, celdas siempre activas con autosave, selector de proveedor
  filtrado por categoría.
- «Otros» como **residuo automático**: el total no se mueve al detallar.
- Móvil: capítulos colapsados por omisión, montos apilados en una celda, scroll
  horizontal local. Sin layout de tarjetas.

### Fase 4 — Catálogo y plantillas
- CRUD del catálogo con baja lógica (`is_active`), nunca borrado.
- Copia al instanciar; `item_id` como procedencia con `ON DELETE SET NULL`.
- Renglón suelto (`item_id NULL`) sin fricción — el hueco que procesos nunca llenó.
- **Deduplicación al escribir** (`pg_trgm`): la única pieza que evita que el catálogo
  se pudra.
- Cola de promoción por frecuencia, con religado hacia atrás de la historia.
- Una plantilla es un presupuesto sin propiedad. Sin composición de bloques.

### Fase 5 — Precios que aprenden
- Sugerencia por mediana de renglones cerrados, con rango, última vez y **el sesgo
  presupuestado-vs-pagado**.
- Cruce con `rating_calidad` para contestar quién cobra menos entre los que trabajan
  bien.

### Fase 6 — Vocabulario y documentos
- Entradas nuevas en `docs/glosario.md` con las cuatro cifras de obra bien
  distinguidas, y los términos muertos que no deben resucitar.
- `use-refigan.md` (contrato MCP) y verificación de que el PDF y el term sheet siguen
  correctos — ambos leen totales ya sumados, así que deberían ser inmunes.

## Trabajo independiente de este feature

La cascada de plantillas (`ON DELETE CASCADE` evitable, sin confirmación en la UI)
no bloquea el presupuesto —que no reusa esa maquinaria— pero se vuelve peligrosa el
día que se empiecen a usar procesos de obra. Hoy hay 0 instancias, así que arreglarlo
ahora no cuesta migración de datos. Decisión de Ed sobre cuándo.
