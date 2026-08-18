# Elegir el render — una estrella, un dueño por piso y por foto — diseño

Fecha: 2026-08-17 · Rama: `feat/render-elegido-por-piso` · Base: `feat/plano-en-prospecto` (464303f)

## Qué se pidió

Al ver el prospecto de la PR #45 con datos reales, junto al plano de cada piso
aparecían hasta 7 imágenes de render — 2 emparejadas más una tira suelta con el
resto. «Se pusieron todos los renders cuando solo debe de haber uno por piso.»
La corrección propuesta fue una estrella: marcar cuál render es el bueno para
cada piso, y que el PDF muestre solo ese.

Al probarlo se amplió el alcance dos veces, con la misma lógica cada vez:

1. **La tira suelta no debería existir.** No solo "lo que no cupo" — también
   los renders hechos a partir de fotos, que viven ahí desde antes de que el
   plano llegara al PDF. Si el punto es «plano y 1 render», entonces es
   «plano y 1 render, foto y 1 render» — no hay una tercera categoría de
   sobrantes.
2. **La misma estrella, no dos mecanismos.** Igual que un piso puede tener
   varios renders y solo uno se elige, una foto fuente (cocina, sala, fachada)
   puede tener varios renders propios, y de esos también se elige uno.

## La decisión central: un dueño por grupo, garantizado por la base de datos

`property_renders` gana **una** columna, `is_chosen`, y **dos** índices únicos
parciales — no un mecanismo por piso y otro por foto. Un render nace de un
piso (`floor_id` + `source_variant`) o de una foto (`source_image_id`), nunca
de los dos, así que los dos índices nunca compiten entre sí:

```sql
CREATE UNIQUE INDEX idx_render_chosen_per_floor
  ON property_renders (property_id, floor_id, source_variant)
  WHERE is_chosen AND floor_id IS NOT NULL;

CREATE UNIQUE INDEX idx_render_chosen_per_photo
  ON property_renders (property_id, source_image_id)
  WHERE is_chosen AND source_image_id IS NOT NULL;
```

El único precedente real en el repo (`cotizaciones.is_selected`,
`db_proveedores.py:350-370`) garantiza «solo uno» con una transacción
apaga-todos-luego-prende-uno, sin constraint. Aquí se sube un nivel: «solo uno»
es la razón de ser de la feature, no un efecto secundario de cómo se escribe —
así que la base de datos lo hace físicamente imposible, sin importar qué
código lo escriba después. La transacción de la API sigue existiendo (ver
abajo) como primera línea; el índice es la red de seguridad si algo la
rodea.

## Alcance: solo el PDF

Marcar la estrella no borra nada ni oculta nada en el editor. `RendersPanel`
sigue mostrando todas las cabezas de cada piso/foto, con o sin estrella — la
estrella es una etiqueta más en la tarjeta, junto a "Trabajar sobre este" y
"Borrar". Solo `_opportunity_detail()` en el PDF se vuelve selectivo. Nada se
pierde: lo que cambia es qué imprime este documento en particular.

## Sin estrella, no hay imagen — nunca un "el más reciente"

Un piso o foto sin ninguna marca no imprime nada junto a su plano/foto. No cae
a una tira, no se rellena con el render más nuevo. Es el mismo principio que
ya sigue el resto del documento (`_strip` vacío → `""`): si nadie decidió cuál
es el bueno, el documento no adivina por ti. Empuja a elegir en vez de
mostrar algo que nadie revisó a propósito.

## Editar sobre un elegido lo desmarca de facto, sin código nuevo

`RendersPanel` ya solo pinta **cabezas** de cadena (`computeHeads()`) — un
render con algo editado encima deja de ser cabeza y deja de listarse. Por eso
la estrella solo tiene botón en cabezas, y por eso la regla «editar sobre un
elegido lo saca del PDF hasta que se vuelva a elegir» sale gratis: la fila
vieja se queda con `is_chosen = TRUE` en la base (nadie la borra), pero como
ya no es cabeza, ni la UI ni `renderHeads` (lo que llega al PDF) la vuelven a
ver. No hace falta un trigger ni un `UPDATE` en el momento de editar.

## FOTOS gana el mismo selector que ya tiene el plano

