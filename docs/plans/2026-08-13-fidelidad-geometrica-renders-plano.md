# Fidelidad geométrica de renders de plano — diagnóstico y plan

Fecha: 2026-08-13. Diagnóstico con 6 subagentes independientes (3 Claude, 3
Codex), cada uno con un ángulo distinto: causa raíz del proveedor, alternativas
que desacoplan geometría de estilo, y canal visual vs. la idea de mandar el
JSON crudo del plano. Decisiones validadas con Eduardo por AskUserQuestion.

## Motivo

> "las imagenes de los renders no se muestran exactamente como los
> levantamientos. A veces se agregan cuartos, puertas fuera de lugar
> dimension, paredes faltantes."

## Diagnóstico (verificado, no supuesto — cada punto tiene evidencia real)

### Capa 1 — bugs concretos y medidos en la imagen de referencia

Un subagente construyó un plano de prueba realista, lo pasó por
`floorToSvgString`/`floorToPngBlob` (el código real de producción), rasterizó
el resultado e inspeccionó los píxeles:

1. **Una ventana se dibuja como un agujero desnudo en el muro** — mismo
   tratamiento que una puerta (`planImage.ts:73-76`) pero sin hoja ni arco.
   Una puerta al menos se lee como puerta; una ventana se lee como **pared
   faltante**. Mejor candidato para la queja "paredes faltantes".
2. **Los vanos salen 17%–50% más angostos** de su medida real. Causa:
   `stroke-linecap="round"` (`planImage.ts:59`) extiende cada segmento de
   muro media anchura de línea más allá de su punto final, comiéndose el
   hueco de la puerta/ventana. Medido rasterizando: una puerta de 0.90 m
   en un muro de 0.15 m sale pintada a 0.76 m.
3. **El arco de abatimiento de una puerta es ~19× más delgado** que el trazo
   del muro (0.8 px contra 10-15 px) — señal casi invisible.
4. **Las cotas de muro horizontal se dibujan encima del propio muro**
   (`planImage.ts:134`, offset de solo +11 px en X) — ilegibles.
5. **Las particiones interiores casi nunca quedan acotadas**: en un plano
   real con muros partidos en T, `widthHeightChains` degenera a 2 números
   para todo el piso (solo el total, nunca las particiones).
6. **`planFacts` inventa esquinas de 180°** — puntos colineales sobre un
   muro recto, no esquinas — y se las presenta al modelo como geometría
   irregular. Dato fabricado.
7. **El prompt pide "sin texto" a una imagen cubierta de etiquetas y
   cotas** (`_PLAN_CLAUSE`) — instrucción que se contradice a sí misma.
8. **La tipografía es de tamaño fijo en px** mientras el lienzo crece con
   la escala — arriba de ~18.5 m de plano las cotas se vuelven ilegibles
   en silencio tras el reescalado a `MAX_EDGE_PLAN`.
9. **Las oraciones de conexión no nombran el muro** ("a 2.25 m del extremo
   izquierdo del muro" — ¿cuál muro, si hay dos ventanas en el mismo
   cuarto?). Confirma la hipótesis original de Eduardo sobre ambigüedad de
   la prosa, con un ejemplo real reproducido.
