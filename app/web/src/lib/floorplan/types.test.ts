import { describe, it, expect } from 'vitest'
import {
  withVariant, emptyFloorSet, emptyFloorGraph, clone, floorElev, migrateGeometry, FIXTURE_CATALOG,
  ROOM_TYPE_CATALOG, type RoomType,
} from './types'

// Real shape seen in production: the old wall-list editor's blob has no `activeFloor` at all
// (it used `active` instead) and each floor has `walls`/`footprint`, not `vertices`/`edges`.
// Trusting it as a model crashes FloorPlanEditor on `floors[activeFloor].vertices`.
const LEGACY_V1 = {
  schemaVersion: 1, active: 0, slab_m: 0.15, extWall_m: 0.15, intWall_m: 0.10,
  floors: [{ name: 'Planta Baja', height_m: 2.6, rooms: [], openings: [], footprint: [], walls: [] }],
}

/** A v2 blob as the previous editor persisted it: ONE plan at the root, no variants. */
function v2Blob() {
  const fs = emptyFloorSet()
  fs.slab_m = 0.2
  fs.floors[0].name = 'Planta Original'
  fs.floors.push({ ...clone(fs.floors[0]), name: 'Planta Alta' })
  fs.activeFloor = 1
  return { schemaVersion: 2 as const, slab_m: fs.slab_m, activeFloor: fs.activeFloor, floors: fs.floors }
}

describe('emptyFloorGraph', () => {
  it('nace con un id no vacío (identidad estable del piso)', () => {
    const f = emptyFloorGraph('Planta Baja')
    expect(typeof f.id).toBe('string')
    expect(f.id.length).toBeGreaterThan(0)
  })
})

describe('withVariant', () => {
  it('builds a fresh v3 envelope from null: the written variant lands, the other defaults', () => {
    const m = withVariant(null, 'original', emptyFloorSet())
    expect(m.schemaVersion).toBe(3)
    expect(m.variants.planned).toBeNull()
    const fs = m.variants.original
    expect(fs.floors).toHaveLength(1)
    expect(fs.activeFloor).toBe(0)
    expect(fs.floors[0].name).toBe('Planta Baja')
    expect(Object.keys(fs.floors[0].vertices)).toHaveLength(0)
    expect(Object.keys(fs.floors[0].edges)).toHaveLength(0)
    expect(fs.floors[0].extWall_m).toBeCloseTo(0.15)
    expect(fs.floors[0].intWall_m).toBeCloseTo(0.10)
  })

  it('from null with the planned variant, original still exists: it can never be null', () => {
    const planned = emptyFloorSet()
    const m = withVariant(null, 'planned', planned)
    expect(m.variants.planned).toBe(planned)
    expect(m.variants.original.floors).toHaveLength(1)
  })

  it('writing one variant preserves the other untouched, in both directions', () => {
    const planned = emptyFloorSet()
    planned.floors[0].name = 'Planta Planeada'
    const base = withVariant(withVariant(null, 'original', emptyFloorSet()), 'planned', planned)

    const newOriginal = emptyFloorSet()
    newOriginal.floors[0].name = 'Planta Nueva'
    const afterOriginal = withVariant(base, 'original', newOriginal)
    expect(afterOriginal.variants.original).toBe(newOriginal)
    expect(afterOriginal.variants.planned).toBe(planned)

    const newPlanned = emptyFloorSet()
    const afterPlanned = withVariant(base, 'planned', newPlanned)
    expect(afterPlanned.variants.planned).toBe(newPlanned)
    expect(afterPlanned.variants.original).toBe(base.variants.original)
  })
})

