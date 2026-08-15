# Fidelidad dimensional en renders de plano — plan de implementación

> **Para Claude:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> para ejecutar tarea por tarea. Sigue al addendum
> `docs/plans/2026-08-11-renders-de-plano-mas-precisos.md` (Tasks 19-24, ya
> cerrado). Contexto validado con Eduardo por AskUserQuestion el 2026-08-12
> tras ver dos renders reales generados con el addendum anterior: el estilo
> y la conectividad ya funcionan bien, pero las proporciones salen más
> cuadradas que el plano real.

## Diagnóstico (verificado, no supuesto)

`app/api/renders.py:112` manda `size="1024x1024"` fijo a `images.edit`,
sin importar la forma real del plano. Verificado contra el SDK instalado
(`openai==3.0.0`, `.venv/.../openai/types/image_edit_params.py`):
**gpt-image-2 soporta resoluciones arbitrarias** `WIDTHxHEIGHT` (múltiplos
de 16, razón entre 1:3 y 3:1, hasta 3840×2160 — por encima de 2560×1440 es
experimental). La propiedad 5 mide 5.99×11.05m (razón 1.845) pero se le
pide un lienzo 1:1 — el modelo no tiene opción más que comprimir o
reinterpretar las proporciones.

También: `_MAX_EDGE = 1536` (el tope de resolución de la imagen de
referencia que se sube) fue pensado para fotos ("subir una foto de 12MP no
compra fidelidad, compra costo") — un plano es línea+texto, mucho más
liviano, y se beneficia de más resolución para que las cotas/nombres
lleguen legibles.

## Decisiones validadas con Eduardo

1. **Tamaño de salida ajustado a la razón de aspecto real del plano** —
   solo para el camino de plano, no toca fotos.
2. **Tope de resolución de la imagen de referencia sube, solo para
   planos** (fotos quedan en 1536px sin cambio).
3. **`planFacts` gana posición métrica de cada puerta/ventana a lo largo
   de su muro + ángulos de esquina donde no sean 90°** — ataca
   directamente "las puertas en el lugar correcto".
4. **`quality` de OpenAI queda sin tocar por ahora** (no forzar `'high'`)
   — probar primero el impacto de 1-3 antes de subir costo por render.

## Orden de ejecución

### Task 25 — Tamaño de salida + resolución de referencia ajustados para planos

**Files:**
- Modify: `app/api/renders.py`:
  - `_MAX_EDGE` se vuelve `_MAX_EDGE_PHOTO = 1536` (sin cambio de valor,
    solo renombre) y `_MAX_EDGE_PLAN = 2048` (nuevo, más alto — planos son
    línea+texto, no fotos de 12MP).
  - `_downscale(image_bytes, max_edge: int)` gana el parámetro explícito
    (hoy usa la constante fija) — llamador decide qué tope aplicar.
  - Nueva función pura `_output_size(image_bytes: bytes) -> str`: abre la
    imagen con PIL, calcula su razón de aspecto real, y devuelve el string
    `WIDTHxHEIGHT` más cercano soportado por gpt-image-2 (múltiplos de 16,
    razón entre 1:3 y 3:1, presupuesto de ~1-2 millones de píxeles totales
    — ni tan chico que pierda detalle ni tan grande que dispare costo/
    latencia sin necesidad). Debe ser determinista y testeable sin llamar
    a OpenAI.
  - `generate_image(image_bytes, content_type, prompt, *, max_edge, match_aspect: bool)`
    gana ambos parámetros explícitos: `max_edge` sustituye la constante
    fija en `_downscale`; cuando `match_aspect=True` llama a
    `_output_size(image_bytes)` para el parámetro `size` de `images.edit`
    en vez del `"1024x1024"` fijo.
- Modify: `app/api/routes/renders.py` — los tres call-sites de
  `generate_image` (`create_property_render`, `create_render_from_plan`,
  `edit_property_render`) pasan los parámetros correctos:
  - Foto (`create_property_render`): `max_edge=_MAX_EDGE_PHOTO,
    match_aspect=False` (comportamiento actual, sin cambio — cuadrado fijo).
  - Plano (`create_render_from_plan`): `max_edge=_MAX_EDGE_PLAN,
    match_aspect=True`.
  - Edición (`edit_property_render`): decide igual que ya decide la
    cláusula del prompt — vía `renders_db.chain_is_plan(...)`, mismo
    patrón que ya existe en ese handler.

**Tests (TDD, rojo primero):** `app/api/tests/test_renders.py`:
- `_output_size` con una imagen 599×1105 (proporción de la propiedad 5,
  escalada) devuelve un `WIDTHxHEIGHT` cuya razón está a menos de 0.02 de
  la razón real, ambos valores múltiplos de 16.
- `_output_size` con una imagen cuadrada devuelve algo cercano a 1024x1024.
- `_output_size` con una razón extrema (ej. 1:5) la recorta al límite 1:3
  soportado por la API, no lo excede.
- Foto: mock de `images.edit`, confirmar que se llama con
  `size="1024x1024"` (comportamiento actual intacto) y que el downscale
  usa 1536 de tope.
- Plano: mock de `images.edit`, confirmar que se llama con el `size`
  calculado por `_output_size` (no `"1024x1024"`) y que el downscale usa
  2048 de tope.
- Edición de una cadena de plano hereda `match_aspect=True`/tope 2048;
  edición de una cadena de foto hereda `match_aspect=False`/tope 1536.

**Definition of done:** `.venv/bin/python -m pytest app/api/tests/test_renders.py -q`
verde, suite completa verde. Commit:
`feat(renders): la salida de un render de plano respeta su proporción real`.

### Task 26 — planFacts: posición de puertas + ángulos de esquina

**Files:**
- Modify: `app/web/src/lib/floorplan/planFacts.ts` — para cada
  `Connection` de tipo puerta o ventana (de `roomConnections`, Task 20),
  agregar la posición métrica a lo largo del muro: `Opening.offset` es una
  fracción 0-1 de la longitud del muro — convertir a metros
  (`offset * longitudDelMuro`) y a una referencia legible ("a 1.20 m del
  extremo [v1/v2] del muro" — decide una convención clara de qué extremo
  es la referencia, documéntala). Para los ángulos de esquina: usar
  `cornerAngles` de `dimensions.ts` (ya existe, no reimplementar) y
  mencionar solo los que NO sean 90° (una esquina recta no aporta
  información nueva; solo las irregulares importan).
- Tests (TDD, rojo primero): `planFacts.test.ts` — una puerta a un offset
  conocido en un muro de longitud conocida → el texto incluye la distancia
  métrica correcta; una esquina no-recta conocida (ej. un corte en L) →
  aparece en el texto con su ángulo; un piso totalmente rectangular (todas
  las esquinas a 90°) → no menciona ángulos (evita ruido innecesario);
  regresión — conectividad/tipo/dimensiones de Tasks 20-21 siguen intactos.

**Definition of done:** `cd app/web && npm test` verde, `npx tsc --noEmit`
limpio. Commit:
`feat(renders): el prompt de plano ubica cada puerta en su muro y marca esquinas no rectas`.

### Task 27 — Verificación

- Las 4 capas (frontend, backend, tsc, build) verdes.
- Si el presupuesto/tiempo lo permite: generar un render real desde la
  propiedad 5 con el código nuevo y comparar visualmente la proporción del
  resultado contra el plano fuente real (5.99×11.05m) — ¿el lienzo ya no
  sale cuadrado?
