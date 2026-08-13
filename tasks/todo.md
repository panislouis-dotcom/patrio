# Levantamientos — checklist de ejecución

Plan: `docs/plans/2026-08-10-levantamientos-plan.md`
Diseño: `docs/plans/2026-08-10-levantamientos-design.md`
Rama: `feat/levantamientos`

## Fase 1 — Refactor puro del editor
- [x] Task 1: extraer despacho de herramientas de FloorPlanEditor (88adf08; spec ✅, calidad ✅)

## Fase 2 — Schema v3 + tabs
- [x] Task 2: FloorSet + envelope v3 + migrador (1a945c8; spec ✅, calidad ✅)
- [x] Task 3: reducer/editor/ficha sobre FloorSet (1a945c8; spec ✅, calidad ✅)
- [x] Task 4: tabs LEVANTAMIENTO ORIGINAL/PLANEADO + re-clonación (f085bd7..958be73; spec ✅×2, calidad ✅)
- [x] Task 5: prospecto lee v3 (planeado si existe, con geometría dibujada) (1fcf9fa; spec ✅, calidad ✅)
  - Nota producto: _floorplan_svg no tiene llamador en producción (plano excluido del prospecto a petición de Louis)
- [x] Task 6: e2e del renombre (754484e; adelantado a la pasada del Task 4; spec ✅)

**FASE 2 COMPLETA**

## Fase 3 — Paredes fantasma
- [x] Task 7: Edge.kind 'ghost' en el motor (9c70673; spec ✅, calidad ✅; bug real de split cazado)
- [x] Task 8: herramienta DIVISIÓN en el editor (50b6959+b624664; spec ✅, calidad ✅ con mutación verificada)
- [x] Task 9: fantasmas invisibles en cotas/export/renders/PDF (44dc663; spec ✅, calidad ✅)
  - Bug real cazado de paso: FloorPlanCanvas.tsx dibujaba la cota de una fantasma

**FASE 3 COMPLETA**

## Fase 4 — Muebles
- [x] Task 10: Fixture + catálogo + reducer (0bd2cd9; spec ✅, calidad ✅)
- [x] Task 11: paleta, canvas, inspector (96433d9+4b7e50e; spec ✅, calidad ✅ con mutación verificada; rotación CCW→rotate(-θ) validada a mano)
- [x] Task 12: muebles en renders y PDF (405d07c; spec ✅, calidad ✅ — rotación re-derivada en 3 módulos, coincide)

**FASE 4 COMPLETA: muebles con dimensiones reales, catálogo de 15, editor con paleta/arrastre/inspector, visibles en render y PDF**

## Fase 5 — Renders por fuente
- [x] Task 13: migración 040 + variante en renders_db (edf56c4+a7f9c0c; spec ✅, calidad ✅; backfill recursivo trazado a mano y correcto)
- [x] Task 14: from-plan con variante + fix event loop (48ead99; spec ✅, calidad ✅; bug real de bloqueo de servidor corregido)
  - ⚠️ COMPUERTA DE MERGE: NO mergear a main (auto-deploy qa+prod) hasta cerrar Fase 5 completa
- [x] Task 15: planFacts (prompt enriquecido) + api frontend (f9f9563; spec ✅, calidad ✅)
  - Nota UX diferida a Task 16/17: choosePreset/selectPlan se pisan el texto en vez de componerse (pre-existente, no regresión)
- [x] Task 16: FOTOS con GALERÍA | RENDERS (muere el tab RENDERS) (cceb53f; spec ✅, calidad ✅; filtro por nodo verificado correcto por inducción)
  - Pendiente para Task 17: RendersPanel.Props debe ser unión discriminada (source='plan' sin variant falla en silencio, lista vacía sin error)
- [x] Task 17: RENDERS dentro de cada levantamiento (1435cf3+d04917e; spec ✅, calidad ✅; flake real de Task 16 cazado y arreglado con verificación mecánica)

**FASE 5 COMPLETA — compuerta de merge satisfecha: variant llega a ambas variantes en la UI real**

