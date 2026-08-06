# Prospecto: plano, renders y presupuesto en Oportunidades — diseño

Fecha: 2026-08-05 · Rama: `feat/prospecto-pdf` · Base: `origin/main` (5648d32)

## Qué se pidió

El prospecto de inversión (`/api/documents/prospectus`) ya presume track record
(vendidas, en renta) y obra en curso (desarrollo), y cierra con las
**oportunidades activas** (`oferta` + `prospecto`) — lo que un inversionista
todavía puede tomar. Esa tarjeta de oportunidad hoy enseña cinco métricas, un
desglose financiero y de ubicación, y una galería de fotos. Faltan las tres
piezas que la ficha ya tiene y el pitch no: el **plano**, los **renders**
generados con IA, y el **desglose del presupuesto de obra**. Se agregan las
tres, solo a la tarjeta de oportunidad — vendida/renta/desarrollo no cambian.

## Decisiones

| Decisión | Elegido | Por qué |
|---|---|---|
| Plano | **SVG generado en servidor desde `properties.geometry`** | Es la misma fuente de verdad que el editor de planos lee/escribe. No depende de que alguien haya pedido un render-desde-plano antes — casi ninguna oportunidad lo tiene hoy. |
| Multi-piso | **Todos los pisos, apilados** | Un plano de una sola planta cuenta la mitad de la historia en un edificio de dos niveles. |
| Renders | **Reusar `_embed_images()`** contra `renders_db.list_renders()` | Es el mismo mecanismo (storage → resize → base64) que ya usan las fotos; no hace falta un segundo camino. |
| Presupuesto | **Tabla de capítulos, solo presupuestado** | `get_budget()` ya trae los renglones agrupados y ordenados por capítulo — se agrega en Python, sin SQL nueva. Comprometido/pagado es lenguaje de ficha operativa, no de pitch a un inversionista externo. |

## La decisión central: el plano se dibuja, no se reusa

`property_renders.source_plan_path` guarda el PNG del plano *cuando alguien ya
pidió un render a partir de él* — es un efecto secundario de esa acción, no una
representación garantizada del plano vigente. Depender de esa ruta habría
dejado la mayoría de las oportunidades sin plano en el pitch, y peor: si el
plano cambia después de generar ese render, el PNG guardado queda desactualizado
silenciosamente — la misma clase de drift que el resto del dominio se niega a
tolerar (`totalInvestment` no vive en dos lados, y el plano tampoco debería).

`properties.geometry` es la fuente única. Su forma (`storeys[].{vertices, walls,
rooms}`) es exactamente la que `toGeometryJson()` ya exporta en el frontend
(`app/web/src/lib/floorplan/export.ts`), así que dibujarla en Python — líneas
para los muros (con su grosor), polígonos rellenos para los cuartos, texto en
cada centroide — no reinventa el modelo, solo lo proyecta a SVG en vez de a
canvas. Corre dentro del mismo pipeline de Playwright que ya arma el PDF; no
agrega dependencia.

## Piezas nuevas

**`_floorplan_svg(geometry: dict) -> str`** (`prospectus_html.py`)
Por cada storey en `geometry.storeys`: bounding box de sus vértices, escala a
un viewBox fijo, muros como `<line>` con `stroke-width` proporcional al grosor,
cuartos como `<polygon>` con su nombre en el centroide. Los pisos se apilan
verticalmente, cada uno con su nombre de storey como encabezado. `geometry`
vacío o `None` → `""`, el bloque desaparece (mismo patrón que `_team_block`).
Un muro que referencia un vértice inexistente se salta — un plano mal formado
no debe tumbar el prospecto entero.

**Galería de renders** (dentro de `_opportunity()`)
`renders_db.list_renders(property_id)` trae hasta 4 más recientes, con sus
imágenes ya embebidas por `_embed_images()`. Sin renders → sección ausente.

**`_budget_chapters_table(lines: list[dict]) -> str`** (`prospectus_html.py`)
Agrupa `lines` (de `get_budget()`) por `chapterName` en el orden que
`chapters` ya da (residuo al final), suma `budgetedAmount` por capítulo, y
agrega un renglón de total que debe cuadrar con `constructionBudgeted`. Una
propiedad recién nacida solo trae su renglón residual «Otros, por detallar» —
una tabla de un renglón, no un error.

## Datos: qué cambia en `documents.py`

`generate_prospectus()` ya llama `_embed_images(favorites)` una vez, dentro de
`asyncio.to_thread`. Se agrega ahí mismo — mismo hilo, mismo bloque de I/O
bloqueante — un segundo paso que enriquece *solo* la partición de oportunidad
(`oferta` + `prospecto`) con `geometry`, `renders` (embebidos) y
`budgetChapters`, antes de pasarla a `build_prospectus_html()`. No hay
endpoint nuevo ni cambia el contrato de `/api/documents/prospectus`.

## Pruebas

- `_floorplan_svg`: geometry vacío, un piso, varios pisos apilados, muro con
  vértice colgante.
- Agregación de capítulos: sin renglones más que el residual, varios
  capítulos, orden respetado.
- `test_documents.py`: el prospecto de una oportunidad con plano/renders/
  presupuesto los enseña; una sin ninguno de los tres los omite todos sin
  romperse.
- Verificación visual: un PDF real contra datos sembrados — un SVG mal
  escalado no lo detecta un assert de texto.
