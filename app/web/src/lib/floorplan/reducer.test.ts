import { describe, it, expect } from 'vitest'
import { emptyFloorGraph } from './types'
import { addVertex, addEdge } from './graph'
import {
  reducer, initialState, removeVertexFromFloor, removeEdgeFromFloor, removeOpeningFromFloor,
} from './reducer'

function modelWithRectangle() {
  const f = emptyFloorGraph('Test')
  const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  return { model: { schemaVersion: 2 as const, slab_m: 0.15, activeFloor: 0, floors: [f] }, a, b, c, d }
}

describe('room naming', () => {
  it('RENAME_ROOM creates a free named point where none is near, and marks dirty', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'RENAME_ROOM', cx: 10, cy: 10, name: 'Patio' })
    expect(s.model.floors[0].rooms).toContainEqual({ name: 'Patio', cx: 10, cy: 10 })
    expect(s.dirty).toBe(true)
  })

  it('RENAME_ROOM updates the nearest existing point instead of adding a second', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'RENAME_ROOM', cx: 10, cy: 10, name: 'Patio' })
    s = reducer(s, { type: 'RENAME_ROOM', cx: 10.2, cy: 9.9, name: 'Terraza' })
    expect(s.model.floors[0].rooms).toHaveLength(1)
    expect(s.model.floors[0].rooms[0].name).toBe('Terraza')
  })

  it('DELETE_ROOM removes the nearest named point within range', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'RENAME_ROOM', cx: 10, cy: 10, name: 'Patio' })
    s = reducer(s, { type: 'DELETE_ROOM', cx: 10.1, cy: 9.9 })
    expect(s.model.floors[0].rooms).toHaveLength(0)
  })

  it('DELETE_ROOM is a no-op returning the same state when nothing is near', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'RENAME_ROOM', cx: 10, cy: 10, name: 'Patio' })
    const before = s
    expect(reducer(s, { type: 'DELETE_ROOM', cx: 0, cy: 0 })).toBe(before)
  })
})

describe('SET_MODEL / UNDO / REDO', () => {
  it('pushes history on SET_MODEL and round-trips through undo/redo', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    const model2 = { ...model, floors: [{ ...model.floors[0], name: 'Renamed' }] }
    s = reducer(s, { type: 'SET_MODEL', model: model2 })
    expect(s.model.floors[0].name).toBe('Renamed')
    expect(s.past).toHaveLength(1)
    s = reducer(s, { type: 'UNDO' })
    expect(s.model.floors[0].name).toBe('Test')
    expect(s.future).toHaveLength(1)
    s = reducer(s, { type: 'REDO' })
    expect(s.model.floors[0].name).toBe('Renamed')
  })

  it('UNDO/REDO on empty stacks is a no-op returning the same state reference', () => {
    const { model } = modelWithRectangle()
    const s = initialState(model)
    expect(reducer(s, { type: 'UNDO' })).toBe(s)
    expect(reducer(s, { type: 'REDO' })).toBe(s)
  })
})