describe('migrateGeometry', () => {
  it('nests a v2 blob as the original variant, preserving floors, activeFloor and slab_m', () => {
    const v2 = v2Blob()
    const m = migrateGeometry(v2)!
    expect(m.schemaVersion).toBe(3)
    expect(m.variants.planned).toBeNull()
    expect(m.variants.original.slab_m).toBeCloseTo(0.2)
    expect(m.variants.original.activeFloor).toBe(1)
    expect(m.variants.original.floors).toHaveLength(2)
    expect(m.variants.original.floors.map(f => f.name)).toEqual(['Planta Original', 'Planta Alta'])
  })

  it('returns a well-formed v3 envelope as-is, without copying', () => {
    const v3 = withVariant(null, 'original', emptyFloorSet())
    expect(migrateGeometry(v3)).toBe(v3)
  })

  it('returns a v3 envelope with a drawn planned variant as-is too', () => {
    const v3 = withVariant(withVariant(null, 'original', emptyFloorSet()), 'planned', emptyFloorSet())
    expect(migrateGeometry(v3)).toBe(v3)
  })

  it('normalizes a v3 blob without a planned key to planned: null', () => {
    // Un blob v3 escrito por una versión que aún no conocía `planned` no debe
    // colarse con `planned: undefined`: el tipo promete FloorSet | null.
    const sinPlanned = { schemaVersion: 3, variants: { original: emptyFloorSet() } }
    const m = migrateGeometry(sinPlanned)!
    expect(m).not.toBeNull()
    expect(m.variants.planned).toBeNull()
    expect(m.variants.original).toBe(sinPlanned.variants.original)
  })

  it('rejects the whole blob when planned exists but is not a FloorSet', () => {
    // Un planned malformado no se repara en silencio: si el blob miente en una
    // variante puede mentir en la otra, y leerlo a medias es peor que no leerlo.
    const malformado = {
      schemaVersion: 3,
      variants: { original: emptyFloorSet(), planned: { floors: 'no soy un arreglo' } },
    }
    expect(migrateGeometry(malformado)).toBeNull()
    expect(migrateGeometry({ schemaVersion: 3, variants: { original: emptyFloorSet(), planned: 42 } })).toBeNull()
  })

  it('returns null for {}: a property that never drew a plan has no model to migrate', () => {
    expect(migrateGeometry({})).toBeNull()
  })

  it('returns null for leftover schemaVersion-1 geometry from the old wall-list editor', () => {
    expect(migrateGeometry(LEGACY_V1)).toBeNull()
  })

  it('returns null for garbage that is not even an object', () => {
    expect(migrateGeometry(null)).toBeNull()
    expect(migrateGeometry(undefined)).toBeNull()
    expect(migrateGeometry('geometría')).toBeNull()
    expect(migrateGeometry(42)).toBeNull()
  })

  it('asigna un id fresco al piso de un blob v2 que no lo tiene (dato legado, previo a este campo)', () => {
    const v2 = v2Blob()
    delete (v2.floors[0] as { id?: string }).id
    const m = migrateGeometry(v2)!
    expect(m).not.toBeNull()
    expect(m.variants.original.floors[0].id).toBeTruthy()
  })

  it('asigna un id fresco a un piso v3 que ya no lo tiene (blob guardado antes de esta feature)', () => {
    const v3 = withVariant(null, 'original', emptyFloorSet())
    delete (v3.variants.original.floors[0] as { id?: string }).id
    const m = migrateGeometry(v3)!
    expect(m).not.toBeNull()
    expect(m.variants.original.floors[0].id).toBeTruthy()
  })

  it('asigna un id fresco también en la variante planned cuando le falta', () => {
    const planned = emptyFloorSet()
    delete (planned.floors[0] as { id?: string }).id
    const v3 = withVariant(withVariant(null, 'original', emptyFloorSet()), 'planned', planned)
    const m = migrateGeometry(v3)!
    expect(m).not.toBeNull()
    expect(m.variants.planned!.floors[0].id).toBeTruthy()
  })

  it('asigna ids DISTINTOS a dos pisos del mismo blob que no tienen id (no reusa un solo genId())', () => {
    const fs = emptyFloorSet()
    fs.floors.push({ ...clone(fs.floors[0]), name: 'Planta Alta' })
    delete (fs.floors[0] as { id?: string }).id
    delete (fs.floors[1] as { id?: string }).id
    const v3 = withVariant(null, 'original', fs)
    const m = migrateGeometry(v3)!
    const [f0, f1] = m.variants.original.floors
    expect(f0.id).toBeTruthy()
    expect(f1.id).toBeTruthy()
    expect(f0.id).not.toBe(f1.id)
  })

  it('conserva el id de un piso que ya lo tenía: no lo pisa en cada carga', () => {
    const v3 = withVariant(null, 'original', emptyFloorSet())
    const originalId = v3.variants.original.floors[0].id
    const m = migrateGeometry(v3)!
    expect(m.variants.original.floors[0].id).toBe(originalId)
  })
})

describe('clone', () => {
  it('deep-clones so mutating the clone does not affect the original', () => {
    const fs = emptyFloorSet()
    const c = clone(fs)
    c.floors[0].name = 'changed'
    expect(fs.floors[0].name).not.toBe('changed')
  })
})

describe('floorElev', () => {
  it('sums the height of every floor below the given index', () => {
    const fs = emptyFloorSet()
    fs.floors.push({ ...clone(fs.floors[0]), height_m: 2.6 })
    fs.floors[0].height_m = 3.0
    expect(floorElev(fs, 0)).toBe(0)
    expect(floorElev(fs, 1)).toBe(3.0)
  })
})

