# Tipo de cuarto explícito + mapa de color en renders de plano — diagnóstico y plan

Fecha: 2026-08-14. Diagnóstico con panel de 6 subagentes independientes (3
Codex, 3 Claude), cada uno con un ángulo distinto — geometría del bug real,
diseño del campo `RoomType`, investigación de señal visual, guardrails de
editor, arquitectura ideal, capacidades de `images.edit` — sobre datos
reales de una propiedad concreta, no un caso sintético. Reporte completo
publicado como Artifact durante la sesión; este documento es el registro
permanente en el repo.

## Motivo

> "en local salon escobedo general el primer piso bien pero el segundo esta
> todo mal. no respeta las secciones. pone esclaras donde hay mabos donde
> debe de ir la escalera pone un cuarto. Siento que tiene que ver con el
> texto que se pone en el prompt y que no esta viendo los textos que estan
> en el plano. [...] no sera bueno poder marcar explicatmente que es cada
> cuarto [...] de un dropdown o similar a como ponemos los muebles?"

## Diagnóstico (verificado contra código y datos reales, no supuesto)

Propiedad real: "Locales Salon Escobedo" (id=5). Planta Baja renderiza
limpio; Planta Alta no. Cuatro causas raíz, ranqueadas por contribución:

1. **La identidad de cada cuarto viajaba SOLO por prosa.** Desde un
   addendum previo, la imagen de referencia que recibe OpenAI nunca lleva
   texto (`planImage.ts`, `floorToPngBlob` con `annotations:false` —
   decisión correcta para evitar que el modelo reprodujera mal glifos, pero
   con el efecto colateral de que el modelo nunca VE qué cuarto es cuál).
   Toda la correlación dependía de que 11 descripciones de prosa
   (`planFacts.ts`) se mantuvieran alineadas con 11 regiones sin marcar
   durante toda la generación — funciona en 8 zonas (Planta Baja), no en 11
   (Planta Alta).
2. **El catálogo de palabras clave no reconocía "escalera" ni
   "recibidor".** En el prompt real que se mandó (render id=37, guardado en
   la BD), "ESCALERAS ACCESO" y "RECIBIDOR PA" no llevaban ningún `tipo:`,
   solo sus medidas.
3. **Bug real de datos, único de esta propiedad:** Planta Alta tenía 11
   caras cerradas trazadas pero solo 8 con nombre. Una de las 3 sin nombre
   medía **0.00 m²** — un subgrafo colgante y desconectado del resto del
   plano (dos vértices de grado 1 unidos por un vértice intermedio), no un
   cuarto real. El trazador de darts (`rooms.ts::traceFaces`), al llegar a
   un vértice de grado 1, rebota y regresa por donde vino, produciendo una
   cara fantasma. Esa misma arista colgante tenía **2 ventanas reales** —
   no era basura sin contenido, sino un tramo de muro que el usuario nunca
   terminó de conectar.
4. **Nada corrige el contenido después de generarlo.** La compositación de
   geometría de un addendum previo (`_composite_geometry`, Task 37) solo
   refuerza píxeles de muro — el mobiliario/contenido de cada cuarto queda
   100% a criterio del modelo, sin red de seguridad.

Comparé las imágenes reales generadas: Planta Baja, limpia. Planta Alta con
la escalera en su lugar pero solo 1 de 2 baños reconocible, y una mesa de
comedor donde el prompt describe un vestíbulo.

## Decisión (Eduardo, tras ver el diagnóstico)

Primeros principios, no conservar lo ya construido por inercia. Tres fases,
ejecutadas en orden, cada una con pruebas y verificación contra datos
reales antes de avanzar a la siguiente:

### Fase 0 — arreglos de código, sin tocar el modelo de datos

- `rooms.ts::traceFaces` rechaza caras degeneradas (`area ≈ 0`) en la
  fuente — único choke point compartido por `interiorPolygons`/`roomAreas`/
  `roomPolygons`/`roomConnections`, así que el fix no requirió tocar cada
  consumidor por separado.
