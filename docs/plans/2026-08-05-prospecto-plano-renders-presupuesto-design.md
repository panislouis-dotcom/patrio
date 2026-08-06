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

`properties.geometry` es la fuente única. **Corrección (verificado contra
`test_property_geometry.py`, no contra memoria):** su forma NO es la que
`toGeometryJson()` exporta — esa función solo alimenta un panel de JSON de
depuración en el editor (`FloorPlanEditor.tsx`) y nunca se persiste ni se
manda a ningún lado. Lo que de verdad vive en `properties.geometry` es el
modelo crudo del editor: `{floors: [{name, height_m, extWall_m, intWall_m,
vertices: {id: {id,x,y}}, edges: {id: {id,v1,v2,thickness,openings}}, rooms:
[{name, cx, cy}]}]}`. Los cuartos ahí son un nombre y un punto de etiqueta —
**no traen polígono ni área** — porque un cuarto puede nombrarse sin estar
cerrado por muros (`3ba3c78`). Reconstruir el polígono de un cuarto exige el
mismo algoritmo de trazado de caras (`traceFaces` → `roomAreas`,
`app/web/src/lib/floorplan/rooms.ts`, ~114 líneas) que ya vive en TypeScript;
portarlo a Python duplicaría lógica geométrica no trivial que ya ha cambiado
una vez y puede volver a cambiar — el mismo tipo de drift silencioso que este
diseño existe para evitar en primer lugar.

Por eso el SVG del prospecto dibuja **solo lo que el modelo crudo garantiza**:
los muros como líneas (con su grosor) y el nombre de cada cuarto como texto en
su punto `(cx, cy)` — sin relleno, sin polígono. Es menos bonito que el editor
interactivo, pero cada línea que dibuja viene de un campo que existe siempre,
y no hay una segunda implementación de geometría que mantener sincronizada.

## Piezas nuevas

**`_floorplan_svg(geometry: dict) -> str`** (`prospectus_html.py`)
Por cada floor en `geometry["floors"]`: bounding box de sus `vertices`, escala
a un viewBox fijo, muros (`edges`) como `<line>` con `stroke-width`
proporcional a `thickness`, cuartos (`rooms`) como `<text>` en `(cx, cy)` — sin
polígono. Los pisos se apilan verticalmente, cada uno con su `name` como
encabezado. `geometry` vacío, `None`, o sin `floors` → `""`, el bloque
desaparece (mismo patrón que `_team_block`). Un `edge` que referencia un
`v1`/`v2` ausente en `vertices` se salta — un plano mal formado no debe tumbar
el prospecto entero.

**Galería de renders** (dentro de `_opportunity()`)
`renders_db.list_renders(property_id)` trae hasta 4 más recientes, con sus
imágenes ya embebidas por `_embed_images()`. Sin renders → sección ausente.

**`_budget_chapters_table(lines: list[dict]) -> str`** (`prospectus_html.py`)
Agrupa `lines` (de `get_budget()`) por `chapterName` en el orden que
`chapters` ya da (residuo al final), suma `budgetedAmount` por capítulo, y
agrega un renglón de total que debe cuadrar con `constructionBudgeted`. Una
propiedad recién nacida solo trae su renglón residual «Otros, por detallar» —
una tabla de un renglón, no un error.

## Layout: una página compañera, no la misma página

`.opp` es una página fija de 297mm (hero + métricas + dos columnas + tira de
fotos) ya probada y en producción. Meter plano + renders + presupuesto ahí
arriesga desbordar ese layout en propiedades con muchas fotos, y toca CSS del
que la tarjeta actual depende. En vez de eso, `_opportunity()` devuelve un
segundo `<div class="page-block opp-detail">` inmediatamente después del
existente — mismo patrón que ya separa páginas (`page-break-after`), cero
riesgo para el layout que ya funciona. Una oportunidad sin plano, sin renders
y sin renglones de presupuesto más allá del residual no genera esa segunda
página — no hay nada que enseñar ahí que la tarjeta principal no diga ya.

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
