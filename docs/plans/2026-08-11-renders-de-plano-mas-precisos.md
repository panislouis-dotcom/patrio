# Renders de plano más precisos — plan de implementación

> **Para Claude:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> para ejecutar tarea por tarea. Contexto validado con Eduardo por
> AskUserQuestion el 2026-08-11 — ver la sección "Decisiones" abajo.

**Goal:** que el primer intento de un render generado desde un levantamiento
llegue mucho más cerca de la distribución real, sin necesitar 6+ rondas de
edición manual como las dos cadenas históricas de referencia
(`property_renders` id 7→11 y 16→19, propiedades 5 y 10).

## Diagnóstico (evidencia, no suposición)

Se revisaron las dos cadenas de renders reales que Eduardo hizo antes de
que existiera este feature. Hallazgos:

1. **El plano-imagen que se manda al modelo hoy NO dibuja puertas ni
   ventanas.** `planImage.ts::floorToSvgString` pinta cada muro como una
   línea sólida continua — el hueco de cada `Opening` (offset/width) existe
   en el modelo mas nunca se pinta. El modelo de IA no tiene forma de saber
   dónde están las puertas ni qué cuarto conecta con cuál.
2. Esto explica exactamente por qué las ediciones manuales fueron casi
   todas correcciones de puertas/conectividad ("la puerta de HABITACION
   DP3 no debe estar conectada al RECIBIDOR...").
3. El **estilo** que logra el modelo de entrada ya es bueno (piso de
   madera, muebles realistas, tonos cálidos) — el problema no es estilo,
   es que no ve la conectividad real.
4. Tampoco se mandan cotas/dimensiones en la imagen — solo en el texto.
5. Los presets de estilo actuales (Jardín regional, Fachada minimalista,
   Alberca...) son para FOTOS de exteriores/interiores — no tiene sentido
   ofrecerlos para un render de plano.

## Decisiones (validadas con Eduardo)

1. **Biblioteca de presets separada por tipo.** `render_prompts` gana
   `kind: 'photo' | 'plan'`. Los 6 presets existentes quedan `photo`. Se
   siembran 5-6 presets nuevos `plan` de ESTILO (no de área).
2. **Conectividad completa por puerta** en el texto del prompt: por cada
   puerta, qué dos cuartos une; por cada ventana, en qué cuarto y muro.
3. **Alcance adicional confirmado:** inferir tipo de cuarto por nombre
   (cocina/baño/recámara/sala) para reforzar qué mobiliario espera ahí, y
   considerar toda la info geométrica relevante del plano (no solo área
   por cuarto — también sus dimensiones aproximadas).

## Orden de ejecución

### Task 19 — Huecos de puerta/ventana + cotas en planImage.ts

**Files:**
- Modify: `app/web/src/lib/floorplan/geometry.ts` — extraer `edgeAxis`
  desde `FloorPlanCanvas.tsx` (hoy función local no exportada) a un export
  compartido: `edgeAxis(p1, p2): {L, ux, uy, nx, ny}`. Es la MISMA función,
  solo cambia de casa — no reimplementar la matemática.
- Modify: `app/web/src/components/FloorPlanCanvas.tsx` — importa
  `edgeAxis` desde `geometry.ts` en vez de definirla local. Cero cambio de
  comportamiento (mismo test de regresión que ya cubre el editor).
- Modify: `app/web/src/lib/floorplan/planImage.ts`:
  - Cada muro (`Edge` no-ghost) se dibuja como dos segmentos con un hueco
    donde caiga cada `Opening` (mismo cálculo offset/width vía `edgeAxis`
    que usa el editor — replicar la lógica de gap de
    `FloorPlanCanvas.tsx:176-198`, sin el estado de selección/hover que ahí
    es UI y aquí no aplica).
  - Puertas: dibujar el arco de abatimiento (mismo path que el editor).
    Ventanas: marcador simple (línea perpendicular corta), igual que el
    editor.
  - Cotas: reusar `dimensions.ts::widthHeightChains`/`cotaEdges` para
    dibujar las cadenas de cotas ancho/alto en el SVG exportado (hoy el
    export no dibuja ninguna cota).
- Tests (TDD, rojo primero): `planImage.test.ts` — un muro con una puerta
  produce DOS segmentos de línea con un hueco entre ellos (no una línea
  continua) + el arco de la puerta presente; una ventana produce un hueco +
  su marcador; las cotas aparecen en el SVG con los valores correctos;
  ghosts siguen excluidos (no regresión de Task 9); fixtures siguen
  presentes (no regresión de Task 12).

**Definition of done:** `cd app/web && npm test` verde, `npx tsc --noEmit`
limpio. Commit: `feat(renders): el plano-imagen dibuja puertas, ventanas y cotas`.

### Task 20 — Conectividad de cuartos vía puertas

**Files:**
- Modify: `app/web/src/lib/floorplan/rooms.ts` — nueva función pura
  `roomConnections(f: FloorGraph): Connection[]` donde
  `Connection = { edgeId, openingIndex, kind: 'door'|'window', roomA: string | 'exterior', roomB: string | 'exterior' }`.
  Usa el mismo mecanismo de `traceFaces` (cada arista pertenece a
  exactamente 2 darts/caras) + `roomNameInside` (ya existe, resuelve nombre
  por contención) para mapear cada cara a su nombre de cuarto (o
  `'exterior'` si es la cara exterior). Una arista con opening conecta las
  dos caras que la bordean.
- Tests (TDD, rojo primero): `rooms.test.ts` — dos cuartos con una puerta
  entre ellos → una conexión `door` con los nombres correctos en ambos
  lados; una ventana en un muro exterior → conexión `window` con
  `roomB: 'exterior'`; una fantasma con opening no puede existir (Task 7 ya
  lo rechaza) — no hace falta cubrir ese caso aquí.

**Definition of done:** suite verde, tsc limpio. Commit:
`feat(plano): calcula qué cuartos conecta cada puerta y ventana`.

### Task 21 — planFacts: conectividad + tipo de cuarto + dimensiones

**Files:**
- Modify: `app/web/src/lib/floorplan/planFacts.ts`:
  - Por cada conexión de `roomConnections`: una oración explícita
    ("X conecta por puerta con Y", "Z tiene ventana hacia el exterior").
  - Tipo de cuarto por palabra clave en el nombre (cocina, baño/wc, recámara/
    habitación/dormitorio, sala/estancia, comedor, etc.) — catálogo
    explícito de keywords→tipo, no regex mágico suelto (estructura de datos,
    no pattern matching disperso, por la convención del repo).
  - Dimensiones aproximadas por cuarto además del área (bounding box del
    cuarto, no solo m²) cuando el cuarto es medible.
- Tests (TDD, rojo primero): `planFacts.test.ts` — conectividad aparece en
  el texto con los nombres correctos; tipo de cuarto inferido correctamente
  para varios nombres reales (incl. los de los 2 ejemplos: "HABITACION",
  "ESTANCIA", "BAÑO", "cocina dp1"); dimensiones por cuarto presentes.

**Definition of done:** suite verde, tsc limpio. Commit:
`feat(renders): el prompt de plano describe conectividad, tipo de cuarto y dimensiones por espacio`.

### Task 22 — render_prompts.kind + migración 041 + presets de estilo

**Files:**
- Create: `db/migrations/041_render_prompts_kind.sql` — `ALTER TABLE
  render_prompts ADD COLUMN kind text NOT NULL DEFAULT 'photo' CHECK (kind
  IN ('photo','plan'))`; backfill explícito de los 6 sembrados existentes a
  `'photo'` (ya son el default, pero decir por qué en un comentario);
  INSERT de 5-6 presets nuevos `kind='plan'` de ESTILO puro (sin describir
  áreas específicas) — ej. "Cálido contemporáneo" (el que ya funcionó en
  los 2 ejemplos), "Minimalista nórdico", "Industrial urbano", "Colorido y
  vibrante", "Clásico cálido". Regenerar `db/schema.sql` (usar el método
  del docker de dbmate documentado en memoria, no el pg_dump local).
