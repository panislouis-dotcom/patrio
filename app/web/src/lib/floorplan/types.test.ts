import { describe, it, expect } from 'vitest'
import { emptyModel, isEmpty, clone, floorElev, type FloorPlanModel } from './types'

describe('emptyModel', () => {
  it('creates one floor with an empty graph', () => {
    const m = emptyModel()
    expect(m.schemaVersion).toBe(2)
    expect(m.floors).toHaveLength(1)
    expect(m.activeFloor).toBe(0)
    expect(Object.keys(m.floors[0].vertices)).toHaveLength(0)
    expect(Object.keys(m.floors[0].edges)).toHaveLength(0)
    expect(m.floors[0].extWall_m).toBeCloseTo(0.15)
    expect(m.floors[0].intWall_m).toBeCloseTo(0.10)
  })
})

describe('isEmpty', () => {
  it('treats {} as empty', () => {
    expect(isEmpty({})).toBe(true)
  })
  it('treats a real model as non-empty', () => {
    expect(isEmpty(emptyModel())).toBe(false)
  })
  it('treats leftover schemaVersion-1 geometry from the old wall-list editor as empty', () => {
    // Real shape seen in production: the old editor's blob has no `activeFloor` at all (it
    // used `active` instead) and each floor has `walls`/`footprint`, not `vertices`/`edges`.
    // Trusting this as a v2 model crashes FloorPlanEditor on `model.floors[model.activeFloor]`.
    const legacy = {
      schemaVersion: 1, active: 0, slab_m: 0.15, extWall_m: 0.15, intWall_m: 0.10,
      floors: [{ name: 'Planta Baja', height_m: 2.6, rooms: [], openings: [], footprint: [], walls: [] }],
    }
    expect(isEmpty(legacy as unknown as FloorPlanModel)).toBe(true)
  })
})

describe('clone', () => {
  it('deep-clones so mutating the clone does not affect the original', () => {
    const m = emptyModel()
    const c = clone(m)
    c.floors[0].name = 'changed'
    expect(m.floors[0].name).not.toBe('changed')
  })
})

describe('floorElev', () => {
  it('sums the height of every floor below the given index', () => {
    const m = emptyModel()
    m.floors.push({ ...clone(m.floors[0]), height_m: 2.6 })
    m.floors[0].height_m = 3.0
    expect(floorElev(m, 0)).toBe(0)
    expect(floorElev(m, 1)).toBe(3.0)
  })
})
