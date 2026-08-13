import { describe, it, expect } from 'vitest'
import { emptyFloorGraph, GHOST_THICKNESS_M, FIXTURE_CATALOG, clone } from './types'
import { addVertex, addEdge, splitEdgeAtVertex } from './graph'
import {
  reducer, initialState, removeVertexFromFloor, removeEdgeFromFloor, removeOpeningFromFloor,
  removeFixtureFromFloor,
} from './reducer'

function modelWithRectangle() {
  const f = emptyFloorGraph('Test')
  const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  return { model: { slab_m: 0.15, activeFloor: 0, floors: [f] }, a, b, c, d }
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

/** Rectángulo 6x4 con una división fantasma vertical en x=3 (dos cuartos de 3x4). */
function modelWithGhostDivider() {
  const f = emptyFloorGraph('Test')
  const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
  const eBottom = addEdge(f, a, b, 0.15)
  addEdge(f, b, c, 0.15)
  const eTop = addEdge(f, c, d, 0.15)
  addEdge(f, d, a, 0.15)
  const botMid = addVertex(f, 3, 0)
  const topMid = addVertex(f, 3, 4)
  splitEdgeAtVertex(f, eBottom, botMid)
  splitEdgeAtVertex(f, eTop, topMid)
  const ghostId = addEdge(f, botMid, topMid, GHOST_THICKNESS_M, 'ghost')
  return { model: { slab_m: 0.15, activeFloor: 0, floors: [f] }, ghostId }
}

describe('aristas fantasma en el reducer', () => {
  it("SET_TOOL acepta la herramienta 'ghost'", () => {
    const { model } = modelWithGhostDivider()
    const s = reducer(initialState(model), { type: 'SET_TOOL', tool: 'ghost' })
    expect(s.ui.tool).toBe('ghost')
  })

  it('la vía de inserción (addEdge con kind + SET_MODEL) persiste la división', () => {
    const { model } = modelWithGhostDivider()
    const s = reducer(initialState(model), { type: 'SET_MODEL', model })
    const ghosts = Object.values(s.model.floors[0].edges).filter(e => e.kind === 'ghost')
    expect(ghosts).toHaveLength(1)
  })

  it('SET_FLOOR_PARAM no toca el espesor de las fantasmas (ni intWall_m ni extWall_m)', () => {
    const { model, ghostId } = modelWithGhostDivider()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_FLOOR_PARAM', key: 'intWall_m', value: 0.12 })
    s = reducer(s, { type: 'SET_FLOOR_PARAM', key: 'extWall_m', value: 0.20 })
    expect(s.model.floors[0].edges[ghostId].thickness).toBeCloseTo(GHOST_THICKNESS_M)
  })

  it('ADD_OPENING sobre un muro agrega la abertura, la selecciona y empuja historia', () => {
    const { model } = modelWithGhostDivider()
    let s = initialState(model)
    const wallId = Object.values(s.model.floors[0].edges).find(e => e.kind !== 'ghost')!.id
    s = reducer(s, { type: 'ADD_OPENING', edgeId: wallId, opening: { kind: 'door', offset: 0.5, width: 0.9 } })
    expect(s.model.floors[0].edges[wallId].openings).toHaveLength(1)
    expect(s.ui.sel).toEqual({ t: 'opening', edgeId: wallId, index: 0 })
    expect(s.past).toHaveLength(1)
  })

  it('ADD_OPENING sobre una fantasma es no-op: una división no es muro para nada más', () => {
    const { model, ghostId } = modelWithGhostDivider()
    const s = initialState(model)
    expect(reducer(s, { type: 'ADD_OPENING', edgeId: ghostId, opening: { kind: 'door', offset: 0.5, width: 0.9 } })).toBe(s)
  })

  it('SET_EDGE_KIND muro→fantasma fija el espesor nominal de fantasma', () => {
    const { model } = modelWithGhostDivider()
    let s = initialState(model)
    const wallId = Object.values(s.model.floors[0].edges).find(e => e.kind !== 'ghost')!.id
    s = reducer(s, { type: 'SET_EDGE_KIND', edgeId: wallId, kind: 'ghost' })
    expect(s.model.floors[0].edges[wallId].kind).toBe('ghost')
    expect(s.model.floors[0].edges[wallId].thickness).toBeCloseTo(GHOST_THICKNESS_M)
  })

  it('SET_EDGE_KIND muro→fantasma con aberturas se rechaza (no-op)', () => {
    const { model } = modelWithGhostDivider()
    const wallId = Object.values(model.floors[0].edges).find(e => e.kind !== 'ghost')!.id
    model.floors[0].edges[wallId].openings.push({ kind: 'door', offset: 0.5, width: 0.9 })
    const s = initialState(model)
    expect(reducer(s, { type: 'SET_EDGE_KIND', edgeId: wallId, kind: 'ghost' })).toBe(s)
  })

  it('SET_EDGE_KIND fantasma→muro interior restaura el espesor interior', () => {
    const { model, ghostId } = modelWithGhostDivider()
    let s = initialState(model)
    s = reducer(s, { type: 'SET_EDGE_KIND', edgeId: ghostId, kind: 'wall' })
    const e = s.model.floors[0].edges[ghostId]
    expect(e.kind).toBeUndefined()
    expect(e.thickness).toBeCloseTo(model.floors[0].intWall_m)
  })

  it('SET_EDGE_KIND fantasma→muro en el contorno restaura el espesor exterior', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    const ghostSide = addEdge(f, a, b, GHOST_THICKNESS_M, 'ghost')
    addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    let s = initialState({ slab_m: 0.15, activeFloor: 0, floors: [f] })
    s = reducer(s, { type: 'SET_EDGE_KIND', edgeId: ghostSide, kind: 'wall' })
    expect(s.model.floors[0].edges[ghostSide].thickness).toBeCloseTo(f.extWall_m)
  })

  it('SET_EDGE_THICKNESS sobre una fantasma es no-op: su espesor nominal no se edita', () => {
    const { model, ghostId } = modelWithGhostDivider()
    const s = initialState(model)
    expect(reducer(s, { type: 'SET_EDGE_THICKNESS', edgeId: ghostId, value: 0.25 })).toBe(s)
  })

  it('SET_EDGE_KIND al kind que ya tiene es no-op (sin entrada de historia basura)', () => {
    const { model, ghostId } = modelWithGhostDivider()
    const s = initialState(model)
    expect(reducer(s, { type: 'SET_EDGE_KIND', edgeId: ghostId, kind: 'ghost' })).toBe(s)
    const wallId = Object.values(model.floors[0].edges).find(e => e.kind !== 'ghost')!.id
    expect(reducer(s, { type: 'SET_EDGE_KIND', edgeId: wallId, kind: 'wall' })).toBe(s)
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
  it('removeFixtureFromFloor drops the fixture with the given id', () => {
    const f = emptyFloorGraph('T')
    f.fixtures = [{ id: 'fx1', kind: 'silla', x: 0, y: 0, rot: 0, w_m: 0.45, h_m: 0.45 }]
    removeFixtureFromFloor(f, 'fx1')
    expect(f.fixtures).toHaveLength(0)
  })
  it('removeFixtureFromFloor no truena en un floor sin la clave fixtures', () => {
    const f = emptyFloorGraph('T')
    delete f.fixtures
    expect(() => removeFixtureFromFloor(f, 'nope')).not.toThrow()
    expect(f.fixtures).toEqual([])
  })
})

describe('fixtures en el reducer', () => {
  it('ADD_FIXTURE coloca un mueble con las dimensiones default del catálogo, lo selecciona y empuja historia', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'ADD_FIXTURE', kind: 'cama_matrimonial', x: 1, y: 1.5 })
    const fixtures = s.model.floors[0].fixtures ?? []
    expect(fixtures).toHaveLength(1)
    const fx = fixtures[0]
    expect(fx.kind).toBe('cama_matrimonial')
    expect(fx.x).toBe(1)
    expect(fx.y).toBe(1.5)
    expect(fx.rot).toBe(0)
    expect(fx.w_m).toBeCloseTo(FIXTURE_CATALOG.cama_matrimonial.w_m)
    expect(fx.h_m).toBeCloseTo(FIXTURE_CATALOG.cama_matrimonial.h_m)
    expect(s.ui.sel).toEqual({ t: 'fixture', id: fx.id })
    expect(s.past).toHaveLength(1)
  })

  it('MOVE_FIXTURE actualiza x/y del mueble', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'ADD_FIXTURE', kind: 'silla', x: 0, y: 0 })
    const id = (s.ui.sel as { t: 'fixture'; id: string }).id
    s = reducer(s, { type: 'MOVE_FIXTURE', id, x: 2.5, y: 1.5 })
    const fx = s.model.floors[0].fixtures!.find(x => x.id === id)!
    expect(fx.x).toBe(2.5)
    expect(fx.y).toBe(1.5)
  })

  it('MOVE_FIXTURE sobre un id inexistente es no-op', () => {
    const { model } = modelWithRectangle()
    const s = initialState(model)
    expect(reducer(s, { type: 'MOVE_FIXTURE', id: 'no-existe', x: 1, y: 1 })).toBe(s)
  })

  it('SET_FIXTURE_PARAM actualiza w_m/h_m/rot de forma independiente (updates parciales)', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'ADD_FIXTURE', kind: 'mesa', x: 0, y: 0 })
    const id = (s.ui.sel as { t: 'fixture'; id: string }).id

    s = reducer(s, { type: 'SET_FIXTURE_PARAM', id, patch: { rot: 90 } })
    let fx = s.model.floors[0].fixtures!.find(x => x.id === id)!
    expect(fx.rot).toBe(90)
    expect(fx.w_m).toBeCloseTo(FIXTURE_CATALOG.mesa.w_m) // sin tocar por el update parcial

    s = reducer(s, { type: 'SET_FIXTURE_PARAM', id, patch: { w_m: 2.0, h_m: 1.1 } })
    fx = s.model.floors[0].fixtures!.find(x => x.id === id)!
    expect(fx.w_m).toBeCloseTo(2.0)
    expect(fx.h_m).toBeCloseTo(1.1)
    expect(fx.rot).toBe(90) // preservado del update anterior, no pisado
  })

  it('SET_FIXTURE_PARAM sobre un id inexistente es no-op', () => {
    const { model } = modelWithRectangle()
    const s = initialState(model)
    expect(reducer(s, { type: 'SET_FIXTURE_PARAM', id: 'no-existe', patch: { rot: 45 } })).toBe(s)
  })

  it('DELETE_SEL borra un mueble seleccionado y limpia la selección', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'ADD_FIXTURE', kind: 'sillon', x: 0, y: 0 })
    s = reducer(s, { type: 'DELETE_SEL' })
    expect(s.model.floors[0].fixtures).toHaveLength(0)
    expect(s.ui.sel).toBeNull()
  })

  it('un gesto completo de arrastre (DRAG_MODEL × N + MOVE_FIXTURE) deshace como un solo paso de historia', () => {
    const { model } = modelWithRectangle()
    let s = initialState(model)
    s = reducer(s, { type: 'ADD_FIXTURE', kind: 'lavabo', x: 0, y: 0 })
    const id = (s.ui.sel as { t: 'fixture'; id: string }).id
    expect(s.past).toHaveLength(1) // past[0] = el modelo antes de agregar el mueble

    const withFixtureAt = (x: number, y: number) => {
      const m = clone(s.model)
      m.floors[0].fixtures = m.floors[0].fixtures!.map(fx => fx.id === id ? { ...fx, x, y } : fx)
      return m
    }
    s = reducer(s, { type: 'DRAG_MODEL', model: withFixtureAt(1, 1) })
    s = reducer(s, { type: 'DRAG_MODEL', model: withFixtureAt(2, 2) })
    s = reducer(s, { type: 'MOVE_FIXTURE', id, x: 3, y: 3 })

    expect(s.model.floors[0].fixtures!.find(fx => fx.id === id)!.x).toBe(3)
    expect(s.past).toHaveLength(2) // una sola entrada nueva por todo el gesto, no una por frame de drag

    s = reducer(s, { type: 'UNDO' })
    const fx = s.model.floors[0].fixtures!.find(f => f.id === id)!
    expect(fx.x).toBe(0) // vuelve a la posición pre-gesto, no a un frame intermedio del drag
    expect(fx.y).toBe(0)
  })

  it('un floor cargado sin la clave fixtures (blob previo a esta feature) no truena', () => {
    const { model } = modelWithRectangle()
    delete model.floors[0].fixtures
    let s = initialState(model)
    expect(reducer(s, { type: 'MOVE_FIXTURE', id: 'x', x: 1, y: 1 })).toBe(s)
    expect(reducer(s, { type: 'SET_FIXTURE_PARAM', id: 'x', patch: { rot: 10 } })).toBe(s)

    s = reducer(s, { type: 'ADD_FIXTURE', kind: 'estufa', x: 0, y: 0 })
    expect(s.model.floors[0].fixtures).toHaveLength(1)

    s = reducer(s, { type: 'SET_SEL', sel: { t: 'fixture', id: s.model.floors[0].fixtures![0].id } })
    s = reducer(s, { type: 'DELETE_SEL' })
    expect(s.model.floors[0].fixtures).toHaveLength(0)
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

describe('ADD_FLOOR', () => {
  it('el piso nuevo tiene un id distinto al del piso clonado, nunca lo hereda', () => {
    // Riesgo: ADD_FLOOR clona el piso activo completo (clone(F(m))), y clonar copia TODOS
    // los campos incluyendo `id` a menos que se sobreescriba explícitamente. Si el clon se
    // quedara con el id heredado, dos pisos del mismo FloorSet compartirían identidad — y
    // la atribución de renders por piso (task futura) no podría distinguirlos.
    const { model } = modelWithRectangle()
    const sourceId = model.floors[0].id
    let s = initialState(model)
    s = reducer(s, { type: 'ADD_FLOOR' })
    expect(s.model.floors).toHaveLength(2)
    const newFloor = s.model.floors[s.model.activeFloor]
    expect(newFloor.id).toBeTruthy()
    expect(newFloor.id).not.toBe(sourceId)
  })
})
