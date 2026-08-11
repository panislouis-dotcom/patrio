import { describe, it, expect } from 'vitest'
import { emptyFloorGraph, GHOST_THICKNESS_M } from './types'
import {
  addVertex, addEdge, moveVertex, translateEdgeBody,
  splitEdgeAtVertex, mergeVertexInto, deleteVertex, deleteEdge,
  nearestVertex, nearestEdgePoint, SNAP,
} from './graph'

describe('addVertex / addEdge', () => {
  it('creates a wall between two fresh vertices', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 0, 0)
    const v2 = addVertex(f, 4, 0)
    const e = addEdge(f, v1, v2, 0.10)
    expect(f.edges[e].v1).toBe(v1)
    expect(f.edges[e].v2).toBe(v2)
    expect(Object.keys(f.vertices)).toHaveLength(2)
  })
})

describe('moveVertex', () => {
  it('moving a shared vertex moves every edge that references it', () => {
    const f = emptyFloorGraph('Test')
    const corner = addVertex(f, 0, 0)
    const a = addVertex(f, 4, 0)
    const b = addVertex(f, 0, 4)
    addEdge(f, corner, a, 0.15)
    addEdge(f, corner, b, 0.15)
    moveVertex(f, corner, 1, 1)
    expect(f.vertices[corner].x).toBe(1)
    expect(f.vertices[corner].y).toBe(1)
    // both edges still reference the SAME vertex id — no separate coincidence check needed
    const touching = Object.values(f.edges).filter(e => e.v1 === corner || e.v2 === corner)
    expect(touching).toHaveLength(2)
  })
})

describe('translateEdgeBody', () => {
  it('translates both endpoints by an identical delta, preserving a diagonal shape', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 1, 1)
    const v2 = addVertex(f, 4, 3)
    const e = addEdge(f, v1, v2, 0.10)
    translateEdgeBody(f, e, 0.3, 0.3)
    expect(f.vertices[v1].x).toBeCloseTo(1.3)
    expect(f.vertices[v1].y).toBeCloseTo(1.3)
    expect(f.vertices[v2].x).toBeCloseTo(4.3)
    expect(f.vertices[v2].y).toBeCloseTo(3.3)
    // shape (the vector from v1 to v2) is unchanged — no force-straightening
    expect(f.vertices[v2].x - f.vertices[v1].x).toBeCloseTo(3)
    expect(f.vertices[v2].y - f.vertices[v1].y).toBeCloseTo(2)
  })

  it('dragging a wall body also drags a wall sharing one of its endpoints', () => {
    const f = emptyFloorGraph('Test')
    const shared = addVertex(f, 0, 0)
    const far = addVertex(f, 4, 0)
    const perpFar = addVertex(f, 0, 4)
    const e = addEdge(f, shared, far, 0.10)
    addEdge(f, shared, perpFar, 0.10)
    translateEdgeBody(f, e, 2, 0)
    expect(f.vertices[shared].x).toBe(2)
    // the perpendicular wall's shared corner followed the drag (connected by construction),
    // while its far end stayed put — only edge e's own endpoints translate
    expect(f.vertices[perpFar].x).toBe(0)
  })
})

describe('splitEdgeAtVertex (T-junction)', () => {
  it('splits one edge into two sharing the given vertex, redistributing openings by position', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 0, 0)
    const v2 = addVertex(f, 10, 0)
    const e = addEdge(f, v1, v2, 0.15)
    f.edges[e].openings.push({ kind: 'door', offset: 0.8, width: 0.9 }) // at x=8
    const mid = addVertex(f, 4, 0) // T-junction point at x=4
    const newEdgeId = splitEdgeAtVertex(f, e, mid)
    expect(f.edges[e].v1).toBe(v1)
    expect(f.edges[e].v2).toBe(mid)
    expect(f.edges[newEdgeId].v1).toBe(mid)
    expect(f.edges[newEdgeId].v2).toBe(v2)
    expect(f.edges[e].openings).toHaveLength(0)          // opening at x=8 is past the split
    expect(f.edges[newEdgeId].openings).toHaveLength(1)
    expect(f.edges[newEdgeId].openings[0].offset).toBeCloseTo((8 - 4) / (10 - 4))
  })
})

describe('mergeVertexInto', () => {
  it('reassigns edges from the removed vertex to the kept vertex and deletes it', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0)
    const b = addVertex(f, 4, 0)
    const c = addVertex(f, 4.001, 0.001) // "same place" by drag, not by coincidence
    const e = addEdge(f, a, c, 0.10)
    mergeVertexInto(f, c, b)
    expect(f.edges[e].v2).toBe(b)
    expect(f.vertices[c]).toBeUndefined()
  })

  it('deletes an edge that becomes degenerate (both ends merge to the same vertex)', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0)
    const b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.10)
    mergeVertexInto(f, b, a)
    expect(f.edges[e]).toBeUndefined()
  })
})

