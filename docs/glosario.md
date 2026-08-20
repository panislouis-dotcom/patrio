# Glosario del dominio

Cada concepto tiene **un** nombre. Ese nombre se usa igual en la ficha, la tabla,
el modal, el PDF, la carta de términos, los mensajes de error y las skills.

La regla que ordena todo lo demás: **una fórmula, un nombre**. Si dos cifras
salen de la misma función alimentada con salidas distintas, comparten familia de
nombre y se distinguen por la etapa: *proyectada* / *no realizada* / *realizada*
para la ganancia, *presupuestada* / *comprometida* / *pagada* para la obra.
Si dos cifras salen de fórmulas distintas, no pueden compartir nombre.

Cada entrada dice qué ES y qué NO es. La segunda mitad es la que evita las
regresiones: casi todos los hallazgos de la auditoría fueron etiquetas correctas
puestas sobre el campo equivocado.

---

## 1. Ciclo de vida

Una propiedad es una fila que avanza. `status` es la etapa, y solo se mueve por
`POST /transition`.

| Código | Nombre visible | Qué es | Qué NO es |
|---|---|---|---|
| `prospecto` | Prospecto | Detectada y modelada. Nadie se comprometió a nada. | No es un trato; el modelo es una hipótesis. |
| `oferta` | Oferta | La firma está pujando. Desde aquí se levanta capital. | No es una compra: todavía no hay adquisición. |
| `desarrollo` | Desarrollo | Comprada. Obra en curso (incluye estabilización). | No es «en obra» a secas: una propiedad comprada y quieta también está aquí. |
| `en_renta` | En renta | Produciendo renta real y estable. | No es «rentable»: es que se está cobrando renta. |
| `vendida` | Vendida | Vendida. **Terminal** y congelada. | No es archivable: una venta ES el track record. |
| `archivada` | Archivada | Descartada. **Terminal**, fuera del listado por omisión. Conserva la marca que tenía: archivar no vende nada. | No es una etapa del ciclo: es un cajón. |

Nunca se escribe `en_renta` en una superficie de usuario. Se escribe «En renta».

---

## 2. Insumos de captura

Lo que teclea una persona. Ninguno se deriva de otro.

### Precio de compra — `purchasePrice`
Lo que se paga por adquirir el inmueble **como está**: lote pelón o casa
terminada, sin caso especial por tipo de activo.

**NO es** el precio del terreno (ese error se llamaba `landPrice` y hacía que
una casa construida se contara dos veces). **NO es** el precio del anuncio menos
nada: el precio del anuncio *es* el precio de compra.

Cuando de una propiedad vieja lo único que se sabe es un total a secas —«costó
$9.5M todo incluido»— ese total se teclea **aquí**, con costos de adquisición en
`0`. Es el único lugar donde se captura una cifra all-in, y es la razón por la
que la inversión total (§4) no necesita casilla propia.

### Metros de obra a ejecutar — `sqmConstruction`
Los metros que **tú** vas a construir o remodelar. Metraje **físico**: lo leen el
analizador de mercado y el PDF, a los que no les importa cuánto cueste la obra.

**NO son** los metros que el inmueble ya tiene construidos. Lo ya edificado ya
se pagó dentro del precio de compra y no vuelve a aparecer.

**NO le ponen precio a nada.** Este metraje ya no se multiplica por nada para
llegar al costo de obra; ese costo se captura renglón por renglón, aquí abajo.

### Presupuesto de obra — los renglones de `budget_lines`
Lo que la obra va a costar, capturado partida por partida —`cantidad × precio
unitario`— en la pestaña PRESUPUESTO, con dos niveles (capítulo → partida). Es
el **único** lugar donde se captura el costo de la obra, y su suma es la obra
presupuestada (§4).

**NO es** una herramienta que se abra en Desarrollo, **y no tiene compuerta de
etapa**: nace con la propiedad, en la misma transacción que su fila, con un solo
renglón —«Otros, por detallar»— que trae el estimado grueso. Hay que poder
presupuestar antes de ofertar.