describe('DRAG_MODEL', () => {
  it('updates the model without pushing history (for intermediate drag frames)', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    const model2 = { ...model, floors: [{ ...model.floors[0], name: 'Mid-drag' }] }
    s = reducer(s, { type: 'DRAG_MODEL', model: model2 })
    expect(s.model.floors[0].name).toBe('Mid-drag')
    expect(s.past).toHaveLength(0)
  })

  it('a new SET_MODEL after some DRAG_MODEL frames clears future and pushes exactly one history entry', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'DRAG_MODEL', model: { ...model, floors: [{ ...model.floors[0], name: 'frame1' }] } })
    s = reducer(s, { type: 'DRAG_MODEL', model: { ...model, floors: [{ ...model.floors[0], name: 'frame2' }] } })
    s = reducer(s, { type: 'SET_MODEL', model: { ...model, floors: [{ ...model.floors[0], name: 'final' }] } })
    expect(s.past).toHaveLength(1)
    expect(s.past[0].floors[0].name).toBe('Test') // history captured the state BEFORE this whole gesture, not the mid-drag frames
  })

  it('UNDO mid-drag cancels the gesture back to its pre-drag baseline without touching past/future', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_MODEL', model: { ...model, floors: [{ ...model.floors[0], name: 'B' }] } })
    expect(s.past).toHaveLength(1) // past[0] = 'Test'
    s = reducer(s, { type: 'DRAG_MODEL', model: { ...model, floors: [{ ...model.floors[0], name: 'C' }] } })
    s = reducer(s, { type: 'DRAG_MODEL', model: { ...model, floors: [{ ...model.floors[0], name: 'D' }] } })
    s = reducer(s, { type: 'UNDO' })
    expect(s.model.floors[0].name).toBe('B') // cancels the drag back to the pre-gesture baseline, not two steps back
    expect(s.past).toHaveLength(1) // untouched — 'Test' was never discarded
    expect(s.future).toHaveLength(0) // the uncommitted mid-drag frame 'D' is discarded, not stashed in future
  })

  it('REDO mid-drag also cancels the gesture back to its pre-drag baseline', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_MODEL', model: { ...model, floors: [{ ...model.floors[0], name: 'B' }] } })
    s = reducer(s, { type: 'DRAG_MODEL', model: { ...model, floors: [{ ...model.floors[0], name: 'C' }] } })
    s = reducer(s, { type: 'REDO' })
    expect(s.model.floors[0].name).toBe('B')
    expect(s.past).toHaveLength(1)
    expect(s.future).toHaveLength(0)
  })
})

describe('SPLIT_EDGE_AT_POINT', () => {
  it('inserts a new vertex splitting the target edge, and selects it', () => {
    const { model, a, b } = modelWithRectangle()
    let s = initialState(model)
    const edgeId = Object.values(s.model.floors[0].edges).find(e => e.v1 === a && e.v2 === b)!.id
    s = reducer(s, { type: 'SPLIT_EDGE_AT_POINT', edgeId, x: 2, y: 0 })
    expect(Object.keys(s.model.floors[0].edges)).toHaveLength(5)
    expect(s.ui.sel?.t).toBe('vertex')
  })
})

describe('SET_FLOOR_FIELD', () => {
  it('sets height_m as a number', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_FLOOR_FIELD', key: 'height_m', value: '2.8' })
    expect(s.model.floors[0].height_m).toBe(2.8)
  })

  it('sets name as a string', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_FLOOR_FIELD', key: 'name', value: 'Sótano' })
    expect(s.model.floors[0].name).toBe('Sótano')
  })
})

describe('SET_FLOOR_PARAM', () => {
  it('changing extWall_m bulk-updates every currently-exterior edge\'s thickness', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_FLOOR_PARAM', key: 'extWall_m', value: 0.20 })
    const f = s.model.floors[0]
    expect(f.extWall_m).toBeCloseTo(0.20)
    Object.values(f.edges).forEach(e => expect(e.thickness).toBeCloseTo(0.20))
  })
})

describe('SET_EDGE_THICKNESS', () => {
  it('updates a single edge\'s thickness without touching others', () => {
    const { model, a, b } = modelWithRectangle()
    let s = initialState(model)
    const edgeId = Object.values(s.model.floors[0].edges).find(e => e.v1 === a && e.v2 === b)!.id
    const otherId = Object.values(s.model.floors[0].edges).find(e => e.id !== edgeId)!.id
    const otherBefore = s.model.floors[0].edges[otherId].thickness
    s = reducer(s, { type: 'SET_EDGE_THICKNESS', edgeId, value: 0.25 })
    expect(s.model.floors[0].edges[edgeId].thickness).toBeCloseTo(0.25)
    expect(s.model.floors[0].edges[otherId].thickness).toBeCloseTo(otherBefore)
  })
})

describe('DELETE_SEL', () => {
  it('deletes the selected edge and clears selection', () => {
    const { model, a, b } = modelWithRectangle()
    let s = initialState(model)
    const edgeId = Object.values(s.model.floors[0].edges).find(e => e.v1 === a && e.v2 === b)!.id
    s = reducer(s, { type: 'SET_SEL', sel: { t: 'edge', id: edgeId } })
    s = reducer(s, { type: 'DELETE_SEL' })
    expect(s.model.floors[0].edges[edgeId]).toBeUndefined()
    expect(s.ui.sel).toBeNull()
  })
})

