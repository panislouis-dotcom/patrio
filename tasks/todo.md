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