**NO guarda ningún total.** Presupuestado, comprometido y pagado se derivan cada
vez que alguien pregunta, igual que la inversión total: un total almacenado es
un segundo lugar donde vive el mismo peso, y dos lugares terminan diciendo cosas
distintas.

**Detallar no crea costo, lo distribuye.** Cuando una partida nueva se lleva
$300k, «Otros, por detallar» baja $300k y el costo de obra no se mueve un peso.
El residuo no se teclea: es el remanente. Si de verdad creció el alcance eso es
**otra operación** —ajustar el total del presupuesto— y existe aparte justamente
para que las dos se distingan.

### Permisos — `permitsCost` · Subdivisión — `subdivisionCost`
Costos directos capturados aparte, en pesos.

### Venta proyectada — `projectedSale`
El precio de salida que modela el underwriting.

**NO es** una valuación (nadie la hizo), **NO es** un precio de venta (no ha
ocurrido) y **NO se llama** «Valuación proyectada» — ese nombre mezcla las tres.
Un `0` significa «sin venta modelada», no un precio de cero.

### Renta mensual estimada — `rentMonthlyProjected`
Lo que el underwriting estima cobrar. Sobrevive a la renta real para poder
compararlas.

### Renta mensual cobrada — `rentMonthlyActual`
Lo que efectivamente se cobra. Se captura al entrar a En renta y **nunca** se
prellena con la estimada.

En ambas: vacío = no capturada. Un `0` no se almacena — «no renta» se expresa
dejándola vacía.

---

## 3. Supuestos

**Dos** números que **siempre** tienen un valor vigente: el que capturó una
persona, o el que aplica el modelo. El payload publica el valor vigente bajo su
llave y su procedencia en `assumptions`.

| Nombre canónico | Campo | Omisión | Qué es |
|---|---|---|---|
| Costos de adquisición (%) | `acquisitionCostPct` | 6.5% | Fracción **aditiva** sobre el precio de compra. |
| Plazo proyectado | `holdMonths` | 12 meses | Meses de compra a salida que asume el modelo. |

Procedencia (`assumptions[x].source`): `captured` → **«Capturado»**;
`default` → **«Supuesto por omisión»**.

**NO son** costos: un supuesto nunca falta, solo cambia de origen. Por eso la
compuerta de Desarrollo no los exige.

Eran tres. **El overhead de obra dejó de ser un supuesto y ya no se publica**: no
multiplica ninguna cifra viva. Se aplica una sola vez, al sembrar el primer
renglón del presupuesto, y desde ahí vive dentro del importe (§4). Un supuesto
que no mueve dinero no es un supuesto: es un número que se puede leer, comparar
y hasta editar sin que nada cambie — el defecto «no se usa» con otro nombre.

---

## 4. Costos derivados, obra e inversión

### Costos de adquisición — `acquisitionCosts`
`precio de compra × costos de adquisición (%)`. ISAI, notario, avalúo.

**NO es** el precio de compra ni lo incluye.

### Total de adquisición — `acquisitionTotal`
`precio de compra + costos de adquisición`. Lo que cuesta quedarse con el
inmueble antes de tocarlo.

### La obra: cuatro cifras, y solo una es capital

El costo de obra **es la suma del presupuesto**, en toda etapa y sin una sola
rama. Las otras tres miden la ejecución contra ese plan, son métricas nuevas y
**ninguna redefine la inversión**: lo que la obra va a costar y lo que ya se pagó
de ella son dos preguntas distintas.

