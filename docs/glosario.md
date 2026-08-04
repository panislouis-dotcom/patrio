# Glosario del dominio

Cada concepto tiene **un** nombre. Ese nombre se usa igual en la ficha, la tabla,
el modal, el PDF, la carta de términos, los mensajes de error y las skills.

La regla que ordena todo lo demás: **una fórmula, un nombre**. Si dos cifras
salen de la misma función alimentada con salidas distintas, comparten familia de
nombre y se distinguen por la etapa (*proyectada* / *no realizada* / *realizada*).
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

### Obra a ejecutar — `sqmConstruction` × `constructionCostPerSqm`
Los metros que **tú** vas a construir o remodelar, por su costo por m².

**NO son** los metros que el inmueble ya tiene construidos. Lo ya edificado ya
se pagó dentro del precio de compra y no vuelve a aparecer.

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

Tres números que **siempre** tienen un valor vigente: el que capturó una persona,
o el que aplica el modelo. El payload publica el valor vigente bajo su llave y su
procedencia en `assumptions`.

| Nombre canónico | Campo | Omisión | Qué es |
|---|---|---|---|
| Costos de adquisición (%) | `acquisitionCostPct` | 6.5% | Fracción **aditiva** sobre el precio de compra. |
| Overhead de obra | `constructionOverhead` | ×1.3 | **Multiplicador** de indirectos de obra. Se muestra como `×1.3`, nunca como `30%`. |
| Plazo proyectado | `holdMonths` | 12 meses | Meses de compra a salida que asume el modelo. |

Procedencia (`assumptions[x].source`): `captured` → **«Capturado»**;
`default` → **«Supuesto por omisión»**.

**NO son** costos: un supuesto nunca falta, solo cambia de origen. Por eso la
compuerta de Desarrollo no los exige.

---

## 4. Costos derivados e inversión

### Costos de adquisición — `acquisitionCosts`
`precio de compra × costos de adquisición (%)`. ISAI, notario, avalúo.

**NO es** el precio de compra ni lo incluye.

### Total de adquisición — `acquisitionTotal`
`precio de compra + costos de adquisición`. Lo que cuesta quedarse con el
inmueble antes de tocarlo.

### Obra a ejecutar (base) — `constructionBase` · Obra a ejecutar (total) — `constructionTotal`
`m² × costo por m²`, y lo mismo con el overhead aplicado.

### Inversión total — `totalInvestment`
**La** base de capital: todo el dinero que entra. Es el denominador de toda
ganancia y todo ROI. Sobrevive a la venta — es historia, no proyección.

Se calcula **siempre** igual, sin ramas: la suma de los cinco costos de captura.

```
inversión total = precio de compra × (1 + costos de adquisición %)
                + permisos + subdivisión
                + m² de obra × costo por m² × overhead de obra
```

Un componente que nadie capturó vale `0`. No existe «desglose completo» contra
«incompleto»: la fórmula corre igual con un costo o con los cinco. Si la suma da
cero —nadie capturó nada— la inversión total queda **vacía**, y se imprime «—».
Vacía no es cero.

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
mes sin que cambie ni un dato: reporta el calendario, no el activo. Por eso el
ROI anual **no** divide entre el plazo real.

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
| Cap rate proy. sobre inversión | `capRate` | Renta anual **estimada** / inversión total. |
| Cap rate real sobre inversión | `capRateActual` | Renta anual **cobrada** / inversión total. |

La fórmula es **yield on cost** — renta bruta sobre el dinero invertido — y esa
es la decisión correcta, documentada en `finance/underwriting.py`. Pero «cap
rate» a secas, en el mercado, significa NOI sobre valor de mercado. Por eso la
etiqueta **siempre** lleva su denominador. Nunca «CAP RATE» solo.

«Cap rate» **se califica, no se sustituye**: es la palabra que el usuario usa, y
cambiarla por «rendimiento sobre costo» le costaría más de lo que le aclara.
Donde hay lugar se escribe completo — «Cap rate real sobre inversión»; donde el
espacio manda, como en las tarjetas del PDF, se abrevia a «s/ inversión».

**NO lleva** descuento de gastos operativos: el cap rate neto de opex vive en el
analizador, que sí modela NOI.

---

## 9. Plazos

| Nombre canónico | Campo | Qué es | Qué NO es |
|---|---|---|---|
| Plazo proyectado | `holdMonths` | Supuesto: meses de compra a salida. | No es un plazo medido. |
| Plazo real | `holdMonthsActual` | Meses de la adquisición a hoy; congelado en la fecha de venta. | No son «meses en cartera» ni «meses de obra» — se cuentan desde la adquisición, se haga obra o no. |

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
| Ganancia est. | Abrevia dos conceptos a la vez (estimada ≠ proyectada). | Ganancia proyectada |
| Meses en cartera | Cuenta desde la adquisición, no desde nada de «cartera». | Plazo real |
| Base de inversión | Segundo nombre de la inversión total, y sugiere que hay bases distintas. Hay una. | Inversión total |
| Inversión capturada · `totalInvestmentCaptured` | Era un total tecleado que competía con el desglose. Ya no se captura ningún total. | Inversión total — y si lo único que hay es un total, se captura como precio de compra |
| Captura manual (de la inversión) · `investmentBasis` | Nombraba el segundo origen de una cifra que ahora solo tiene uno. | Nada: la inversión total no lleva procedencia |
| ROI proyectado (a secas) | Nombró la anual y la total. | ROI proy. anual / Ganancia proyectada % |
| Cap rate (a secas) | En el mercado significa NOI/valor. | Cap rate sobre inversión (abreviado «s/ inversión» donde no cabe) |
| `en_renta`, `adaptive_reuse`, `properties_…_check` | Son identificadores, no lenguaje. | «En renta», «Reconversión», una frase accionable |