## Fase 6 — Cierre
- [x] Task 18: e2e + verificación visual (sin push — queda para que Eduardo decida)

## Review

**Part A — e2e (código):**
- `check-renders-tab.mjs`, `diagnose-generar.mjs`, `shot-generando.mjs`: los tres seguían
  clicando un tab `RENDERS` de nivel superior que Task 16 eliminó. Los tres ahora entran
  por FOTOS → RENDERS (el sweep de la Tarea 16 solo había marcado el primero como
  pendiente; los otros dos estaban igual de rotos y no se habían tocado).
- `09-propiedad-detalle.spec.ts`: agregadas 3 pruebas — sub-nav GALERÍA|RENDERS en FOTOS,
  sub-nav PLANO|RENDERS en LEVANTAMIENTO ORIGINAL, y un camino dorado nuevo (fixture propia)
  que cubre PARTIR DEL ORIGINAL clonando el original guardado, más DIVISIÓN y MUEBLE
  colocados y verificados vía su inspector (ambas herramientas colocan su plantilla con un
  solo clic, así que el costo de cubrirlas en e2e real es bajo).
- Deliberadamente NO se cubrió en e2e automatizado que una división separe un cuarto
  abierto en dos con nombre/área propios — requiere un rectángulo ya cerrado (varios muros
  con vértices arrastrados hasta encimarse), reproducible a mano con feedback visual pero
  frágil de escribir a ciegas contra coordenadas de pantalla. Esa semántica ya la cubre
  `rooms.test.ts` (Tarea 7) a nivel unitario, y se demostró en vivo en el recorrido de
  navegador (ver abajo).
- `grep -rn "PLANO\b"` / `grep -rn "'RENDERS'"` sobre `app/e2e/`: sin referencias sueltas
  después del fix.

**Part B — suites (evidencia fresca, este mismo run):**
- Frontend: `npm test` → 469/469 (43 archivos); `npx tsc --noEmit` limpio; `npm run build`
  limpio (el warning de chunk >500kB es preexistente, no de esta tarea).
- Backend: `.venv/bin/python -m pytest app/api/tests/ -q` → 576/576.
- E2E: stack propio levantado DESDE este worktree en puertos alternos (8010/5174 — 8000/5173
  ya los ocupaba `.worktrees/prospecto-pdf` en otra rama; confirmado por cwd de los procesos
  vivos antes de levantar nada, siguiendo la lección de memoria). `09-propiedad-detalle.spec.ts`
  → 37/37. Suite completa → 203/203 en la corrida limpia final.
  - Hallazgo real de paso: la BD compartida `patrio` estaba en la migración 035 (le faltaban
    036-040, incluida la 040 de esta rama) — `column c.parent_render_id does not exist`
    tronaba el prospecto en PDF. `docker compose run --rm migrate` la puso al día; no es un
    bug del código de esta rama, es staleness del entorno local compartido.
  - Un fallo aislado en `08-proveedores.spec.ts` (módulo ajeno a esta rama) no reprodujo al
    correr ese archivo solo (10/10) — flake de la corrida larga, no regresión.

**Part C — recorrido visual (Playwright MCP, con capturas):** propiedad `[DEMO]
Levantamiento Visual` sembrada con un rectángulo 5×4m real vía API. Los 5 tabs renderizan;
DIVISIÓN colocada y sus dos extremos arrastrados (vía PointerEvent real) hasta encimarse con
los muros — el cuarto se partió en Cocina 10.0 m² / Sala-Comedor 10.0 m², cada uno con su
propia área en el panel de Estadísticas; MUEBLE (Cama matrimonial) colocado con 1.40×1.90m
reales, arrastrado, editado a 1.5m de ancho y rotado 90° desde su inspector; ORIGINAL
guardado y PLANEADO clonado con PARTIR DEL ORIGINAL (mismo cuarto, misma división, mismo
mueble, confirmado por el BIM export). FOTOS mostró su sub-nav GALERÍA|RENDERS. Property
demo borrada al terminar.

**Conclusión:** las tres capas de verificación están en verde con evidencia local fresca.
La rama queda lista para que Eduardo decida push/PR — no se hizo por instrucción explícita
de la tarea.