| Nombre canónico | Campo | Qué es | Qué NO es |
|---|---|---|---|
| Obra presupuestada | `constructionBudgeted` | La suma de los renglones (`cantidad × precio unitario`). El plan — y **el único costo de obra que existe**: es la barra del desglose y lo único que entra a la inversión total. | No es una fórmula ni un campo que alguien teclee: se mueve capturando partidas o ajustando el total del presupuesto. No es «lo que llevamos gastado». |
| Obra comprometida | `constructionCommitted` | Lo ya **contratado** con un proveedor y todavía no pagado: la suma de los montos comprometidos por renglón. | No es dinero que salió del banco. Y no es una cotización: una cotización es una oferta, un compromiso es una firma. |
| Obra pagada | `constructionPaid` | Lo que **salió del banco**: la suma de los pagos capturados por renglón. | No es el costo de la obra, ni lo corrige. Un pago no toca lo presupuestado. |
| Comprometido vs presupuesto | `constructionCommittedVariance` | `obra comprometida − obra presupuestada`. | No es un error a resolver: es la brecha, y es la información. |
| Pagado vs presupuesto | `constructionPaidVariance` | `obra pagada − obra presupuestada`. | Lo mismo, en la segunda etapa de la ejecución. |

Las dos variaciones son **la misma resta alimentada con dos hechos distintos**,
así que comparten familia de nombre y se distinguen por la etapa. El signo se lee
siempre igual: **positivo es sobrecosto** —se firmó o se pagó más de lo
planeado—, negativo es que todavía no se llega al plan.

Que lo pagado rebase lo presupuestado es lo normal en obra, no la excepción. Se
muestra, no se bloquea, y **lo presupuestado no se corrige solo para que empate**:
el presupuesto era un plan, el pago es un hecho, y borrar la diferencia entre los
dos es borrar lo único que se aprende de la obra.

**Vacío.** La obra presupuestada cae a **0** —«nada capturado»—, porque es un
sumando de la inversión y un sumando siempre tiene que ser un número. La
comprometida y la pagada se quedan **vacías**: que nadie haya firmado nada no es
«$0 comprometido», y un cero ahí se leería como un hecho. Sus variaciones
desaparecen con ellas.

### Costo por m² de obra — `constructionCostPerSqm`
`obra presupuestada ÷ metros de obra a ejecutar`. Vacío sin metraje: dividir
entre cero no da «$0/m²», no da nada.

Donde el espacio manda se abrevia **«Obra/m²»**, junto a las otras cifras por
metro. La abreviatura es la misma concesión que «s/ venta» en el cap rate
proyectado (§8): se acorta el nombre, no se cambia.

**Ya NO se captura**, y no está entre los campos escribibles del API. Fue un
insumo, y mientras lo fue era la segunda respuesta a cuánto cuesta la obra. Hoy
es un **resultado** de haber presupuestado: se publica para mostrarse y nada lo
vuelve a leer para calcular dinero. El costo de obra se cambia capturando
partidas, no tecleando un precio unitario compuesto que un desglose por partidas
justamente no tiene.

### La fórmula dejó de ser fuente y quedó como calculadora

`m² × $/m² × overhead` fue el costo de obra. Ya no lo es. Hoy es una
**calculadora**: al dar de alta una propiedad produce el importe del primer
renglón del presupuesto —«Otros, por detallar»— y ahí termina su trabajo. Desde
ese instante manda la suma.

Sus tres entradas corrieron suertes distintas, y conviene saber cuál es cuál:

| Entrada | Qué le pasó |
|---|---|
| `sqmConstruction` | **Sobrevive intacto**, como metraje físico (§2). Lo leen el analizador de mercado y el PDF, y es el divisor del costo por m² derivado. Ya no le pone precio a nada. |
| `constructionCostPerSqm` | **Pasó a derivarse**: presupuesto ÷ metraje. Dejó de capturarse. |
| Overhead de obra | **Se aplica una sola vez, al sembrar**, y queda dentro del importe. Dejó de ser un supuesto publicado (§3). |

Las tres siguen entrando por la pantalla de alta —el overhead con su ×1.3 por
omisión si nadie lo teclea— y la calculadora se puede volver a correr después: el
resultado entra por la operación que ajusta el total del presupuesto, que mueve
el renglón residual. **Ninguna de las tres se guarda como insumo del costo de
obra**; solo el metraje se guarda, y se guarda por ser metraje.