- `planFacts.ts::ROOM_TYPE_KEYWORDS` gana `escalera`/`recibidor`.
- La geometría colgante de la propiedad 5 (con sus 2 ventanas reales) se
  dejó intacta a propósito — Eduardo la revisa él mismo en el editor,
  decidir si reconectarla o borrarla requiere criterio que el código no
  tiene.

### Fase 1 — campo `RoomType` explícito (dropdown, como los muebles)

- `types.ts`: `RoomType` (17 valores, incl. `otro` como escape hatch
  explícito) + `ROOM_TYPE_CATALOG`, mismo patrón que `FIXTURE_CATALOG`
  ("el catálogo es dato, no lógica"). `Room.type?: RoomType` — opcional,
  cero migración, mismo patrón que `Edge.kind?`.
- El input flotante de nombre de cuarto (`FloorPlanCanvas.tsx`) gana un
  `<select>` de tipo justo debajo, mismo commit que el nombre.
- `planFacts.ts`: el tipo explícito manda; el catálogo de palabras clave
  (Fase 0) baja de rango a *shim* de compatibilidad para levantamientos sin
  tipo capturado.

### Fase 2 — mapa de color por tipo de cuarto en la imagen de referencia

- Paleta de 16 colores (HSL, 22.5° de separación, calculada con Python — no
  elegida a ojo), verificada contra los umbrales reales de
  `app/api/renders.py` (`WALL_LUMINANCE_MAX=60`, `_BBOX_BG_THRESHOLD=245`):
  luminancia mínima 191.5, máxima 226.5 — ningún color se confunde jamás
  con un muro ni con la página en blanco.
- `planImage.ts::floorToSvgString` gana `opts.roomTypeFill`: un relleno
  plano por `RoomType` bajo las líneas de muro. Independiente de
  `annotations` — un relleno de color no es texto, no tiene glifos que el
  modelo pueda reproducir mal (la misma categoría de tarea que ya funciona
  hoy para puertas/ventanas/muebles).
- `planFacts.ts` gana `opts.includeColorLegend`: una leyenda final
  (`color = tipo`) con SOLO los colores realmente usados en ese piso, con
  instrucción explícita de que el color es guía de distribución, no
  acabado a reproducir.
- `resolveRoomType(name, explicitType)`, exportada, es el ÚNICO punto de
  verdad de "cuál es el tipo efectivo de este cuarto" — la reusan tanto el
  párrafo de texto como el relleno de la imagen, así que texto e imagen
  nunca pueden describir un tipo distinto para el mismo cuarto.

**Validado con un experimento real** (no un caso sintético): reusando el
código real de producción (`compose_plan_prompt`, `generate_image`,
incluida la compositación de geometría de Task 37 — nada reimplementado
aparte), un solo render de Planta Alta con el mapa de color mostró los 2
baños como espacios distintos (antes solo 1 reconocible) y el vestíbulo
como un vestíbulo real (antes una mesa de comedor inventada que no existe
en los datos de ese piso). Una sola corrida (n=1, `gpt-image-2` no es
determinista), pero la diferencia ataca exactamente los síntomas
reportados, no algo tangencial.

Conectado como comportamiento por default en los dos caminos reales que
generan un render de plano (`RendersPanel.tsx` + `LevantamientoPanel.tsx`,
tanto el flujo de un piso como "GENERAR TODOS LOS PISOS") — no quedó
detrás de ninguna bandera oculta.

## Fuera de alcance (a propósito)

- **Fase 3** (refuerzo dirigido con el parámetro `mask` de
  `images.edit` sobre zonas históricamente confundidas) — contingente al
  resultado de Fase 2, que ya midió bien; no se empieza sin evidencia de
  que todavía haga falta.
- **Los 2 cuartos reales sin nombre y el tramo de muro colgante** de la
  propiedad 5 — quedan para que Eduardo los revise en el editor; requieren
  criterio sobre la construcción real, no una decisión de código.
- **Guardrails de UI** para avisar de cuartos sin nombre/degenerados antes
  de generar un render (badge por piso, resaltado en canvas) — diseñados
  por el panel de diagnóstico, no implementados en este addendum.