---

## Revisión final (Task 18, spec ✅ + calidad ✅)

- Los 3 scripts manuales estaban rotos de verdad (no solo el que Task 16 marcó), confirmado
  contra su estado previo. Los 3 asserts nuevos de e2e trazados contra el código real
  (locators estables, sin timeouts fijos ni clicks por coordenada).
- Hueco de cobertura evaluado a fondo: la Tarea 7 del plan ya designaba `rooms.test.ts` como
  "LA prueba de la feature" — un e2e compuesto nunca fue parte del Definition of Done. El
  pipeline de render (rooms→labels) es genérico y agnóstico del tipo de arista, así que lo
  único que un e2e añadiría es probar el `.forEach` genérico para N=2 — no lógica específica
  de fantasmas. **Veredicto explícito: no bloquea.** Sugerencia de seguimiento de baja
  prioridad (no urgente): un test a nivel de componente en
  `FloorPlanEditor.interaction.test.tsx` con los extremos de la división ya tocando los
  muros, para cerrar el hueco sin pelear contra coordenadas de Playwright.
- Verificación independiente: 469/469 frontend, 576/576 backend (ambos re-corridos y
  contra-chequeados con grep estático — no son números viejos), `origin/main...feat/levantamientos`
  en 0/28 (rama al día, sin riesgo de rebase), cero `console.log`/`debugger`/TODO sueltos en
  todo el diff de la rama, el pendiente de Task 16 (unión discriminada en RendersPanel.Props)
  confirmado resuelto en Task 17.
- Un detalle cosmético sin bloquear: falta `waitForResponse` en el click de PARTIR DEL
  ORIGINAL (line ~706 de 09-propiedad-detalle.spec.ts) — funciona hoy por el auto-retry de
  Playwright, pero es inconsistente con el patrón `geometrySaved` que el mismo test usa tres
  líneas arriba.

**LAS 18 TAREAS DE LAS 6 FASES ESTÁN CERRADAS, CADA UNA CON REVISIÓN DE SPEC Y DE CALIDAD.
Rama lista para que Eduardo decida push/PR.**

---

# Renders de plano más precisos (addendum, 2026-08-11)

Plan: `docs/plans/2026-08-11-renders-de-plano-mas-precisos.md`
Diagnóstico: el plano-imagen que se manda al modelo no dibuja puertas/ventanas —
por eso las cadenas históricas de renders necesitaron 6+ rondas de edición manual.

- [x] Task 19: huecos de puerta/ventana + cotas en planImage.ts (69a4693; spec ✅, calidad ✅)
  - edgeAxis extraído a geometry.ts (compartido con el editor), geometría verificada
    a mano pixel por pixel contra el editor
  - Pendiente menor para Task 20 (no bloqueante): test directo de edgeAxis en
    geometry.test.ts; mover el helper `f2` de formateo a dimensions.ts (hoy duplicado
    entre FloorPlanCanvas.tsx y planImage.ts)
- [x] Task 20: conectividad de cuartos vía puertas (c30871a+d8e163e; spec ✅, calidad ✅)
  - roomA/roomB determinismo verificado empíricamente (se invirtió v1/v2 de una arista, el orden cambió como se esperaba)
  - Triplicación de "cara de mayor área = exterior" (exteriorEdgeIds/interiorPolygons/outerFace) aceptada como correctamente acotada — outerFace ya reusable si algún día se consolida
  - Pendiente menor para Task 21: retitular el test del guard defensivo (es narrowing de TS, no defensa de un input real alcanzable); roomA/roomB pueden ser '' (cuarto sin nombre) — Task 21 debe manejarlo explícito (ej. "un cuarto sin nombre") y probarlo
