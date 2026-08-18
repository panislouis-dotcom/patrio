# El plano vuelve al prospecto, como ancla dimensional del render — diseño

Fecha: 2026-08-16 · Rama: `fix/render-fidelidad-sin-compositing` · Base: `9bd9146`

## Qué se pidió

Los renders de IA no son dimensionalmente exactos. Mientras esa exactitud siga
siendo un techo estructural del proveedor, el render no puede ser el único
portador de la distribución en el pitch — hoy lo es. Se pide meter el **plano**
al prospecto para que la medida verdadera viaje junto a la imagen que la
aproxima.

## El punto de partida no es cero: es una decisión que se revierte

`_floorplan_svg()` (`app/api/lib/prospectus_html.py:663`) existe, dibuja muros
con grosor, muebles, cotas manuales y nombres de cuarto, y tiene ~20 pruebas
verdes. **Nadie lo llama.** `fe302aa` (Louis, 7-ago-2026) lo retiró del deck:

> «al cliente no le interesan los planos técnicos (muros B/N con nombres de
> cuarto). La distribución la comunica el RENDER 2D amueblado. La función se
> conserva por si se quiere reactivar.»

Su objeción era de **audiencia**; el problema de ahora es de **exactitud**. No
son el mismo problema, y reactivar tal cual el plano B/N solo resuelve el
segundo dejando el primero intacto. Por eso lo que entra no es lo que salió:
entra el plano que ya produce el botón `↓ SVG` — con **m² por cuarto, largo de
cada muro, cotas y batientes de puerta**. Eso responde a Louis y a la exactitud
a la vez. **Sigue siendo una decisión suya que se revierte: avisar antes de
mandarlo, no después.**

## Decisiones

| Decisión | Elegido | Por qué |
|---|---|---|
| Papel del plano | **Ancla dimensional junto al render** | El render vende; el plano sostiene la medida. Ninguno se retira. |
| Qué dibujo | **Paridad con `↓ SVG` (`floorToSvg`)** | Es el único dibujo que ya carga m², largos y batientes. Un plano sin números no ancla nada. |
| Cómo llega a Python | **Bundle de `floorToSvg` evaluado en el Chromium del PDF** | El único serializador. Ver abajo. |
| Acomodo | **Emparejado por piso** | La medida se lee junto a la imagen que corrige, no a dos secciones de distancia. |
| Variantes | **Antes / Después cuando existen las dos** | Mismo recurso retórico que las tiras de foto Antes/Después que el deck ya usa. |
| Llave de pareo | **`(floorId, sourceVariant)`, nunca `floorId` solo** | Advertencia explícita en `LevantamientoPanel.tsx:236`. Ver abajo. |
| Ausencias | **Si está, va; si no está, no va** | Sin placeholders, sin «sin plano». Mismo patrón que `_strip` vacío → `""`. |

## La decisión central: un solo serializador, no un quinto

Hoy el mismo modelo se dibuja en **cuatro** lugares independientes:

| # | Dónde | Dibuja |
|---|---|---|
| 1 | `FloorPlanCanvas.tsx:452` | todo, interactivo |
| 2 | `exportSvg.ts:28` `floorToSvg` | grosor, batientes, mullions, largos, nombre + m², cadenas de cota |
| 3 | `planImage.ts:60` | relleno por tipo de cuarto, muebles, aberturas |
| 4 | `_floorplan_svg` (Python) | muros, muebles, cotas manuales, nombres |

Portar `traceFaces`/`roomAreas`/`roomLabels`/`widthHeightChains` a Python para
alcanzar la paridad de (2) serían ~350-400 líneas de geometría en una **quinta**
implementación — exactamente la duplicación que el diseño de 2026-08-05 se negó
a crear, y `rooms.ts` ya cambió una vez desde entonces (aristas fantasma).

En vez de eso, Python **no interpreta el blob**: lo pasa entero y recibe SVG
terminados. Las dos mitades de la herramienta ya están en la imagen —
`Dockerfile:2` es una etapa `node:20-alpine` y `Dockerfile:17-19` instala
Chromium de Playwright. Hay un empaquetador en build y un motor de JS en
tiempo de PDF; no hace falta agregar ninguno.

Resultado neto: el plano del PDF y el del botón `↓ SVG` **no pueden divergir
nunca**, porque son la misma función.

## Evidencia local (medida, no supuesta)

Todo lo de abajo se corrió contra el Chromium real de Playwright y el
`exportSvg.ts` real de este repo, antes de escribir este documento.

**1. `crypto.randomUUID` exige contexto seguro — y casi nos muerde.**
`migrateGeometry` rellena ids faltantes con `genId()` → `crypto.randomUUID()`.

```
about:blank   -> isSecureContext: False   crypto.randomUUID is not a function
set_content   -> isSecureContext: False   crypto.randomUUID is not a function
file://       -> isSecureContext: True    078aba19-06e5-4d90-ab54-d3db4a609d94
```