**Volver a aplicar el overhead es la trampa central de este subsistema.**
Inflaría un 30% el costo de obra de cada propiedad sin un test rojo, sin un
mensaje de error y sin nada roto a la vista: solo números más grandes que parecen
plausibles. Por eso el módulo de underwriting ya no conoce la palabra ni acepta
un multiplicador que pudiera volver a aplicar.

#### Por qué esto no abre una segunda fuente

Tener a la vez una fórmula y una suma parece violar la regla que ordena este
capítulo —una sola manera de calcular la inversión, sin ramas—. No la viola, y la
razón es precisa: **la fórmula nunca fue una segunda fuente, porque no coexiste
con la suma.** Produce el primer renglón y se retira. En ningún instante —ni en
Prospecto, ni el segundo después de la captura— hay dos respuestas vivas a
«¿cuánto va a costar la obra?».

Tampoco existe la rama *«usa el presupuesto si existe, si no la fórmula»*, que
sería la misma disyunción disfrazada de conveniencia: **el presupuesto existe
siempre.** Nace con la propiedad, en la misma transacción que su fila, y la
migración que lo introdujo le sembró uno a cada propiedad que ya existía, al
peso. Por eso el costo de obra no tiene que preguntar en qué etapa está ni si hay
presupuesto: no hay caso en que no lo haya.

El contraste que fija la diferencia es con **la renta estimada y la renta
cobrada** (§2), que sí coexisten para siempre:

| | |
|---|---|
| Renta estimada ↔ renta cobrada | **Dos hechos distintos.** Lo que el underwriting supuso, y lo que el inquilino paga. Coexisten porque compararlos es el aprendizaje, y ninguno sustituye al otro. |
| Fórmula ↔ suma del presupuesto | **Un hecho a dos resoluciones.** Los dos son planes del mismo gasto futuro, uno grueso y otro detallado. El mismo concepto medido dos veces es duplicación — y es lo que esta regla mata. |

Obra presupuestada ↔ obra pagada es del **primer** tipo, no del segundo: son dos
hechos distintos —lo que la obra va a costar y lo que ya salió del banco— y por
eso pueden y deben coexistir, igual que las dos rentas.

### Inversión total — `totalInvestment`
**La** base de capital: todo el dinero que entra. Es el denominador de toda
ganancia y todo ROI. Sobrevive a la venta — es historia, no proyección.

Se calcula **siempre** igual, sin ramas: la suma de los cinco costos del
desglose.

```
inversión total = precio de compra × (1 + costos de adquisición %)
                + permisos + subdivisión
                + obra presupuestada
```

El último término es la suma del presupuesto, en toda etapa y sin preguntar nada.
Fue `m² × $/m² × overhead`; esa fórmula sigue existiendo, pero como calculadora
que produce el primer renglón y no como una segunda respuesta que pudiera
ganarle a la suma (arriba).

Un componente que nadie capturó vale `0`. No existe «desglose completo» contra
«incompleto»: la expresión corre igual con un costo o con los cinco. Si la suma
da cero —nadie capturó nada— la inversión total queda **vacía**, y se imprime
«—». Vacía no es cero.

**NO se teclea.** No hay campo de inversión total, ni en la ficha ni en el API:
escribirla es capturar sus componentes. Un total a secas se captura como precio
de compra con costos de adquisición en `0` (§2).

**NO tiene origen.** «¿De dónde salió esta cifra?» dejó de ser una pregunta: sale
del desglose, siempre. Hubo dos maneras de resolverla —la suma y una captura
manual— y con ellas un campo que decía cuál había ganado y una advertencia para
cuando no coincidían. Nada de eso existe: dos maneras de calcular un número es
dos números.

**NO es** una proyección. **NO se llama** «base de inversión» (§12).

---

## 5. Salidas

Tres números distintos con la misma unidad. Nunca se sustituyen entre sí.

| Nombre canónico | Campo | Qué es | Qué NO es |
|---|---|---|---|
| Venta proyectada | `projectedSale` | Lo que el modelo dice que se venderá. | No es un avalúo ni un hecho. |
| Valuación | `currentValuation` | Estimación de valor **con fecha de corte** (`valuationDate`). | No es un avalúo formal, no es un precio, no es un ingreso. |
| Precio de venta | `salePrice` | Lo que se cobró. Hecho cerrado. | No es una marca ni se promedia con valuaciones. |