- [~] Task 21 (dividido en 3 tras 2 colgados): 21a conectividad, 21b tipo de cuarto, 21c dimensiones
  - 21a (d15ada1+9286f9d): spec ✅, calidad ✅ tras fix (9286f9d) — puerta al exterior corregida
    y verificada por reproducción del bug exacto; hueco de ventana interior cerrado con test
  - 21b (50dba61+0f969c1): spec ✅, calidad ✅ tras fix (tokenizer en vez de substring;
    "PATIO URBANO" ahora infiere patio, no baño; cobertura completa de las 7 categorías)
  - 21c (988c481+109d2d7): spec ✅, calidad ✅ tras fix — correlación posicional (no Map por
    nombre) verificada estructuralmente correcta; mutación reproducida de forma independiente;
    swap DRY del bbox de piso verificado byte-idéntico contra 5 fixtures
  - Dos fixes concurrentes al mismo archivo (planFacts.ts) manejados sin choque: el agente
    de 21b detectó el WIP de 21c, lo aisló con patch, commiteó su fix limpio, reaplicó el
    WIP encima — 0 pérdida de trabajo.
  - Nota (no bloqueante, ya conocida desde antes de esta rama): interiorPolygons/outerFace
    solo descartan UNA cara exterior — con islas desconectadas en una planta, se duplican
    áreas. Confirmado pre-existente desde Task 20, fuera de alcance del addendum.

**TASK 21 COMPLETA (21a+21b+21c): conectividad, tipo de cuarto y dimensiones por espacio,
con 3 bugs reales cazados y corregidos (puerta al exterior, substring "bano"⊂"urbano",
nombres duplicados) — cada uno con evidencia de mutación verificada.**
  - Nota: 2 agentes se colgaron en Task 21 antes de dividirla; un 3er colgado en el spec
    review de 21a (intentó worktree innecesario) — limpiado sin tocar nada del usuario
- [x] Task 22: render_prompts.kind + migración 041 + presets de estilo (e251e23+5b0debd; spec ✅, calidad ✅)
  - 5 presets nuevos puro estilo, verificados sin contenido de área; schema.sql regenerado
    independientemente por el revisor, byte-idéntico
  - Bug real cazado y corregido: kind sin validar truena 500 mudo (CheckViolation sin capturar) →
    Literal["photo","plan"] en Pydantic, 422 limpio
- [x] Task 23: frontend filtra presets por kind (cb1fd01; spec ✅, calidad ✅ sin fixes)
  - Unión discriminada de Task 16/17 confirmada intacta; fetch único + filtro cliente

**TASKS 19-23 COMPLETAS: el código del addendum de renders más precisos está cerrado.
Falta solo Task 24 (verificación final).**
- [x] Task 24: verificación integral (evidencia fresca + render real de prueba)

## Revisión final del addendum (Task 24)

**Part A — 4 capas de verificación, evidencia fresca de esta corrida:**
- Frontend: `npm test` → **517/517** (43 archivos, coincide con el conteo esperado);
  `npx tsc --noEmit` limpio; `npm run build` limpio (el warning de chunk >500kB es
  preexistente, ya señalado en el cierre del Task 18).
- Backend: `.venv/bin/python -m pytest app/api/tests/ -q` → **582/582**.
- Las 4 capas (2 suites + tsc + build) en verde, sin fixes necesarios.

**Part B — render real de prueba (el punto de todo el addendum):**
- Bloqueo inicial: ni `claude-in-chrome` (extensión no conectada) ni `chrome-devtools`
  MCP (perfil compartido ya ocupado por otra sesión de Chrome de este mismo entorno
  multi-agente — matar ese proceso a ciegas arriesgaba romper la sesión de otro
  agente) estaban disponibles. Se optó por la ruta alterna explícitamente autorizada
  por la tarea: llamar al endpoint real por API en vez de manejar la UI.
- Se generó el SVG y el `planFacts` REALES (no una aproximación) corriendo el código
  de producción (`floorToSvgString` + `planFacts`) contra la geometría real de la
  propiedad 5 vía un test de vitest desechable (borrado al terminar), con la
  geometría de la propiedad 5 volcada de la BD como fixture temporal (también
  borrada). El PNG se rasterizó reproduciendo EXACTAMENTE el algoritmo de
  `floorToPngBlob` (Image → canvas → toDataURL) con el Playwright de Python que ya
  usa el repo para el PDF — no una aproximación con otra librería.
