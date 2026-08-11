# Levantamientos — checklist de ejecución

Plan: `docs/plans/2026-08-10-levantamientos-plan.md`
Diseño: `docs/plans/2026-08-10-levantamientos-design.md`
Rama: `feat/levantamientos`

## Fase 1 — Refactor puro del editor
- [x] Task 1: extraer despacho de herramientas de FloorPlanEditor (88adf08; spec ✅, calidad ✅)

## Fase 2 — Schema v3 + tabs
- [ ] Task 2: FloorSet + envelope v3 + migrador (types.ts)
- [ ] Task 3: reducer/editor/ficha sobre FloorSet
- [ ] Task 4: tabs LEVANTAMIENTO ORIGINAL/PLANEADO + re-clonación
- [ ] Task 5: prospecto lee v3 (planeado si existe)
- [ ] Task 6: e2e del renombre

## Fase 3 — Paredes fantasma
- [ ] Task 7: Edge.kind 'ghost' en el motor
- [ ] Task 8: herramienta DIVISIÓN en el editor
- [ ] Task 9: fantasmas invisibles en cotas/export/renders/PDF

## Fase 4 — Muebles
- [ ] Task 10: Fixture + catálogo + reducer
- [ ] Task 11: paleta, canvas, inspector
- [ ] Task 12: muebles en renders y PDF

## Fase 5 — Renders por fuente
- [ ] Task 13: migración 040 + variante en renders_db
- [ ] Task 14: from-plan con variante + fix event loop
- [ ] Task 15: planFacts (prompt enriquecido) + api frontend
- [ ] Task 16: FOTOS con GALERÍA | RENDERS (muere el tab RENDERS)
- [ ] Task 17: RENDERS dentro de cada levantamiento

## Fase 6 — Cierre
- [ ] Task 18: e2e + verificación visual + push con evidencia

## Review
(se llena al cerrar)
