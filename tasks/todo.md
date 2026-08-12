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
  - 21b (50dba61+0f969c1): spec ✅, calidad con fix — bug real: "bano" (sin acento) hacía
    match como substring de "urbano" ("PATIO URBANO" salía tipo:baño). Fix: tokenizer en
    vez de substring. Re-revisión en curso.
  - 21c (988c481+109d2d7): spec ✅, calidad con fix — bug real confirmado: nombres duplicados
    mezclaban área de un cuarto con dimensiones de otro (dato falso a una llamada de IA
    pagada). Fix: correlación posicional en vez de Map por nombre, + DRY del bbox de piso.
    Re-revisión en curso.
  - Dos fixes concurrentes al mismo archivo (planFacts.ts) manejados sin choque: el agente
    de 21b detectó el WIP de 21c, lo aisló con patch, commiteó su fix limpio, reaplicó el
    WIP encima — 0 pérdida de trabajo.
  - Nota: 2 agentes se colgaron en Task 21 antes de dividirla; un 3er colgado en el spec
    review de 21a (intentó worktree innecesario) — limpiado sin tocar nada del usuario
- [ ] Task 22: render_prompts.kind + migración 041 + presets de estilo
- [ ] Task 23: frontend filtra presets por kind
- [ ] Task 24: verificación integral (+ render real de prueba si el tiempo alcanza)