- Blocker encontrado y resuelto: el stack vivo en el puerto 8010 (levantado antes en
  esta sesión desde este mismo checkout) tronaba `ModuleNotFoundError: No module
  named 'openai'` — el paquete está en `requirements.txt` pero no estaba instalado en
  `.venv`. `pip install openai>=2.0.0` lo resolvió sin reiniciar uvicorn (el import es
  perezoso dentro de `generate_image`).
- Render real generado: `POST /api/properties/5/renders/from-plan` contra el stack de
  este checkout (puerto 8010), variant=`original`, preset `Cálido contemporáneo`
  (id 7, el mismo estilo que ya había funcionado en el ejemplo histórico) + el texto
  de `planFacts` (conectividad + tipo de cuarto + dimensiones) concatenado a mano —
  la UI real habría necesitado el mismo paso manual porque `choosePreset`/`selectPlan`
  todavía se pisan el texto en vez de componerse (defecto conocido y diferido desde
  el Task 15, no de este addendum). Costo real de OpenAI incurrido, ~78s de espera.
  Resultado: `property_renders.id=20`, propiedad 5.
- **Comparación honesta contra el primer intento histórico (`property_renders.id=7`,
  misma propiedad):** el nuevo render es claramente mejor en fidelidad estructural.
  El intento histórico (2026-08-06, plano-fuente ya no existe en disco) inventó una
  topología completa: un edificio dividido arriba/abajo con un corredor central y una
  escalera, dos cocinas simétricas — nada de eso corresponde al layout real
  (dos departamentos divididos IZQUIERDA/DERECHA por un muro central, sin escalera
  visible en la geometría actual), y por eso las 6+ rondas de corrección manual
  tuvieron que reescribir a qué cuarto conectaba cada puerta. El render nuevo sí seguí
  el layout real: columna izquierda de arriba a abajo (patio, BAÑO DP1, HABITACION
  DP1 con la puerta hacia el pasillo, ESTANCIA DP1 grande abajo con puerta al
  exterior) y columna derecha (HABITACION DP2 arriba, BAÑO DP2, ESTANCIA DP2 como
  sala-comedor alargada con puertas al exterior) — verificado recortando la imagen
  por zonas y cruzándolo contra el texto de `planFacts` conexión por conexión. Único
  defecto real detectado: el modelo partió el cuarto BAÑO DP1 (con forma en L
  alrededor del patio) en dos cajas (una vacía + un baño con regadera/WC) en vez de
  un solo cuarto en L — un error menor y localizado, no un error de topología general
  como el histórico.
  - Veredicto: **mejor**, con evidencia específica, no una impresión genérica.

**Part C — barrido final:**
- `git diff 4223266..HEAD` (4223266 = el commit que introdujo
  `docs/plans/2026-08-11-renders-de-plano-mas-precisos.md`, el arranque real del
  addendum) sin `console.log`/`debugger`/TODO/FIXME nuevos.
- `origin/main...feat/levantamientos`: la rama quedó **3 commits detrás** de
  `origin/main` (3 PRs mergeados de Procesos/Scouting, ninguno toca floorplan/renders
  ni migraciones — sin riesgo de conflicto) y sigue 52 adelante. Reconfirma lo ya
  sabido: nadie más toca este código en paralelo.
- Stack de prueba de esta sesión (mismo checkout, mismo HEAD) queda **vivo a
  propósito** por si Eduardo quiere revisar en vivo:
  API `http://localhost:8010` (`/api/version` responde), frontend
  `http://localhost:5174`.
- Dato de prueba creado en esta tarea: `property_renders.id=20` (propiedad 5) — se
  deja, es la evidencia de Part B, no basura. Ningún dato histórico se tocó ni se
  borró.

**Conclusión: las 4 capas de verificación están en verde con evidencia fresca de esta
corrida. El render real de prueba (Part B) confirma en la práctica el diagnóstico y
el objetivo del addendum: el primer intento desde el nuevo flujo sigue la
distribución real (conectividad puerta-a-puerta y disposición de cuartos) de forma
notablemente más fiel que el primer intento histórico, con un solo defecto menor y
localizado (una división de cuarto en L) en vez de una topología completa
inventada. TASKS 19-24 CERRADAS. Rama sin push/merge — decisión de Eduardo.**