Comprar no produce un avalúo: la valuación **no** se exige al entrar a
Desarrollo. Sin ella, la ganancia no realizada es vacía, que es la respuesta
honesta.

---

## 6. Ganancias

`gain(base, salida)` y `gain_pct(base, salida)` — una resta y una división,
alimentadas con las tres salidas de arriba. Monto y porcentaje son **la misma
cifra en dos unidades** y viajan juntos.

| Monto | Porcentaje | Dónde existe | Qué es |
|---|---|---|---|
| **Ganancia proyectada** `projectedProfit` | **Ganancia proyectada %** `projectedRoiTotal` | Siempre | Venta proyectada − inversión total. |
| **Ganancia no realizada** `unrealizedGain` | **Ganancia no realizada %** `unrealizedGainPct` | Desarrollo · En renta · Archivada | Valuación − inversión total. Todavía no se cobra. |
| **Ganancia realizada** `realizedGain` | **Ganancia realizada %** `realizedGainPct` | Vendida | Precio de venta − inversión total. |

El porcentaje es el nombre del monto con `%` pegado, y nada más: así la pareja se
lee como pareja. **Cuando los dos van juntos en la misma cifra** — «$1.5M 43.7%»,
que es como los imprime el PDF — la etiqueta es la del monto, sin `%`. El sufijo
solo aparece cuando el porcentaje va solo y necesita nombrarse a sí mismo.

«Dónde existe» no es una regla de vocabulario sino el contrato del API, y se lee
de `properties_db.metrics()`. Solo se gatea la cifra que **afirma propiedad**: la
marca (una valuación contra dinero que todavía no pusiste no es una medición) y
la salida (un precio de venta en algo que no se vendió no es un resultado). La
proyección no se apaga nunca — es contra lo que se califica el resultado, y
apagarla al vender rompía el par justo cuando se volvía comprobable.

Estos tres porcentajes son **sobre el plazo completo, sin anualizar**, y por eso
`projectedRoiTotal`, pese a su nombre de campo, no se etiqueta como ROI. Llamarlo
«ROI proyectado» produjo una confusión concreta y reportada: *«Roi esta mal porque
no se mueve cuando muevo el plazo»* — se estaba mirando esta cifra, que por
definición no depende del plazo, mientras se movía el plazo. Con «ROI = siempre
anualizado», lo que no se mueve con el plazo deja de llamarse ROI.

**Palabra prohibida: «Plusvalía».** Llegó a significar tres cosas en el mismo
documento (`unrealizedGainPct`, `projectedRoiTotal` y un agregado de portafolio)
y en la UI no aparecía ni una vez. No se usa en ninguna superficie.

### Ganancia del portafolio
Agregado del prospecto, sin campo de API:
`(ventas realizadas + valuación actual) − capital invertido`.

**NO es** una ganancia realizada: mezcla dinero cobrado con estimaciones, y por
eso el documento lo dice al pie.

---

## 7. ROI

**«ROI» significa siempre anualizado** (CAGR de la inversión total a la salida,
sobre los meses correspondientes). Sin excepción, en ninguna superficie.

| Nombre canónico | Campo | Salida | Meses |
|---|---|---|---|
| ROI proy. anual | `projectedRoi` | Venta proyectada | Plazo proyectado (`holdMonths`) |
| ROI anual | `roi` | Valuación | Adquisición → **fecha de valuación** |
| ROI real anual | `realizedRoi` | Precio de venta | Adquisición → **fecha de venta** |

Cada ROI cierra su reloj el día de su propio numerador. Un rendimiento
anualizado cuyo numerador es meses más viejo que su denominador baja solo cada
mes sin que cambie ni un dato: reporta el calendario, no el activo. Por eso
**ningún** ROI divide entre el plazo real — ese congela en la primera renta y no
es el reloj de ninguna salida.

