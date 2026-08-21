# Comisiones del fondo en el prospecto — diseño

Fecha: 2026-08-20 · Rama: `feat/comisiones-en-prospecto` · Base: `main` (473f955)

## Qué se pidió

La ficha (`PropertyDetailPage.tsx`) ya tiene una sección "COMISIONES DEL FONDO"
completa: cada comisión con su % y su monto, los dos escenarios de salida
(venta y renta, siempre los dos — `compute_fees()` en `fees.py` ya no depende
de una `exit_strategy` elegida), y los dos totales finales lado a lado. El
prospecto PDF (`prospectus_html.py`), el documento que de verdad ve un
inversionista, solo tiene un parche defensivo: una sub-línea `<small>V $4.0M ·
R $3.9M c/comisiones</small>` metida en la celda de "Inversión sin
comisiones", agregada para no romper el documento cuando el modelo de
comisiones cambió de un escenario a dos — nunca una decisión de diseño.

Diagnosticado con 4 agentes en paralelo (2 Codex, 2 Claude): dos cubrieron
restricciones de layout/CSS y arquitectura de información por separado; dos
propusieron mockups concretos y auditaron el parche ya publicado. Ver la
sección de decisiones para el porqué de cada una.

## Hallazgo: el parche publicado tiene un error real, no solo de diseño

`_inv_value()` hoy imprime los dos escenarios (venta y renta) en **las cinco**
tarjetas — incluidas `_sold_card()` y `_rented_card()`, que documentan por
escrito su propio principio: *"Ni una cifra proyectada... presumir una marca o
un plan cuando ya existe un precio de venta sería cambiar un resultado por una
opinión"* (`_sold_card`). Como `compute_fees()` resuelve cada lado con un
relevo real→proyectado, una propiedad VENDIDA puede imprimir hoy una comisión
de renta calculada sobre una renta que nunca se cobró — sin ninguna marca de
que es hipotética. Mismo problema en espejo en `_rented_card()` con la venta.
`_summary_card()` hereda el problema: suma esas cifras contaminadas entre
propiedades, mezclando dinero realizado con dinero hipotético en un solo
número — exactamente lo que esa misma función ya evita a propósito para
ventas vs. valuaciones (`"Sumarlas en una sola cifra obligaría a llamar
'valuación actual' a dinero que ya se cobró"`).

La corrección no es un campo de procedencia nuevo: es dejar de mostrar el lado
que no aplica. Una vendida siempre tiene `sale_price` capturado (la transición
a `vendida` lo exige) y una rentada siempre tiene `rent_monthly_actual`
(la transición a `en_renta` lo exige) — así que mostrar SOLO el lado real de
cada una elimina el problema de raíz, no lo etiqueta.

## La decisión central: el nivel de detalle sigue la intención del lector, no una regla pareja

El documento ya trata sus secciones por lo que el inversionista está
decidiendo, no por simetría de layout: Track Record (`_sold_card`/
`_rented_card`) son hechos cerrados, "en cinco minutos, sin fluff"
(`README.md`); Oportunidad Activa (`_opportunity()`) es la única página donde
alguien decide meter capital HOY, y es la única con espacio real (página
completa, sin el alto fijo de `.proj`, con `_opportunity_detail()` como zona
de flujo libre). Las comisiones se calculan igual en toda etapa, pero solo
importan al detalle en la etapa donde todavía se puede invertir.

| Tarjeta | Qué se muestra | Por qué |
|---|---|---|
| `_opportunity()` | Fila de métricas nueva: terreno, obra, y los dos finales (venta \| renta) lado a lado | Única etapa con la salida genuinamente indecisa, y única con espacio |
| `_development_card()` | Sub-línea compacta, los dos escenarios (sin cambios) | Sigue indecisa, pero la tarjeta ya es de proyección pura y media hoja — sin espacio para más |
| `_sold_card()` | Sub-línea compacta, **solo venta** | Lo que pasó de verdad; renta es contrafactual |
| `_rented_card()` | Sub-línea compacta, **solo renta** | Lo que pasa de verdad hoy; venta es contrafactual |
| `_summary_card()` | Nada — se quita la sub-línea de comisiones | Sumar "si todo se hubiera vendido" + "si todo se hubiera rentado" en un track record mixto no es una cifra real; ningún inversionista pregunta eso |