---

# Fidelidad dimensional en renders (addendum #2, 2026-08-12)

Plan: `docs/plans/2026-08-12-fidelidad-dimensional-renders.md`
Motivo: Eduardo generó un render real con el addendum #1 y confirmó que el estilo/
conectividad ya funcionan, pero las proporciones salen más cuadradas que el plano
real (propiedad 5: 5.99×11.05m, razón 1.845).

Diagnóstico verificado contra el SDK real (`openai==3.0.0`): `size="1024x1024"`
estaba fijo en `renders.py` pese a que gpt-image-2 soporta razones de aspecto
arbitrarias.

- [x] Task 25: tamaño de salida + resolución de referencia ajustados para planos
  (ab826ae; spec ✅, calidad ✅ — barrido independiente de ~916k combinaciones,
  cero violaciones)
  - Pendientes cosméticos no bloqueantes (opcional, no urgente): comentario de
    costo/latencia junto a MAX_EDGE_PLAN, assert defensivo de tolerancia post-clamp
  - `_output_size` calcula WIDTHxHEIGHT real, clamp [1:3,3:1], múltiplos de 16;
    fotos quedan byte-idénticas (size fijo, tope 1536); planos usan proporción
    real + tope 2048. Edición hereda vía chain_is_plan, mismo patrón que la
    cláusula del prompt.
  - Nota de proceso: `_output_size` en sí no fue TDD estrictamente rojo-primero
    (verificado con script suelto antes de escribir sus 3 tests) — todo lo demás
    (generate_image/rutas, 7 tests) sí fue rojo-primero real.
- [x] Task 26: planFacts — posición de puertas + ángulos de esquina (6231837+b07aa17;
  spec ✅, calidad ✅ tras fix)
  - Bug real cazado por calidad: "a X.XX m del extremo del muro" no dice CUÁL
    extremo — v1/v2 es un detalle interno invisible en la imagen rasterizada (sin
    grid/eje). Fix: `wallEndLabel` ancla la distancia a algo visible (izquierdo/
    derecho o superior/inferior, derivado de las mismas fórmulas monótonas px()/
    py() que usa planImage.ts), verificado contra 8 fixtures reales.
  - De paso: `wallLength` duplicado se reemplazó por `edgeAxis(...).L` compartido
    con planImage.ts/FloorPlanCanvas.tsx (mismo cálculo, ya no puede divergir).

- [x] Task 27: verificación integral (evidencia fresca + render real de prueba)

## Revisión final del addendum #2 (Task 27)

**Part A — 4 capas de verificación, evidencia fresca de esta corrida:**
- Frontend: `npm test` → **521/521** (43 archivos); `npx tsc --noEmit` limpio;
  `npm run build` limpio (el warning de chunk >500kB es preexistente, ya
  señalado en el cierre del Task 18/24).
- Backend: `.venv/bin/python -m pytest app/api/tests/ -q` → **589/589**.
- Las 4 capas en verde, sin fixes necesarios.

**Part B — render real de prueba (el punto de este addendum):**
- Browser automation no disponible esta corrida (`list_connected_browsers` →
  `[]`) — se usó la ruta alterna vía API, mismo precedente que el Task 24.
- El stack de este checkout venía corriendo desde antes de los commits de
  hoy (Aug11 19:08 vs. commits de Task 25/26 esta mañana) — se reinició
  desde cero para garantizar código fresco: API en :8010, frontend en :5174,
  logs en el scratchpad de la sesión.
- Se reprodujo el SVG y el `planFacts` REALES corriendo `floorToSvgString` +
  `planFacts` de producción (vitest desechable, borrado al terminar) contra
  la geometría real de la propiedad 5 (Planta Baja, `activeFloor=0`) volcada
  de la BD. Se rasterizó con Playwright Python replicando `floorToPngBlob`
  EXACTAMENTE (Image → canvas → PNG) — verificado por **MD5 idéntico**
  contra el plan-source real de un render histórico (id=20): reproducción
  byte por byte, no una aproximación.