La palabra «anual» es redundante si ROI ya significa anualizado, y se conserva
igual: previene una confusión que ya ocurrió, y eso vale su espacio.

**NO se llama ROI** a `projectedRoiTotal`, `unrealizedGainPct` ni
`realizedGainPct`: esos son ganancias sobre el plazo completo (§6). Llamarlos
«ROI proyectado» y «ROI total» fue lo que hizo que el mismo nombre designara la
cifra anual en `checks.py` y la total en el PDF.

`headlineRoi` (el ROI que ordena una lista mixta) es el de la etapa de cada
propiedad: real → anual → proyectado, el primero que exista.

---

## 8. Renta y cap rate

| Nombre canónico | Campo | Qué es |
|---|---|---|
| Renta anual estimada | `rentAnnual` | 12 × renta mensual estimada. |
| Renta anual cobrada | `rentAnnualActual` | 12 × renta mensual cobrada. |
| Cap rate proy. sobre venta | `capRate` | Renta anual **estimada** / venta proyectada. |
| Cap rate | `capRateActual` | Renta anual **cobrada** / valuación actual. |

La fórmula es el cap rate de mercado — NOI (bruto, sin descuento de gastos
operativos) sobre el valor del activo, no sobre lo que costó. Vivió un tiempo
como *yield on cost* (renta / inversión total, 2026-07 a 2026-08): quitarle a
la fórmula de la vista vieja su 30% de opex fabricado fue correcto, pero
quitarle también el denominador de valor no lo era — «yield on cost» contesta
una pregunta real, pero no es un cap rate, y llamarlo así se leía mal para
cualquiera que conociera el término (`finance/underwriting.py`).

Los dos NO comparten denominador, a propósito: `capRate` empareja la renta
**modelada** con la venta **proyectada** (la apuesta completa, de un extremo al
otro); `capRateActual` empareja la renta **cobrada** con la valuación
**actual** (lo real contra lo real — la venta proyectada sigue siendo una
apuesta de salida, no lo que la propiedad vale hoy). Forzar el mismo
denominador en los dos habría sido medir un cobro real contra un precio de
salida que sigue siendo hipotético.

Por lo mismo, la etiqueta **solo lleva denominador cuando puede haber
ambigüedad**. El proyectado sí la tiene — inversión, venta, valuación, todas
son cifras de valor plausibles — así que se escribe «Cap rate proy. sobre
venta» (o «Cap rate proy. s/ venta» donde el espacio manda, como en las
tarjetas del PDF). El real ya no la tiene una vez que la propiedad renta: la
valuación es la única cifra de valor en pantalla, y el desglose de costos
quedó atrás. Ahí «Cap rate» a secas no es la abreviatura de nada — es la
etiqueta completa, exacta, sin nada que calificar.

**NO lleva** descuento de gastos operativos: el cap rate neto de opex vive en el
analizador, que sí modela NOI.

---

## 9. Plazos

| Nombre canónico | Campo | Qué es | Qué NO es |
|---|---|---|---|
| Plazo proyectado | `holdMonths` | Supuesto: meses de compra a salida. | No es un plazo medido. |
| Plazo real | `holdMonthsActual` | Meses de la adquisición a la **primera renta**: cuánto tardó la propiedad en volverse productiva. Cae a la fecha de venta si nunca rentó, y solo sigue corriendo a hoy mientras sigue en desarrollo. | No son «meses en cartera» ni «meses de obra». Tampoco es el divisor de ningún ROI: cada uno corre a la fecha de su propio numerador. |

---

## 10. Clasificación

Dos preguntas distintas, dos columnas distintas.

**Tipo de activo** — `assetType`: qué **es** el inmueble.
`casa` Casa · `departamento` Departamento · `local` Local · `edificio` Edificio ·
`lote` Lote · `bodega` Bodega.

**Estrategia** — `strategyType`: qué se piensa **hacer** con él.
`adaptive_reuse` Reconversión · `ground_up` Obra nueva · `flip` Flip ·
`hold` Renta.

