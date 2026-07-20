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