- Modify: `app/api/renders_db.py` — `add_prompt`/list funcions aceptan y
  devuelven `kind`; `list_prompts` acepta filtro opcional `kind`.
- Modify: `app/api/routes/renders.py` — `POST /api/render-prompts` acepta
  `kind` (default `'photo'` si no viene, por compat); `GET
  /api/render-prompts` acepta `?kind=`.
- Tests (TDD, rojo primero): `test_renders.py` — los 6 sembrados tienen
  kind=photo; los presets nuevos existen con kind=plan; crear un prompt sin
  kind explícito default a photo; filtro por kind funciona en list.

**Definition of done:** pytest verde (incl. suite completa), migración
aplica limpio contra la BD de test. Commit:
`feat(renders): biblioteca de presets separada por foto y plano`.

### Task 23 — Frontend: filtrar presets por kind

**Files:**
- Modify: `app/web/src/lib/types.ts` — `RenderPrompt.kind: 'photo'|'plan'`.
- Modify: `app/web/src/lib/api.ts` — `listRenderPrompts` acepta filtro
  opcional; `createRenderPrompt` manda `kind`.
- Modify: `app/web/src/components/detail/RendersPanel.tsx` — el selector
  de presets solo muestra los del `kind` correspondiente al `source` del
  panel (`photos`→photo, `plan`→plan); "guardar como nuevo" desde un panel
  `plan` guarda con `kind='plan'`.
- Tests: `RendersPanel.test.tsx` — modo photos solo ofrece presets photo;
  modo plan solo ofrece presets plan; guardar-como-nuevo en modo plan
  persiste kind correcto.

**Definition of done:** suite frontend verde, tsc limpio, build limpio.
Commit: `feat(renders): el selector de presets separa estilo de foto y de plano`.

### Task 24 — Verificación integral

- Las 4 suites completas (frontend, backend, tsc, build) verdes.
- Si el presupuesto/tiempo lo permite y hay `OPENAI_API_KEY` real
  disponible (confirmado que sí): generar UN render real desde el
  levantamiento de la propiedad 5 o 10 (ya viven en `patrio`, con geometría
  real) usando el nuevo flujo, y comparar visualmente contra el primer
  intento histórico (`property_renders` id 7 o 16) — ¿se acerca más a la
  distribución real sin necesitar ediciones? Reportar con capturas.
