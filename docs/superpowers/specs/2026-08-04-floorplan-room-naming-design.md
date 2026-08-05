# Nombrar cualquier espacio en el editor de plano — diseño

Fecha: 2026-08-04 · Base: `origin/main` · Componente: editor de plano (`app/web`)

## Qué se pidió

Poder **nombrar cada habitación o espacio** del plano —esté o no cerrado por
muros— y que sea obvio cómo hacerlo. El objetivo mayor es referenciar esos
nombres al pedir renders de la distribución de las plantas; nombrar es el
habilitador. Esta pieza cubre **solo el nombrar**; el pipeline plano → renders
es trabajo aparte.

## Estado actual (lo que ya existe)

El modelo de datos y el reducer **ya soportan un nombre como punto libre**:

- `FloorGraph.rooms: Room[]`, con `Room { name: string; cx: number; cy: number }`
  (`lib/floorplan/types.ts`). Se serializa dentro del blob `geometry`, así que
  **ya persiste** al guardar. No hace falta migración ni cambio de backend.
- `RENAME_ROOM` (`lib/floorplan/reducer.ts:196-202`) busca el cuarto guardado más
  cercano a `(cx, cy)`; si no hay ninguno, **crea uno nuevo** (`f.rooms.push(...)`).
  Es decir, la creación de un nombre en un punto arbitrario ya está resuelta a
  nivel de estado.

## El hueco: es puramente de UI

Hoy solo se puede nombrar un espacio **cerrado**, por dos razones, ambas en la
capa de dibujo:

1. **El input de nombre solo se abre picando la etiqueta de un cuarto
   auto-detectado.** En `FloorPlanEditor.tsx:254` el `pointerdown` abre la
   edición cuando `elk === 'room'`, y esas etiquetas se dibujan únicamente para
   las caras trazadas.
2. **Solo se dibujan las caras cerradas.** El lienzo itera
   `rooms = roomAreas(floor)` (`FloorPlanEditor.tsx:172`), que traza las caras
   encerradas por muros (`lib/floorplan/rooms.ts`). Un espacio abierto no produce
   cara → no hay etiqueta → no hay dónde picar → no se puede nombrar.

Los nombres guardados (`floor.rooms`) hoy se muestran solo indirectamente: una
cara trazada adopta el nombre del cuarto guardado más cercano
(`nearestRoomName`). Un nombre sin cara que lo reclame es invisible.

## Diseño

Cinco cambios, todos en el frontend del editor. Sin cambios de esquema, backend
ni API.

### 1. Herramienta "nombrar"

Se agrega `'room'` a la unión `ui.tool` y un botón en la barra de herramientas.
Con la herramienta activa, un `pointerdown` en **cualquier** punto del plano
despacha `SET_EDIT_ROOM` con el punto en coordenadas de mundo
(`pointerToWorld`), sin exigir una cara ni iniciar pan. Aparece el input de
nombre en ese punto; al confirmar, `RENAME_ROOM` crea la etiqueta ahí.

### 2. Dibujar todas las etiquetas guardadas

El lienzo dibuja una etiqueta clickeable/editable por **cada** `floor.rooms`, no
solo por cara trazada:

- Si el punto guardado cae **dentro de una cara trazada**, se representa con la
  etiqueta de esa cara, que además muestra los **m²** (comportamiento actual).
- Si **no** cae en ninguna cara (espacio abierto), se dibuja como etiqueta libre
  con **solo el nombre** (sin área).

**Dedup:** un cuarto guardado se dibuja como etiqueta libre solo si ninguna cara
trazada lo contiene, para no dibujarlo dos veces.

### 3. Renombrar sigue igual

Picar una etiqueta con la herramienta "select" abre el input de nombre — ahora
funciona tanto para las auto-detectadas como para las colocadas a mano. Sin
cambios de comportamiento aquí.

### 4. Borrar una etiqueta

Nueva acción `DELETE_ROOM { cx, cy }` que elimina el cuarto guardado más cercano
dentro de un umbral pequeño. Se conecta a la herramienta "delete" ya existente:
picar una etiqueta con "delete" la quita. Necesario porque ahora las etiquetas
pueden ser puntos libres, no atados a una cara.

### 5. Descubrible

La herramienta "nombrar" queda visible en la barra con etiqueta clara. El input
de nombre para un punto nuevo arranca **vacío** (el `editName` no encuentra
coincidencia previa y devuelve `''`).

## Fuera de alcance

- Arrastrar una etiqueta para moverla (se puede añadir después).
- Auto-nombrado de cuartos.
- El pipeline plano → renders (piezas 2 y 3 del hilo original).
- El pan permanece en "select" (arrastrar vacío); la nueva herramienta no lo toca.

## Modelo de datos

Sin cambios. Se reutiliza `FloorGraph.rooms` y la serialización existente del
blob `geometry`. Sin migración.

## Pruebas (vitest + Testing Library)

- Con la herramienta "nombrar", picar un área **abierta** (sin muros que
  cierren) abre el input; escribir un nombre + Enter crea una entrada en
  `floor.rooms` y dibuja su etiqueta.
- La etiqueta a mano queda en el modelo (`getModel`) y marca el editor como sucio.
- Picar una etiqueta existente (auto o a mano) con "select" abre el renombrado y
  actualiza el nombre.
- La herramienta "delete" sobre una etiqueta la elimina.
- Una etiqueta en espacio abierto **no** se pierde al mover muros ni al guardar.

## Verificación

- `tsc --noEmit` limpio; `vitest` verde (incluidas las nuevas).
- Verificación manual en el navegador: colocar una etiqueta en un espacio
  abierto de **Locales Salón Escobedo** (ambas plantas), guardar, recargar y
  confirmar que persiste.