- Render real generado: `POST /api/properties/5/renders/from-plan`,
  `variant=original`, preset "Cálido contemporáneo" (id 7) + el `planFacts`
  real concatenado a mano (mismo defecto diferido de composición UI que ya
  documentó el Task 24). Costo real de OpenAI incurrido, ~54s de espera.
  Resultado: `property_renders.id=23`, propiedad 5.
- **Comparación numérica honesta:**
  - Antes (id=20, generado antes del fix, mismo checkout/preset): **1024×1024,
    ratio 1.0** — cuadrado forzado. Confirmado también en dos renders
    adicionales de esta sesión (id=21, id=22, generados antes de que Task 25
    aterrizara en disco): ambos también 1024×1024.
  - Ahora (id=23): **704×1488, ratio h/w = 2.114**.
  - La predicción determinista de `_output_size` sobre la imagen de
    referencia real dio exactamente `704x1488` — coincide EXACTO con lo que
    OpenAI devolvió.
  - Razón cruda del piso real (bounding box de vértices, Planta Baja):
    5.99×11.05 m → **1.845**.
  - Hallazgo honesto, no escondido: la imagen de referencia que de verdad se
    manda a OpenAI (el PNG que exporta `floorToSvgString`) mide 802×1700 →
    ratio **2.12**, no 1.845. `floorToSvgString` fuerza el bbox del SVG a
    incluir el origen del mundo (0,0)-(1,1) sin importar dónde esté la planta
    real (`Math.min(...xs, 0)` / `Math.max(...xs, 1)`) — en la propiedad 5
    (rango Y real 3.95–15.00, lejos del origen) eso añade ~5 m de margen en
    blanco arriba de la planta. Verificado que esa línea es preexistente y
    ajena a este addendum: último commit sobre `planImage.ts` es `d8e163e`
    (anterior al plan de este addendum); `git log 61db7b5..HEAD --
    planImage.ts` no toca el archivo. `_output_size` hizo exactamente lo que
    Task 25 le pidió — igualar la razón de LA IMAGEN QUE RECIBIÓ (2.12) con
    alta fidelidad (diferencia de 0.006, muy por debajo de la tolerancia de
    0.02 del propio algoritmo). El objetivo del addendum (dejar de mandar un
    cuadrado fijo) se cumple con evidencia numérica; el objetivo aspiracional
    de acertar 1.845 exacto queda parcialmente diluido por un bug preexistente
    y separado en el exportador del plano, no por este fix.
  - Comparación visual: el render histórico (id=20) sale una planta casi
    cuadrada, los 2 departamentos comprimidos lado a lado en un envolvente
    1:1. El render nuevo (id=23) sale claramente alargado/vertical — un
    edificio angosto de dos crujías, mucho más cercano a la forma real del
    inmueble (sigue la misma partición izquierda/derecha por departamento que
    ya validó el Task 24). Mejora visible, no solo numérica.
  - **Veredicto: el fix funciona como se diseñó.** El canvas de salida ya no
    es un cuadrado fijo — sigue la razón de la imagen de referencia con alta
    fidelidad. La razón absoluta objetivo (1.845) no se alcanza exacta por un
    bug preexistente y no relacionado en el exportador del plano —
    documentado, no ocultado.

**Part C — barrido final:**
- `git diff 61db7b5..HEAD -- app/web/src app/api` sin
  `console.log`/`debugger`/TODO/FIXME nuevos (61db7b5 = el commit que
  introdujo `docs/plans/2026-08-12-fidelidad-dimensional-renders.md`, el
  arranque real de este addendum).
- `origin/main...feat/levantamientos`: la rama quedó **3 commits detrás** de
  `origin/main` (features de Procesos/Scouting, #27-#29, ninguno toca
  floorplan/renders — sin riesgo de conflicto) y sigue 59 adelante.