## La fila nueva en Oportunidad Activa

Cuatro celdas, mismo `.metrics-4` que ya existe (sin CSS nuevo — solo
`.opp .metrics-5` tiene el override a 16pt/3.6mm; una fila de 4 dentro de
`.opp` hereda el tamaño base de 20pt/5mm, mismo peso visual que la fila
principal), colocada justo después de `.opp-cols` y antes de la galería:

```
┌──────────────┬──────────────┬──────────────────────┬──────────────────────┐
│   $150K      │   $420K      │      $3.97M           │        —             │
│   5.0%       │   15.0%      │                       │  falta renta mensual │
│ COMISIÓN     │ COMISIÓN     │ INVERSIÓN C/COMIS.    │ INVERSIÓN C/COMIS.   │
│ COMPRA TERR. │ DE OBRA      │ · VENTA               │ · RENTA              │
└──────────────┴──────────────┴──────────────────────┴──────────────────────┘
```

Terreno y obra nunca faltan (siempre hay una base y un %, el default si nadie
capturó uno). Los dos finales sí pueden faltar cada uno por su cuenta, y
entonces nombran su propio insumo ausente (`feesMissingInputsVenta`/`Renta`,
siempre exactamente `['salePrice']` o `['rentMonthly']`) — nunca un guion
sin explicación.

`_inv_value()` en la fila principal de `_opportunity()` vuelve a ser la cifra
plana, sin sub-línea: el detalle vive en la fila nueva, no en las dos partes
a la vez.

## `_inv_value()`: mismo helper, cada llamador decide qué lado pasar

No se reescribe la función — cada sitio que la llama decide qué escenario(s)
pasarle:

```python
_sold_card:        _inv_value(total_inv, with_fees_venta=p["totalInvestmentWithFeesVenta"], with_fees_renta=None)
_rented_card:       _inv_value(total_inv, with_fees_venta=None, with_fees_renta=p["totalInvestmentWithFeesRenta"])
_development_card:  _inv_value(total_inv, venta, renta)               # sin cambios
_opportunity:       _inv_value(total_inv, None, None)                 # cifra plana; el detalle vive en la fila nueva
_summary_card:      ya no llama a _inv_value — usa _fmt_mxn_compact_or_dash(inv) directo
```

`_all_or_nothing()` y las dos variables `inv_with_fees_venta`/`renta` de
`_summary_card()` se eliminan: sin llamador que las use, quedarían como
código muerto.

## Pruebas

`test_prospectus_html.py`: reescribir los tests de `_sold_card`/`_rented_card`
para confirmar UN SOLO lado (no ambos); `_summary_card` para confirmar que la
sub-línea de comisiones ya no aparece nunca; nuevos tests para la fila de
`_opportunity()` — con los dos escenarios, con uno solo, con ninguno (cada
insumo faltante nombrado por separado).

`test_documents.py`: cualquier aserción de integración que dependa del texto
"V $X · R $Y" en una tarjeta de vendida/rentada necesita actualizarse a un
solo lado.

## Fuera de alcance (a propósito)

- Un campo de procedencia (`exitFeeVentaSource: 'real'|'proyectado'`) en el
  backend — innecesario: al mostrar solo el lado real en vendida/rentada, el
  problema que ese campo resolvería deja de poder ocurrir.
- La tabla detallada tipo "estado de cuenta" (%, cada monto individual, en
  `_opportunity_detail()`) — mockup evaluado y descartado por ahora: repetiría
  las mismas cifras que la fila nueva, a más del doble del espacio. Si hace
  falta paridad completa con la ficha para diligencia/auditoría, es un pedido
  propio, no algo que se construye especulativamente hoy.