// Cobertura del catálogo en sí, no solo de que ADD_FIXTURE copie lo que sea que tenga
// adentro (eso ya lo cubre reducer.test.ts, pero circularmente): esta tabla es el spec
// literal del plan (docs/plans/2026-08-10-levantamientos-plan.md, Task 10) transcrito a
// assertions, así que un typo en una medida real (p. ej. la cama king a 1.93×2.03) revienta
// aquí en vez de colarse silenciosamente a los renders y al prospecto.
describe('FIXTURE_CATALOG', () => {
  const SPEC: Record<string, { label: string; w_m: number; h_m: number }> = {
    cama_individual:  { label: 'Cama individual',  w_m: 1.00, h_m: 1.90 },
    cama_matrimonial: { label: 'Cama matrimonial', w_m: 1.40, h_m: 1.90 },
    cama_queen:       { label: 'Cama queen',       w_m: 1.60, h_m: 2.00 },
    cama_king:        { label: 'Cama king',        w_m: 1.93, h_m: 2.03 },
    silla:            { label: 'Silla',            w_m: 0.45, h_m: 0.45 },
    mesa:             { label: 'Mesa',             w_m: 1.60, h_m: 0.90 },
    escritorio:       { label: 'Escritorio',       w_m: 1.20, h_m: 0.60 },
    sillon:           { label: 'Sillón',           w_m: 2.00, h_m: 0.90 },
    inodoro:          { label: 'Inodoro',          w_m: 0.40, h_m: 0.65 },
    lavabo:           { label: 'Lavabo',           w_m: 0.55, h_m: 0.45 },
    regadera:         { label: 'Regadera',         w_m: 0.90, h_m: 0.90 },
    tina:             { label: 'Tina',             w_m: 0.80, h_m: 1.70 },
    lavadora:         { label: 'Lavadora',         w_m: 0.60, h_m: 0.60 },
    estufa:           { label: 'Estufa',           w_m: 0.76, h_m: 0.66 },
    refrigerador:     { label: 'Refrigerador',     w_m: 0.90, h_m: 0.80 },
  }

  it('tiene exactamente las 15 entradas del spec, ni de más ni de menos', () => {
    expect(Object.keys(FIXTURE_CATALOG).sort()).toEqual(Object.keys(SPEC).sort())
  })

  it.each(Object.keys(SPEC))('%s coincide en label, w_m y h_m con el spec', kind => {
    const entry = FIXTURE_CATALOG[kind as keyof typeof FIXTURE_CATALOG]
    const spec = SPEC[kind]
    expect(entry.label).toBe(spec.label)
    expect(entry.w_m).toBeCloseTo(spec.w_m)
    expect(entry.h_m).toBeCloseTo(spec.h_m)
  })
})

describe('ROOM_TYPE_CATALOG', () => {
  it('tiene las 17 entradas del catálogo (16 tipos + "otro"), todas con label no vacío', () => {
    const keys = Object.keys(ROOM_TYPE_CATALOG)
    expect(keys).toHaveLength(17)
    expect(keys).toContain('otro')
    keys.forEach(k => expect(ROOM_TYPE_CATALOG[k as RoomType].label.length).toBeGreaterThan(0))
  })

  it('incluye escalera y vestíbulo — los dos tipos que faltaban en el catálogo de palabras clave', () => {
    expect(ROOM_TYPE_CATALOG.escalera.label).toBe('Escalera')
    expect(ROOM_TYPE_CATALOG.vestibulo.label).toBe('Vestíbulo')
  })

  it('un Room sin type sigue siendo válido — compatibilidad hacia atrás, mismo patrón que fixtures?/manualDimensions?', () => {
    const f = emptyFloorGraph('Test')
    f.rooms.push({ name: 'Sala', cx: 1, cy: 1 }) // sin type: levantamiento capturado antes de esta feature
    expect(f.rooms[0].type).toBeUndefined()
    expect(() => clone(f)).not.toThrow()
  })

  it('un Room con type sobrevive clone() (round-trip vía JSON, como se persiste de verdad)', () => {
    const f = emptyFloorGraph('Test')
    f.rooms.push({ name: 'Escalera PA', cx: 1, cy: 1, type: 'escalera' })
    const cloned = clone(f)
    expect(cloned.rooms[0].type).toBe('escalera')
  })

  it('cada tipo salvo "otro" trae un color hex válido; "otro" no trae ninguno', () => {
    const HEX = /^#[0-9A-F]{6}$/
    for (const key of Object.keys(ROOM_TYPE_CATALOG) as RoomType[]) {
      const entry = ROOM_TYPE_CATALOG[key]
      if (key === 'otro') expect(entry.color).toBeUndefined()
      else expect(entry.color).toMatch(HEX)
    }
  })

  it('los 16 colores son todos distintos entre sí (una paleta sin dos tipos indistinguibles)', () => {
    const colors = (Object.keys(ROOM_TYPE_CATALOG) as RoomType[])
      .map(k => ROOM_TYPE_CATALOG[k].color)
      .filter((c): c is string => c != null)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('ningún color se confunde con un muro ni con la página en blanco (umbrales reales de renders.py)', () => {
    // Luminancia ITU-R 601-2 (misma fórmula que PIL .convert('L'), que app/api/renders.py
    // usa de verdad para _composite_geometry/_content_bbox) — calculada, no adivinada.
    const WALL_LUMINANCE_MAX = 60
    const BBOX_BG_THRESHOLD = 245
    for (const key of Object.keys(ROOM_TYPE_CATALOG) as RoomType[]) {
      const hex = ROOM_TYPE_CATALOG[key].color
      if (!hex) continue
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b
      expect(luminance).toBeGreaterThan(WALL_LUMINANCE_MAX)
      expect(luminance).toBeLessThan(BBOX_BG_THRESHOLD)
    }
  })
})