- Stack de esta sesión reiniciado y **vivo a propósito**: API
  `http://localhost:8010` (`/api/version` responde), frontend
  `http://localhost:5174`.
- Dato de prueba creado en esta tarea: `property_renders.id=23` (propiedad
  5) — se deja, es la evidencia de Part B. Ningún dato histórico se tocó ni
  se borró (id=20/21/22 siguen intactos como referencia "antes").
- Scripts desechables (test de vitest, fixture JSON de geometría, script de
  rasterización con Playwright) borrados al terminar — ninguno quedó en el
  repo (`git status` limpio).

**Conclusión: las 4 capas de verificación están en verde con evidencia fresca
de esta corrida. El render real de prueba (Part B) confirma numéricamente que
Task 25 funciona: el canvas de salida pasó de 1024×1024 fijo (ratio 1.0) a
704×1488 (ratio 2.114), siguiendo con alta fidelidad (±0.006) la razón real de
la imagen de referencia que se le manda a OpenAI. Se documenta honestamente
que esa imagen de referencia no reproduce exactamente la razón cruda del piso
(1.845) por un bug preexistente y fuera de alcance en `floorToSvgString`
(padding forzado al origen del mundo) — no una falla de este addendum.
`planFacts` (Task 26) se verificó presente y correcto en el prompt real usado:
anclaje de puertas/ventanas a extremos visibles (izquierdo/derecho/superior/
inferior) y ángulos de esquina no rectos (88°, 177°, 179°) aparecen en el
texto real enviado a OpenAI. TASKS 25-27 CERRADAS. Rama sin push/merge —
decisión de Eduardo.**

---

# Renders por piso (addendum #3, 2026-08-13)

Plan/diseño: `docs/plans/2026-08-13-renders-multi-piso-design.md`
Motivo: Eduardo pidió generar renders de TODOS los pisos de un levantamiento,
no solo el activo. Análisis independiente de un subagente Claude (Explore) y
un subagente Codex antes de decidir — ambos convergieron en: una llamada por
piso (técnicamente forzado por images.edit, no solo preferido), y el mismo
patrón de snapshot congelado que ya usa prompt_id/prompt_text.

Decisiones de Eduardo (más ambiciosas que la recomendación por defecto de
ambos subagentes):
- ID estable para FloorGraph (no el snapshot índice+nombre más barato que
  ambos recomendaban) — base más sólida.
- "Generar todos los pisos" se construye YA, no se difiere.
- Los 6 renders de prueba de la propiedad 5 (ids 20-25, de la verificación
  del addendum #2) se borraron con el mecanismo real de la app
  (`delete_render` + `storage.delete`, no un DELETE crudo). Quedan intactos
  los 8 renders históricos reales (2026-08-05 al 07) — nunca se tocaron.

- [x] Task 28: `FloorGraph.id` — identidad estable (dc835b9+bb7bfae; spec ✅, calidad ✅)
  - Bug real cazado y corregido: `ADD_FLOOR` clonaba el piso activo completo,
    heredando su id — dos pisos hubieran quedado con el mismo id. Fix + test
    dedicado.
  - Hallazgo de calidad, resuelto: `writePlanned` (PARTIR/RE-PARTIR) también
    clona un piso completo y comparte su id entre variantes — documentado
    como INTENCIONAL (linaje original↔planeado) con comentario explícito +
    test de id-igualdad, advirtiendo que el filtrado SIEMPRE debe combinar
    floor_id+source_variant, nunca floor_id solo.
- [x] Task 29: `floor_id`/`floor_name` en `property_renders` (ecef8d4; spec ✅, calidad ✅)
  - Migración 042, mismo patrón que source_variant (040): sin backfill,
    NULL permanente para todo render preexistente (verificado contra los
    8 renders reales de la propiedad 5). Requerido en el endpoint — seguro
    porque el deploy es monolítico (frontend+API en una imagen, sin gap de
    versión).
- [ ] Task 30: selector de piso + filtrado en RendersPanel
- [ ] Task 31: "Generar todos los pisos" (lote, confirmación, progreso, fallo parcial)
- [ ] Task 32: verificación final
