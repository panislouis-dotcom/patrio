import { describe, it, expect } from 'vitest'
import {
  emptyModel, emptyFloorSet, isEmpty, clone, floorElev, migrateGeometry,
  type FloorPlanModel,
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

describe('emptyModel', () => {
  it('creates a v3 envelope whose original variant has one blank floor and no planned variant', () => {
    const m = emptyModel()
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

  it('returns a v3 envelope as-is, without copying', () => {
    const v3 = emptyModel()
    expect(migrateGeometry(v3)).toBe(v3)
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
})

describe('isEmpty', () => {
  it('treats {} as empty', () => {
    expect(isEmpty({})).toBe(true)
  })
  it('treats a v3 envelope with a drawn-on original as non-empty', () => {
    expect(isEmpty(emptyModel())).toBe(false)
  })
  it('treats a v3 envelope whose original has no floors as empty', () => {
    const m: FloorPlanModel = {
      schemaVersion: 3,
      variants: { original: { slab_m: 0.15, activeFloor: 0, floors: [] }, planned: null },
    }
    expect(isEmpty(m)).toBe(true)
  })
  it('accepts a raw v2 blob without crashing: migration runs before the emptiness check', () => {
    expect(isEmpty(v2Blob())).toBe(false)
  })
  it('treats leftover schemaVersion-1 geometry from the old wall-list editor as empty', () => {
    expect(isEmpty(LEGACY_V1)).toBe(true)
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