El primer borrador de este diseño decía `page.set_content(...)`. Habría
reventado dentro de `backfillFloorIds` para **todo blob v2 y todo piso guardado
antes de que `id` existiera** — es decir, precisamente las propiedades viejas —
y el `try/except` lo habría degradado a «sin planos», en silencio. La página
anfitriona **debe** ser un `file://` temporal, igual que ya hace `render_to_pdf`.
Hay una prueba que fija esto para que nadie lo «simplifique» de vuelta.

**2. El bundle funciona sobre los blobs reales.** `planSheets` = `migrateGeometry`
+ enumeración + `floorToSvg`, empaquetado con esbuild (15.7 kb, IIFE):

```
v2 (sin ids)        -> 1 hoja   [original, id efímero, 'Planta Baja']
v3 editado          -> 2 hojas  [original 'floor-abc'] [planned 'floor-abc']  <- MISMO id
v3 planeado en blanco-> 1 hoja   (el lienzo en blanco no es propuesta)
v3 clon sin editar  -> 2 hojas, SVG byte-idéntico  -> colapsa a una
basura / vacío      -> 0 hojas
svg contiene 'm²' 4.20 3.10 'Recámara' fondo blanco -> todo True
```

El id efímero de un blob v2 **nunca** empatará con el `floor_id` de un render, y
está bien: ese piso muestra su plano solo y sus renders caen a la tira suelta.
Es la regla «si está, va; si no está, no va» aplicada al pareo.

**3. Sin escala compartida, el Antes/Después miente.** Es el hallazgo que cambió
el diseño. `floorToSvg` calcula `scale` ajustando cada piso a SU caja
(`exportSvg.ts:35`). Un antes de 4.2 m y un después de 5.0 m del MISMO piso:

```
HOY   antes 4.2m  ancho dibujado 1085.9px   muro 37.4px
      después 5.0m ancho dibujado 1112.0px   muro 32.2px
```

Un ensanche real del 19 % se dibuja como una diferencia visual del 2.4 %, y el
muro *adelgaza* (37.4 → 32.2 px) donde nadie cambió ningún muro. Poner esas dos
imágenes lado a lado bajo «Antes / Después» es afirmar una transformación falsa
— la misma clase de mentira que este diseño existe para evitar, pero impresa y
firmada. Con una escala compartida por linaje:

```
FIJO  antes 4.2m  ancho 712.0px  muro 24.0px  viewBox 0 0 800 624
      después 5.0m ancho 840.0px  muro 24.0px  viewBox 0 0 928 624
```

712:840 es exactamente 4.2:5.0, y el muro mide igual en ambos. De regalo, el
viewBox pasa a tener la forma real del piso — se acabó el lienzo desperdiciado
de un lote angosto y profundo, que es justo lo que `_floorplan_svg` ya cuidaba.

**4. El cambio no toca la descarga que ya existe.** Con `scale` ausente la
salida es **byte-idéntica** a la de hoy (1882 chars, `True`). `↓ SVG` y `↓ PDF`
del editor no cambian ni un carácter.

## Piezas nuevas

**`app/web/src/lib/floorplan/planSheets.ts`**
```ts
export function planSheets(raw: unknown): PlanSheet[]
// { variant: 'original'|'planned', floorId, floorName, svg }[]
```
Compone `migrateGeometry` + enumeración + `floorToSvg`. **Cero geometría
propia.** Salta pisos sin vértices. Calcula **una escala por linaje** (`floorId`)
a partir de la variante más grande y se la pasa a las dos.

**`exportSvg.ts` — `ExportOpts.scale?: number`** (px por metro), opt-in. Cuando
viene, el lienzo se dimensiona *desde* la escala (`spanx * scale + 2*margin`) en
vez de la escala desde el lienzo; cuando no viene, nada cambia (evidencia 4).

**`npm run build:plano`** → esbuild/Vite lib mode, IIFE, global `Plano`, sin
externals, a `dist-plano/plano.iife.js`. Se agrega a la etapa `node:20-alpine`
que ya existe; un `COPY --from=frontend-build` lo deja junto al Python. Un
`make build-plano` mantiene honesto el desarrollo local.

**`app/api/lib/plano_js.py`**
```python
async def render_plan_sheets(geometries: dict[int, dict]) -> dict[int, list[dict]]
```
Un solo lanzamiento de Chromium para todo el prospecto, `goto("file://…")`
(**no** `set_content` — evidencia 1), `add_script_tag(path=_BUNDLE)`, un
`page.evaluate` por todos los blobs. Bundle ausente o evaluación con excepción →
warning fuerte al log, dict vacío, la sección desaparece — la misma degradación
que `documents.py:44` ya usa cuando falla la descarga de una imagen. **Un PDF no
se muere porque un plano no dibujó.**