Hoy `RendersPanel` en modo `photos` mezcla los renders de TODAS las fotos
fuente de la propiedad en una sola lista — no hay equivalente al
`selectedFloorId` de `LevantamientoPanel`. Para poder elegir 1 por foto, el
panel necesita el mismo selector, ahora de foto fuente en vez de piso: mismo
patrón visual, mismo componente adaptado, quien ya aprendió a usarlo en un
lado lo usa igual en el otro.

## El PDF: una fila es una fila, sea plano o foto

`_plan_side()` (de la PR #45) ya emite lo que le pasen del lado izquierdo como
HTML crudo — hoy siempre un `<svg>`, pero no tiene por qué serlo. Una foto es
literalmente un `<img src="...">` en el mismo hueco. Por eso "Fotos y
propuesta" no es una sección nueva con su propio HTML: son filas del mismo
componente (`_plan_row`/`_plan_side`/`_plan_block`) alimentadas con pares
`(foto, su render elegido)` en vez de `(plano, su render elegido)`. Una
función nueva, `_photo_rows()`, construye esos pares — misma forma que
`_plan_rows()`, pero la llave de grupo es `source_image_id` en vez de
`(floor_id, source_variant)` y no hay concepto de Antes/Después (una foto no
tiene variantes).

Sin estrella marcada en ninguna foto de la propiedad → la sección "Fotos y
propuesta" no existe, igual que hoy pasa con "Plano y propuesta" si no hay
levantamiento. **No queda ninguna tira suelta en ningún lado del documento.**

## Datos

- Migración `046_render_is_chosen.sql`: la columna + los dos índices, sin
  backfill (ninguna propiedad tiene hoy una elección honesta).
- `PUT /api/properties/{id}/renders/{render_id}/choose` — lee `floor_id`,
  `source_variant`, `source_image_id` de la fila objetivo para saber a qué
  grupo pertenece, apaga `is_chosen` en el resto del grupo y lo prende en
  esta, en un mismo bloque de conexión (mismo patrón que
  `select_cotizacion`). Un render sin piso NI foto (huérfano, su foto o su
  piso se borraron) no pertenece a ningún grupo — 404/422 legible, no se
  puede elegir.
- `DELETE /api/properties/{id}/renders/{render_id}/choose` — apaga la marca
  sin elegir otra.
- `isChosen: boolean` llega gratis al frontend vía `_row_to_dict` (mismo
  `SELECT *` de siempre), igual que ya llegan `floorId`/`sourceVariant`.

## Qué se borra de la PR #45

`_PAIRED_RENDERS_MAX` y su lógica de recorte-y-sobrante en `_plan_rows()`
desaparecen — con «uno por grupo, garantizado por la base de datos» ya no
hace falta capar nada. `leftovers` como concepto también desaparece: no hay
ningún renglón del documento que reciba «lo que no se pudo emparejar».

## Pruebas

- Migración: índice único rechaza un segundo `is_chosen=TRUE` en el mismo
  grupo (piso y foto, por separado); permite el mismo `render_id` en dos
  propiedades distintas sin problema; `floor_id IS NULL` y
  `source_image_id IS NULL` nunca chocan entre sí.
- `choose_render`/`unchoose_render`: elegir uno apaga el anterior del mismo
  grupo; elegir uno de OTRO grupo no toca nada; render huérfano → error
  legible; `DELETE` sin nada elegido no truena.
- `_plan_rows`: con estrella hay exactamente 1 render por lado; sin estrella
  ese lado es `None`; ya no hay `leftovers` que devolver (la función cambia
  de firma: regresa solo `rows`).
- `_photo_rows` (nueva): mismo set de pruebas que `_plan_rows` pero sin el
  caso Antes/Después.
- `RendersPanel`/`LevantamientoPanel`: clic en `☆` marca y desmarca cualquier
  otra tarjeta del mismo grupo en pantalla, sin esperar respuesta del
  servidor; el selector de foto en modo `photos` filtra igual que ya filtra
  el de piso.
- Verificación visual: un PDF real contra las propiedades 5 y 10 con al menos
  una estrella marcada por piso — confirmar que solo aparece 1 imagen junto
  a cada plano y que la sección de fotos, si no hay ninguna marcada, no
  aparece.
