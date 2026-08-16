# Copia proporcional del presupuesto

Decisión (2026-08-16, con Ed): al copiar un presupuesto, poder hacerlo
**proporcional** al tamaño de la obra destino, no solo idéntico. Un popup
pregunta cuál de las dos.

## La idea en una línea

**Copiar proporcional es copiar la FORMA del presupuesto, dimensionada al costo
que esperas de ESTA obra.** El desglose de la obra de al lado te sirve; su
tamaño no.

El costo objetivo es `T = m² de construcción × $/m² de desarrollo` del DESTINO
— no una razón de metrajes. Dos obras del mismo tamaño pueden construirse a
niveles de costo distintos, y el metraje solo no lo captura.

**T NO se guarda en ningún lado.** El total sigue siendo siempre la suma de los
renglones: `set_total` mueve el RESIDUO para que la suma dé T (`budget_db.py:800`
— «Ajusta el TOTAL de la obra presupuestada, moviendo el residuo»). Ninguna
cifra total se almacena, igual que en todo el resto del módulo.

## La aritmética, y por qué cierra exacto

    T = m² destino × $/m² destino      el costo objetivo
    F = partidas FIJAS del origen      no escalan
    S = partidas PROPORCIONALES        escalan
    R = residuo del origen             lo que al origen le falta por detallar

    factor = (T − F) / (S + R)

Las fijas entran con su monto original; las proporcionales se multiplican por
el factor; el residuo del destino aterriza solo en `R × factor` vía
`_settle_residual`. La suma da **exactamente T**:

    factor·S + F + factor·R  =  factor·(S+R) + F  =  (T−F) + F  =  T

Incluir `R` en el denominador es lo que hace que el destino herede también
**cuánto le falta por detallar**: si el origen estaba a medio detallar, el
destino también. Un origen 100% detallado deja el residuo del destino en cero,
sin caso especial. (Dato real: Vicente Guerrero está 95% detallado —
$1,424,192 detallados y $71,808 de residuo — así que en la práctica esto casi
siempre deja un residuo chico, no cero.)

**Guarda obligatoria**: si `T ≤ F`, las partidas fijas del origen ya no caben en
el presupuesto objetivo. Error legible con los dos números («las fijas suman
$850k y el objetivo es $600k»), nunca un factor negativo.

## Se descompone en dos operaciones que YA existen

1. **Mover el total a T** — `set_total`, el residuo absorbe. Es «esto cambia
   cuánto va a costar la obra».
2. **Detallar** — copiar los renglones escalados; le comen al residuo y el total
   no se mueve.

El repo ya distingue esas dos a propósito (`set_total` existe aparte «justamente
para que se distinga de detallar»). Copiar proporcional no inventa una tercera:
es las dos en orden.

## Verificado en datos reales, y por qué cambia el diseño

- [x] **Los 11 renglones reales usan unidad `lote`, cantidad entre 0 y 1.** Nadie mide en m² ni piezas: todo es suma alzada. Por eso escalar la CANTIDAD —lo obvio— produciría «1.5 lote» y dejaría sin sentido el precio unitario de `budget_price_observations`.
- [x] **Solo 3 de 5 propiedades tienen `sqm_construction`.** «Sin metraje» no es un borde: es el 40% de hoy.
- [x] `sqmConstruction: number | null` ya viaja al frontend (`types.ts:151`) → el preview se calcula en el cliente sin endpoint nuevo.
- [x] `money0` (pesos enteros) y `frac4` existen en `app/api/finance/quantize.py`.
- [x] `_norm` (`lower(btrim)`) ya existe y sirve para comparar la unidad sin pelearse con «Lote»/«LOTE».
- [x] Próxima migración libre: **045**.

## Las cuatro decisiones

1. **Qué escala, según la unidad.** Unidad `lote` → escala el PRECIO (sigue leyéndose «1 lote», solo más caro). Cualquier otra unidad (m², ml, pza) → escala la CANTIDAD, porque el precio por m² es un hecho de mercado que no cambia porque la casa sea más grande. Un solo condicional, y no se corrompe el día que alguien mida.
2. **Faltan insumos → NO se puede copiar proporcional, y se dice cuál falta.** El destino necesita `m² de construcción` Y `$/m² de desarrollo`. El popup los marca como faltantes y el usuario los captura ahí mismo antes de poder continuar — no se adivina ninguno ni se cae a copia directa en silencio.
3. **Hay partidas que no escalan** (permisos, licencias, conexiones).
4. **La marca vive en el RENGLÓN, guardada, y VIAJA con la copia.** «Los permisos no crecen con la obra» es verdad de la partida, no de una copia — preguntarlo en cada copia sería preguntar lo mismo para siempre. Y al viajar, un presupuesto copiado nace sabiendo cuáles no escalan: es aprender sin catálogo.
5. **Se llama PROPORCIONAL, no «escala»** — en la columna de la tabla y en el popup. Un solo vocabulario para el mismo concepto.