Estos valores nunca se publican crudos ni traducidos a medias: «Adaptive reuse»
y «Ground up» no son palabras del dominio y no existen en ninguna otra pantalla.

---

## 11. Calidad de datos

Cada propiedad trae `issues`: lo que le falta para estar legítimamente en su
etapa (`error`) más las advertencias de esa etapa (`warning`).

El `field` de un issue es el campo camelCase del API. Cuando se muestra al
usuario se muestra con su **nombre canónico** de este glosario, nunca el
identificador: `valuationDate` → «Fecha de valuación», jamás `VALUATIONDATE`.

Un mensaje de error dice qué hacer, no qué regla se rompió. Nunca contiene el
nombre de una restricción de Postgres, ni una columna snake_case, ni un código de
estado crudo.

---

## 12. Palabras prohibidas

| Nunca | Porque | Se dice |
|---|---|---|
| Plusvalía | Nombró tres conceptos distintos. | Ganancia no realizada % / Ganancia proyectada % / Ganancia del portafolio |
| Valuación proyectada | Mezcla valuación con venta proyectada. | Venta proyectada |
| Precio propiedad · Precio terreno | El precio es de adquirir el inmueble completo. | Precio de compra |
| Inversión desarrollo | No es un concepto del dominio, es una resta. | Obra, permisos y subdivisión |
| Obra a ejecutar (base) · Obra a ejecutar (total) · `constructionBase` · `constructionTotal` | Eran el mismo gasto con y sin overhead. Sin un overhead que aplicar serían dos nombres para un número, y ninguno de los dos existe ya en el contrato. | Obra presupuestada |
| «Obra a ejecutar» como nombre de una cifra en pesos | Nombra los **metros**, no el dinero. Usarlo para `constructionBudgeted` le pone un segundo nombre a la única cifra de obra que es capital, y encima al lado de «obra comprometida» y «obra pagada», que sí se distinguen por la etapa. | Obra presupuestada — y «Metros de obra a ejecutar» para el metraje |
| Overhead de obra como supuesto vigente · `constructionOverhead` en el payload | Dejó de multiplicar nada: se aplica una sola vez al sembrar el presupuesto y vive dentro del importe. Publicarlo sería un número que se lee, se compara y no mueve un peso. | Nada: el overhead ya está dentro de la obra presupuestada |
| «Costo por m² de la obra» como algo que se captura | Fue insumo, y mientras lo fue era la segunda respuesta a cuánto cuesta la obra. | Costo por m² de obra — derivado, presupuesto ÷ metraje |
| Costo de obra «si hay presupuesto, si no la fórmula» | Es la rama condicional que dos maneras de calcular un número siempre traen puesta. Toda propiedad tiene presupuesto desde que nace. | La obra presupuestada, sin condición |
| Ganancia est. | Abrevia dos conceptos a la vez (estimada ≠ proyectada). | Ganancia proyectada |
| Meses en cartera | Cuenta desde la adquisición, no desde nada de «cartera». | Plazo real |
| Base de inversión | Segundo nombre de la inversión total, y sugiere que hay bases distintas. Hay una. | Inversión total |
| Inversión capturada · `totalInvestmentCaptured` | Era un total tecleado que competía con el desglose. Ya no se captura ningún total. | Inversión total — y si lo único que hay es un total, se captura como precio de compra |
| Captura manual (de la inversión) · `investmentBasis` | Nombraba el segundo origen de una cifra que ahora solo tiene uno. | Nada: la inversión total no lleva procedencia |
| ROI proyectado (a secas) | Nombró la anual y la total. | ROI proy. anual / Ganancia proyectada % |
| Cap rate (a secas) para el **proyectado** | Ambiguo: inversión, venta y valuación son todas cifras de valor plausibles contra las que medir una renta modelada. | Cap rate proy. sobre venta (abreviado «s/ venta» donde no cabe) |
| `en_renta`, `adaptive_reuse`, `properties_…_check` | Son identificadores, no lenguaje. | «En renta», «Reconversión», una frase accionable |