**`_plan_rows(sheets, renders) -> (rows, leftovers)`** (`prospectus_html.py`),
pura, sin BD ni navegador. Agrupa por **linaje** (`floorId`), ordena por el orden
de pisos del original y agrega al final los pisos que solo existen en el
planeado. Fila: `{floorName, antes, despues}`.

- Los renders empatan por **`(floorId, sourceVariant)`**, las dos, nunca una.
  `LevantamientoPanel.tsx:231-239` lo advirtió por escrito antes de que esta
  función existiera: un piso planeado nacido de PARTIR/RE-PARTIR **comparta el
  mismo `id`** que su contraparte original. Parear solo por `floorId` habría
  puesto un render del original junto al plano del planeado. La evidencia 2 lo
  confirma sobre datos.
- Lo que no empata vuelve como `leftovers`: renders de foto, renders anteriores
  al 7-ago (columnas NULL por decisión de `042`, sin backfill), y renders cuyo
  piso ya se borró. Alimentan la `_strip` de hoy, sin cambios. **La salida de
  hoy es el piso de la salida nueva, nunca peor.**
- El nombre del piso sale de la **hoja**, no del render: `floorName` en el render
  está congelado para sobrevivir a un renombre, pero si el piso existe manda el
  vivo. Un render cuyo piso se borró es leftover, y **ahí** su nombre congelado
  es la única etiqueta honesta que queda.
- **Colapso por igualdad de SVG:** un planeado clonado y aún no editado produce
  el mismo string. Imprimirlo bajo «Antes / Después» afirmaría una
  transformación que nadie diseñó. La igualdad de strings compara exactamente lo
  que el lector vería — sin diff geométrico.

## Datos

`list_render_heads` hace `SELECT *` y `_row_to_dict` (`db.py:91`) camelliza toda
columna: `renderHeads` **ya trae** `floorId`, `floorName` y `sourceVariant`.
**Sin migración, sin cambio de query.** `_embed_opportunity_extras`
(`documents.py:58`) suma el `await render_plan_sheets(...)` y adjunta
`p["planRows"]` / `p["planLeftovers"]`.

`build_prospectus_html` sigue siendo una función sync pura que recibe los SVG
**como datos** — por eso el arnés `_capture` de `test_documents.py:51` y todas
sus aserciones siguen sirviendo.

## Layout

Una `.plan-row` por linaje: nombre del piso como `col-label`, luego rejilla de
dos columnas — plano a la izquierda, sus renders a la derecha — repetida para
Antes y Después cuando existen las dos. Los leftovers conservan el marcado
`.strip` de hoy; el presupuesto fluye después, como lo dejó `fe302aa`.

## Pruebas

El riesgo es el mockeo: hoy toda prueba parcha `render_to_pdf`, así que si
además se parcha `render_plan_sheets`, **un bundle roto pasa toda la suite en
verde y llega a producción sin planos.**

1. `planSheets.test.ts` — v2, v3 con las dos variantes, planeado en blanco
   omitido, malformado → `[]`, escala compartida por linaje.
2. `exportSvg.test.ts` — con `scale`: proporción y grosor de muro iguales entre
   dos pisos de tamaño distinto; **sin `scale`: salida idéntica a la de hoy.**
3. `_plan_rows` — pareo por las dos llaves, `floorId` NULL → leftover, variante
   distinta → leftover, piso borrado → leftover con nombre congelado, colapso
   por SVG idéntico, orden.
4. `test_documents.py` con `render_plan_sheets` falseado — aserciones sobre HTML.
5. **Una prueba que carga el bundle en Chromium de verdad y lo evalúa**, con un
   blob v2 sin ids. Es lo único que separa esto de un PDF sin planos en
   silencio, y es la que fija el `file://` de la evidencia 1.
6. Un PDF real contra datos sembrados — la propiedad 5 tiene dos pisos
   verdaderos (comentario de `042`). Una escala mal calculada no la caza un
   assert de texto.

## Riesgos

- **Acoplamiento de build.** La imagen del API pasa a depender de un artefacto
  del build de web. `make api` sin `make build-plano` da un PDF sin planos y sin
  error. El camino «bundle ausente» tiene que gritar en el log.
- **Un Chromium extra** (~1-2 s) contra el presupuesto de 90 s de
  `_RENDER_TIMEOUT_S`. Si molesta, más adelante puede compartir el navegador con
  `render_to_pdf`.
- **Contexto seguro.** Ver evidencia 1. Fijado por la prueba 5.
- **Louis.** Ver arriba: es su decisión la que se revierte.

## Qué se borra

`_floorplan_svg` (`:663`), `_pick_floors` (`:641`) y sus ~20 pruebas. No queda
un cuarto serializador en Python ni lógica de forma de variante duplicada entre
lenguajes.