describe('removeVertexFromFloor / removeEdgeFromFloor / removeOpeningFromFloor', () => {
  it('removeEdgeFromFloor deletes the edge and leaves its vertices', () => {
    const f = emptyFloorGraph('T')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.1)
    removeEdgeFromFloor(f, e)
    expect(f.edges[e]).toBeUndefined()
    expect(f.vertices[a]).toBeDefined()
  })
  it('removeVertexFromFloor cascades to delete every edge touching it', () => {
    const f = emptyFloorGraph('T')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.1)
    removeVertexFromFloor(f, a)
    expect(f.vertices[a]).toBeUndefined()
    expect(f.edges[e]).toBeUndefined()
  })
  it('removeOpeningFromFloor drops the opening at the given index on the given edge', () => {
    const f = emptyFloorGraph('T')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.1)
    f.edges[e].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })
    removeOpeningFromFloor(f, e, 0)
    expect(f.edges[e].openings).toHaveLength(0)
  })
})

describe('camera actions (view-only, never touch history)', () => {
  it('starts with no camera (auto-fit)', () => {
    const { model } = modelWithRectangle()
    expect(initialState(model).ui.camera).toBeNull()
  })

  it('SET_CAMERA sets the camera without pushing history or marking dirty', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_CAMERA', camera: { scale: 100, centerX: 2, centerY: 1 } })
    expect(s.ui.camera).toEqual({ scale: 100, centerX: 2, centerY: 1 })
    expect(s.past).toHaveLength(0)
    expect(s.dirty).toBe(false)
  })

  it('RESET_CAMERA clears the camera back to auto-fit (null)', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_CAMERA', camera: { scale: 100, centerX: 2, centerY: 1 } })
    s = reducer(s, { type: 'RESET_CAMERA' })
    expect(s.ui.camera).toBeNull()
    expect(s.past).toHaveLength(0)
  })

  it('ZOOM_AT zooms around the anchor, keeping the anchor point\'s world position fixed', () => {
    const { model } = modelWithRectangle()
    const s = reducer(initialState(model), {
      type: 'ZOOM_AT', anchor: { x: 4, y: 0 }, factor: 2, seed: { scale: 100, centerX: 0, centerY: 0 },
    })
    expect(s.ui.camera).toEqual({ scale: 200, centerX: 2, centerY: 0 })
    expect(s.past).toHaveLength(0)
    expect(s.dirty).toBe(false)
  })

  it('ZOOM_AT uses the provided seed only while camera is still null', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, {
      type: 'ZOOM_AT', anchor: { x: 0, y: 0 }, factor: 1.5, seed: { scale: 50, centerX: 0, centerY: 0 },
    })
    expect(s.ui.camera!.scale).toBe(75)
    // second zoom: camera is no longer null, so the (now-stale) seed must be ignored
    s = reducer(s, {
      type: 'ZOOM_AT', anchor: { x: 0, y: 0 }, factor: 2, seed: { scale: 999, centerX: 0, centerY: 0 },
    })
    expect(s.ui.camera!.scale).toBe(150)
  })

  it('ZOOM_AT clamps scale to sane bounds instead of zooming without limit', () => {
    const { model } = modelWithRectangle()
    const zoomedIn = reducer(initialState(model), {
      type: 'ZOOM_AT', anchor: { x: 0, y: 0 }, factor: 1e9, seed: { scale: 100, centerX: 0, centerY: 0 },
    })
    expect(zoomedIn.ui.camera!.scale).toBeLessThan(1e9)
    const zoomedOut = reducer(initialState(model), {
      type: 'ZOOM_AT', anchor: { x: 0, y: 0 }, factor: 1e-9, seed: { scale: 100, centerX: 0, centerY: 0 },
    })
    expect(zoomedOut.ui.camera!.scale).toBeGreaterThan(0)
  })

  it('SWITCH_FLOOR and ADD_FLOOR preserve the camera (view state is shared across floors, not reset)', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_CAMERA', camera: { scale: 100, centerX: 2, centerY: 1 } })
    s = reducer(s, { type: 'ADD_FLOOR' })
    expect(s.ui.camera).toEqual({ scale: 100, centerX: 2, centerY: 1 })
    s = reducer(s, { type: 'SWITCH_FLOOR', index: 0 })
    expect(s.ui.camera).toEqual({ scale: 100, centerX: 2, centerY: 1 })
  })
})