## Backend

- [x] Migración `045_budget_line_proporcional.sql`: `budget_lines.is_proportional BOOLEAN NOT NULL DEFAULT TRUE`. En positivo y con default TRUE para que la mayoría no capture nada y no haya dobles negaciones en los queries. `IF NOT EXISTS` en todo CREATE, **también en el bloque `down`** (ver [[patrio-migraciones-lint-idempotencia]] — es lo que tumbó el CI del PR #42).
- [x] Añadir `is_proportional` a `_COPIED_LINE_COLUMNS`: es parte de la FORMA del plan, igual que `supplier_category_id`.
- [x] `apply_budget` acepta el modo proporcional con el `$/m²` objetivo del destino. **El factor lo calcula el SERVIDOR** — un factor arbitrario mandado por el cliente vuelve la garantía imposible de verificar. Reusar `calculator_estimate` y `set_total`, que ya existen y ya hacen esto para la calculadora de la ficha.
- [x] **RESUELTO: `constructionCostPerSqm` es DERIVADO** (`properties_db.py:379-381` — «presupuesto ÷ metraje, se publica para mostrarse y nada la vuelve a leer para calcular dinero») y **NO es campo escribible** (`:155` — «dejaron de ser insumos»). Solo sobrevive como entrada de la CALCULADORA de un tiro (`_CALCULATOR_FIELDS`, `:734`). Por lo tanto el `$/m²` objetivo del popup es un insumo TRANSITORIO del mismo tipo que ya usa la ficha — no se guarda, y no hay que crear un campo nuevo ni resucitar la columna. El popup lo pre-llena con el derivado del destino si tiene presupuesto, y vacío si no.
- [x] Si falta `m²` o `$/m²` del destino, **422 legible que diga cuál de los dos falta**, no un genérico.
- [x] El escalado se aplica en el mismo `INSERT ... SELECT` de la CTE (no en Python): `unit_price` × factor con `money0` si la unidad normalizada es `lote`; si no, `quantity` × factor redondeada a las 3 decimales de la columna (`NUMERIC(14,3)`; redondear a 4 sería redondear dos veces). Los renglones con `is_proportional = FALSE` pasan sin tocar.
- [x] Guarda `T ≤ F` con mensaje que traiga los dos montos.
- [x] **La dedup no cambia**: un renglón que ya existe en el destino se SALTA, no se escala ni se actualiza. La garantía central del PR #42 sigue intacta.
- [x] Tests: escala una obra al doble; renglón `lote` mueve precio y no cantidad; renglón en m² mueve cantidad y no precio; renglón marcado fijo no se mueve; sin metraje → 422 que nombra la propiedad; el residuo cuadra y `budgetIncrease` se comporta.

## Frontend

- [x] Columna **PROPORCIONAL** por renglón en la tabla del presupuesto, visible (no escondida en el popup: si solo apareciera al copiar, nunca se captura hasta que ya llevas prisa). Patrón de celda siempre activa con autoguardado que ya usa el panel.
- [x] Popup al copiar, en **las dos direcciones** (`COPIAR DE OTRA OBRA` y `COPIAR A OTRAS OBRAS`): elegir **directo** o **proporcional**. En proporcional, capturar `m²` y `$/m²` del destino, con el costo objetivo `T` calculándose en vivo mientras se teclea.
- [x] El preview debe apartar las partidas fijas del monto que escala, o miente sobre lo que va a pasar.
- [x] En PUSH a varias obras, **cada destino tiene su propio T** — un renglón por obra destino con sus dos campos y su total. Las obras a las que les falte un insumo quedan bloqueadas con el motivo, sin impedir copiar a las demás.
- [x] El metraje que falte se captura EN EL POPUP y se guarda en la ficha de esa obra (`updateProperty`, `sqmConstruction` ya es escribible) **antes** de copiarle — es el momento en que a alguien le importa el dato, en vez de mandarlo a otra pantalla. La caja dice que se guarda: no es un dato de la copia. Si ese guardado falla, esa obra se reporta con su motivo y las demás se copian igual. El bloqueo se queda solo para la caja vacía.
- [x] Tests de componente para ambas direcciones y para el caso sin metraje.

## Verificación final
- [ ] `pytest` + `tsc --noEmit` + `vitest` verdes
- [ ] Lint de idempotencia de migraciones corrido LOCAL antes de pushear
- [ ] `dbmate up` desde cero + round-trip `down`/`up`
- [ ] Contra el stack vivo: copiar proporcional de una obra a otra de distinto metraje y verificar a mano que los totales dan lo que promete el popup
- [ ] `db/schema.sql` regenerado con el dbmate de Docker