describe('kind fantasma en operaciones de grafo', () => {
  it('addEdge registra kind ghost; sin kind el muro queda con la propiedad ausente', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 0, 0), v2 = addVertex(f, 4, 0)
    const wall = addEdge(f, v1, v2, 0.10)
    const ghost = addEdge(f, v1, v2, GHOST_THICKNESS_M, 'ghost')
    // el blob persistido de un muro no cambia ni un byte: 'kind' ausente = muro
    expect('kind' in f.edges[wall]).toBe(false)
    expect(f.edges[ghost].kind).toBe('ghost')
  })

  it('partir una fantasma da dos fantasmas, no una fantasma y un muro', () => {
    // El editor auto-parte aristas en T-junctions: si el kind no se propagara, al
    // usuario le aparecería un muro a media división.
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 0, 0), v2 = addVertex(f, 10, 0)
    const e = addEdge(f, v1, v2, GHOST_THICKNESS_M, 'ghost')
    const mid = addVertex(f, 4, 0)
    const newEdgeId = splitEdgeAtVertex(f, e, mid)
    expect(f.edges[e].kind).toBe('ghost')
    expect(f.edges[newEdgeId].kind).toBe('ghost')
  })

  it('mergeVertexInto conserva el kind y nunca fusiona un muro con una fantasma', () => {
    const f = emptyFloorGraph('Test')
    const keep = addVertex(f, 0, 0)
    const remove = addVertex(f, 0.001, 0.001) // "mismo lugar" por arrastre
    const far = addVertex(f, 4, 0)
    const wall = addEdge(f, keep, far, 0.10)
    const ghost = addEdge(f, remove, far, GHOST_THICKNESS_M, 'ghost')
    mergeVertexInto(f, remove, keep)
    // ambas sobreviven como aristas separadas entre los mismos vértices, cada una con su kind
    expect(f.edges[wall].kind).toBeUndefined()
    expect(f.edges[ghost].kind).toBe('ghost')
    expect(f.edges[ghost].v1).toBe(keep)
  })
})

describe('deleteVertex / deleteEdge', () => {
  it('deleteVertex removes the vertex and every edge touching it', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0)
    const b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.10)
    deleteVertex(f, a)
    expect(f.vertices[a]).toBeUndefined()
    expect(f.edges[e]).toBeUndefined()
  })

  it('deleteEdge leaves both vertices in place', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0)
    const b = addVertex(f, 4, 0)
    const e = addEdge(f, a, b, 0.10)
    deleteEdge(f, e)
    expect(f.vertices[a]).toBeDefined()
    expect(f.vertices[b]).toBeDefined()
    expect(f.edges[e]).toBeUndefined()
  })
})

describe('nearestVertex', () => {
  it('finds a vertex within SNAP distance, excluding a given id', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0)
    const b = addVertex(f, 5, 5)
    const hit = nearestVertex(f, { x: 0.05, y: 0.02 }, new Set([b]))
    expect(hit?.id).toBe(a)
  })
  it('returns null when nothing is within SNAP', () => {
    const f = emptyFloorGraph('Test')
    addVertex(f, 0, 0)
    expect(nearestVertex(f, { x: 5, y: 5 }, new Set())).toBeNull()
  })
})

describe('nearestEdgePoint', () => {
  it('finds the projected point on an edge body, excluding near-endpoint hits', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 0, 0)
    const v2 = addVertex(f, 10, 0)
    const e = addEdge(f, v1, v2, 0.15)
    const hit = nearestEdgePoint(f, { x: 4, y: 0.05 }, new Set())
    expect(hit?.edgeId).toBe(e)
    expect(hit?.x).toBeCloseTo(4)
    expect(hit?.y).toBeCloseTo(0)
  })
  it('excludes a hit too close to either endpoint (that is vertex-snap territory, not a T-junction)', () => {
    const f = emptyFloorGraph('Test')
    const v1 = addVertex(f, 0, 0)
    const v2 = addVertex(f, 10, 0)
    addEdge(f, v1, v2, 0.15)
    expect(nearestEdgePoint(f, { x: 0.05, y: 0 }, new Set())).toBeNull()
  })
})

describe('SNAP', () => {
  it('is a positive magnet radius in metres', () => {
    expect(SNAP).toBeGreaterThan(0)
    expect(SNAP).toBeLessThan(1)
  })
})