10. **Un cuarto sin muros se lista igual que uno cerrado — tercer mecanismo
    verificado de "cuartos inventados".** `rooms.ts::roomLabels` devuelve
    cualquier nombre puesto sobre espacio abierto (`area: null`, sin
    polígono cerrado — el caso "Terraza"). `planFacts.ts` los mete bajo
    `"Cuartos:"` indistinguibles de los reales, salvo `"área sin medir"`.
    Combinado con `_PLAN_CLAUSE` ("No agregues, quites ni muevas cuartos ni
    paredes"), el prompt le dice al modelo que preserve un "cuarto" que en
    la imagen no tiene ni un muro — la forma natural de obedecer es
    dibujarle muros. Confirmado por un segundo subagente independiente.

**Nota sobre resolución de salida (cuantitativo, calculado):** a los
`_TARGET_PIXELS = 1024*1024` actuales, un muro interior de 0.10 m en una
casa de 20 m de ancho se pinta a ~5.8 px; en una de 30 m, ~4 px — sub-token
para un modelo que tokeniza por parches. Argumento cuantitativo adicional
(no solo cualitativo) de por qué "faltan paredes" en plantas grandes,
independiente de cualquier arreglo de prompt.

### Capa 2 — un bug de UI que puede estar anulando el prompt en producción

`RendersPanel.tsx`: `choosePreset` y `selectPlan` se pisan entre sí — no hay
paso de composición. Elegir un piso y luego un estilo (o al revés) BORRA el
otro. Documentado como defecto diferido desde antes de esta sesión; nunca se
había conectado con el síntoma de fidelidad. Renders reales de producción
pudieron haber salido sin ningún dato duro del plano, dependiendo del orden
de clics.

### Capa 3 — el techo real del proveedor (confirmado contra documentación oficial)

`images.edit` con `gpt-image-2` no es una transformación que preserve
geometría: es una re-síntesis completa condicionada por imagen+texto. La
documentación oficial de OpenAI admite dificultad en "composiciones
estructuradas o sensibles al layout". `input_fidelity` está genuinamente
cerrado para gpt-image-2 (rechazado por la API, confirmado contra el SDK
instalado y la doc). Una `mask` nunca da preservación exacta — es guía, no
garantía, por contrato documentado. Ningún prompt elimina esto del todo.

Una prueba real de Autodesk (abril 2026, mismo dominio: CAD→render) confirma
que modelos sin control estructural "reinterpretan libremente" la geometría,
mientras que los modelos con ControlNet la preservan.

## La pregunta del JSON crudo — descartada con evidencia

Mandar el `FloorGraph` crudo en vez de `planFacts` costaría 3.2× más tokens
(52% serían UUIDs sin significado para el modelo) y — el punto decisivo —
**el JSON ni siquiera contiene los polígonos de los cuartos**: se calculan
con `traceFaces`/`interiorPolygons` (`rooms.ts`), un algoritmo que un modelo
de generación de imagen no ejecuta. `planFacts` ya corrió ese algoritmo y
entrega la respuesta; mandar JSON sería mandar la entrada de un cómputo ya
resuelto y rezar a que el modelo lo rehaga. Tampoco ancla a nada visible en
la imagen (mismo error que el repo ya corrigió una vez al dejar de decir
"v1" y empezar a decir "extremo izquierdo").

## Decisiones validadas con Eduardo (AskUserQuestion, 2026-08-13)

1. **Fidelidad 100%, siempre** — no "mejor esfuerzo". El resultado nunca
   debe mentir sobre la distribución real, aunque cueste algo de pulido
   visual en las costuras.
2. **El destino se queda como plano 2D visto desde arriba** — no es un paso
   hacia 3D/perspectiva fotorrealista. Esto habilita que la vía de
   composición baste: no hace falta inventar profundidad que el plano
   fuente no tiene.
3. **Vía elegida para eliminar el techo de raíz: componer el trazo exacto
   de los muros ENCIMA del resultado de la IA** — no cambiar de proveedor.
   Reusa código ya existente y probado (`floorToSvgString`); no agrega
   vendor ni llave nueva. Cambiar de proveedor (ControlNet vía Stability/
   fal.ai, costo comparable al actual) queda documentado como respaldo si
   la composición no alcanza, no como primer intento.

## Riesgo técnico a validar empíricamente antes de comprometerse

La composición asume que el resultado de la IA conserva razonablemente el
encuadre/escala de la imagen de referencia (ya se pide `match_aspect=True`
desde el addendum de fidelidad dimensional). Si el modelo desplaza, recorta
o reescala la composición internamente, superponer el trazo exacto de los
muros produciría líneas flotando desalineadas del muro dibujado por la IA —
peor que el problema actual, no mejor. Esto se prueba con un render real
antes de construir el mecanismo final de composición (Task 36 abajo),
siguiendo el mismo patrón de "probar primero sin tocarlo" ya usado en el
addendum de fidelidad dimensional.

## Orden de ejecución

### Task 33 — Arreglar los bugs de la imagen de referencia y del prompt (Capas 1 y 2)

**Files:**
- `app/web/src/lib/floorplan/planImage.ts`:
  - Ventana: dibujar un símbolo real (línea del vano + marca de vidrio/
    marco), no solo un hueco en el muro — debe distinguirse visualmente de
    una puerta.
  - `stroke-linecap="round"` → `"butt"` en los segmentos de muro (o recortar
    el segmento por media anchura) para que los vanos midan su ancho real.
  - Grosor de arco de abatimiento/hoja de puerta/marcador de ventana
    proporcional al grosor del muro (no un valor fijo de 0.8-1.3 px).
  - Cota de muro horizontal: mover el texto fuera del trazo del muro (no
    solo +11px en X — calcular un offset perpendicular al muro real).
  - Tipografía de cotas/nombres escalada con el `scale` del SVG, no en px
    fijos — para que siga siendo legible tras el reescalado a
    `MAX_EDGE_PLAN`.
- `app/web/src/lib/floorplan/dimensions.ts` (`widthHeightChains` o quien
  corresponda): las particiones interiores deben generar su propia marca de
  cota, no colapsar a 2 números para todo el piso.
- `app/web/src/lib/floorplan/planFacts.ts`:
  - Filtrar esquinas a 180° (colineales) de `irregularCorners` — no son
    esquinas.
  - Nombrar el muro en `connectionSentence`/`openingPositionClause` (un
    identificador visualmente verificable, no "v1" — mismo criterio que
    `wallEndLabel` ya usa para los extremos).
  - Un cuarto SIN muros (`area: null`, de `roomLabels` — el caso "Terraza")
    debe listarse marcado explícitamente como espacio abierto ("Terraza
    (espacio abierto, sin muros que cerrarlo)" o equivalente), nunca
    mezclado sin distinción con los cuartos cerrados — para que la
    instrucción "no agregues ni quites cuartos ni paredes" no se
    malinterprete como "dibújale muros a esto".
- `app/api/renders.py`: quitar "Sin texto ni marcas de agua" de
  `_PLAN_CLAUSE` SI la Task 34 (SVG limpio) hace que esa instrucción deje de
  ser necesaria — decidir cuál de las dos rutas se toma, no ambas.
- `app/web/src/components/detail/RendersPanel.tsx`: `choosePreset` y
  `selectPlan` deben COMPONER (plan facts + cuerpo del preset), nunca
  pisarse. Definir el orden/formato de composición explícitamente.

**Tests (TDD, rojo primero):** por cada bug, un test que lo reproduce contra
el código real (no un mock) antes del fix, y lo confirma arreglado después
— mismo patrón de medición real que encontró los bugs. Regresión: los tests
existentes de Tasks 19-26 (conectividad, posición de puertas, ángulos)
siguen verdes.

**Definition of done:** suite frontend/backend verde, tsc limpio.

### Task 34 — SVG "limpio" (solo geometría) para mandar como referencia a OpenAI

**Files:**
- `app/web/src/lib/floorplan/planImage.ts`: nueva variante de
  `floorToSvgString` (o un parámetro `opts.annotations: boolean`) que omite
  nombres de cuarto, cotas y etiquetas de mueble — deja solo muros, vanos,
  arcos/marcadores y las siluetas de mueble sin texto. Esta es la imagen que
  se manda a OpenAI como referencia (resuelve la contradicción de la Task
  33 sin perder las anotaciones para el humano, que siguen viviendo en la
  versión completa si algo más las usa).
- Reusar esta misma fuente "limpia" como base para el overlay de
  composición de la Task 37 — un solo lugar que sabe dibujar la geometría
  exacta, dos consumidores.
- Nota a verificar antes de construir: existe un SEGUNDO renderer SVG
  determinista del plano, en Python, `app/api/lib/prospectus_html.py`
  (`_floorplan_svg`) — usado para el documento de prospecto, no para
  renders. Confirmar si es relevante reusar algo de ahí o si es
  deliberadamente un sistema aparte (documento humano vs. imagen de
  referencia para IA) antes de duplicar lógica de dibujo de muros.

**Tests:** el SVG limpio no contiene ningún `<text>`; el SVG completo (para
humano) sigue igual que antes — regresión explícita.

**Definition of done:** suite frontend verde, tsc limpio.

### Task 35 — `quality="high"` y más resolución de salida para el camino de plano

Cuantitativo (calculado, no supuesto): a `_TARGET_PIXELS = 1024*1024`
actual, un muro interior de 0.10 m en una casa de 20 m de ancho se pinta a
~5.8 px; en una de 30 m, ~4 px — sub-token para un modelo que tokeniza por
parches. Subir la resolución de salida no es solo "más nítido", es la
diferencia entre que un muro exista como señal codificable o no.

**Files:**
- `app/api/renders.py`: `generate_image`/`edit_kwargs` o el call-site en
  `routes/renders.py` — mandar `quality="high"` cuando `match_aspect=True`
  (camino de plano). Fotos quedan sin tocar (siguen en `auto`).
- `app/api/renders.py`: subir `_TARGET_PIXELS` para el camino de plano (no
  el de foto) — a algo del orden de 2.5-3.7 MP, dentro de lo que
  `_output_size` ya soporta (verificado hasta 3840×2160, "por encima de
  2560×1440 es experimental" según el addendum de fidelidad dimensional).
  Definir el valor exacto con criterio de costo/latencia aceptable, no solo
  "lo más alto posible".

**Tests:** mock de `images.edit`, confirma que el camino de plano manda
`quality="high"` y una resolución mayor que el camino de foto (que sigue
en `1024x1024`/`auto`).

**Definition of done:** suite backend verde.

### Task 36 — Validación empírica: ¿el resultado de IA conserva el encuadre?

No es una tarea de código — es un experimento con evidencia real, tras
cerrar Tasks 33-35 (para no confundir "el modelo se desalinea" con "el
modelo compensó un bug que ya arreglamos").

- Generar 1-2 renders reales (property 5, u otra con geometría conocida)
  con el pipeline ya arreglado.
- Comparar visualmente: ¿las esquinas/vanos del resultado de la IA caen
  razonablemente cerca de donde caerían si se superpusiera el SVG limpio
  sin ajuste? ¿Hay corrimiento, recorte o reescalado sistemático?
- Decidir con esa evidencia CÓMO se implementa la Task 37: overlay directo
  (si la alineación es buena), o si hace falta algún ajuste (recorte/
  escalado del overlay antes de componer) para que cuadre.

**Definition of done:** un veredicto por escrito con las imágenes de
evidencia, y la decisión de mecanismo para la Task 37.

### Task 37 — Implementar la composición de geometría exacta

**Files:** depende del veredicto de la Task 36. Como mínimo:
- `app/api/renders.py` o un módulo nuevo: tras recibir el resultado de
  `images.edit`, componer el SVG limpio (Task 34) rasterizado a la
  resolución de salida, encima del resultado, con Pillow (ya es
  dependencia del proyecto).
- Persistir SOLO el resultado ya compuesto como el render final (el
  usuario nunca ve la versión sin componer).

**Tests:** dado un resultado de IA simulado y una geometría conocida, el
compuesto final tiene los muros exactamente donde el SVG los pone (no donde
la IA los dibujó) — test de regresión geométrica real, no solo "no truena".

**Definition of done:** suite backend verde, render real de verificación.

### Task 38 — Verificación final

- Las 4 capas verdes con evidencia fresca.
- Render real contra la propiedad 5 (u otra con geometría conocida):
  comparación explícita antes/después — mismas quejas originales de
  Eduardo (cuartos agregados, puertas fuera de posición, paredes
  faltantes), confirmando cuáles se resuelven y documentando honestamente
  cuáles no.
