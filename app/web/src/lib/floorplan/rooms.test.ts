import { describe, it, expect } from 'vitest'
import { emptyFloorGraph } from './types'
import { addVertex, addEdge, splitEdgeAtVertex } from './graph'
import { traceFaces, roomAreas, exteriorEdgeIds } from './rooms'

function rectangle(f: ReturnType<typeof emptyFloorGraph>, x0: number, y0: number, x1: number, y1: number) {
  const a = addVertex(f, x0, y0), b = addVertex(f, x1, y0), c = addVertex(f, x1, y1), d = addVertex(f, x0, y1)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  return { a, b, c, d }
}

describe('traceFaces', () => {
  it('traces exactly 2 faces for a closed rectangle: the interior and the outer face', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    const faces = traceFaces(f)
    expect(faces).toHaveLength(2)
    const areas = faces.map(fc => Math.abs(fc.area)).sort((x, y) => x - y)
    expect(areas[0]).toBeCloseTo(12) // the bounded interior face
    expect(areas[1]).toBeCloseTo(12) // the outer face traces the same boundary, opposite winding
  })
})

describe('roomAreas', () => {
  it('reports one room for a plain closed rectangle', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    const rooms = roomAreas(f)
    expect(rooms).toHaveLength(1)
    expect(rooms[0].area).toBeCloseTo(12)
    expect(rooms[0].cx).toBeCloseTo(2)
    expect(rooms[0].cy).toBeCloseTo(1.5)
  })

  it('reports two rooms when an interior wall fully divides the rectangle', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 6, 0), c = addVertex(f, 6, 4), d = addVertex(f, 0, 4)
    const eBottom = addEdge(f, a, b, 0.15)          // y=0 edge
    addEdge(f, b, c, 0.15)                           // x=6 edge
    const eTop = addEdge(f, c, d, 0.15)             // y=4 edge
    addEdge(f, d, a, 0.15)                           // x=0 edge
    const botMid = addVertex(f, 3, 0)
    const topMid = addVertex(f, 3, 4)
    splitEdgeAtVertex(f, eBottom, botMid)
    splitEdgeAtVertex(f, eTop, topMid)
    addEdge(f, botMid, topMid, 0.10)
    const rooms = roomAreas(f)
    expect(rooms).toHaveLength(2)
    expect(rooms[0].area + rooms[1].area).toBeCloseTo(24)
  })

  it('gives no room when the boundary has a gap (not a closed cycle)', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15) // no closing edge back to a
    expect(roomAreas(f)).toHaveLength(0)
  })
})

describe('exteriorEdgeIds', () => {
  it('marks every edge of a plain rectangle as exterior', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 4, 3)
    const ext = exteriorEdgeIds(f)
    expect(ext.size).toBe(4)
    expect(Object.keys(f.edges).every(id => ext.has(id))).toBe(true)
  })

  it('does not mark an interior divider as exterior', () => {
    const f = emptyFloorGraph('Test')
    rectangle(f, 0, 0, 6, 4)
    const top = addVertex(f, 3, 0), bot = addVertex(f, 3, 4)
    const divider = addEdge(f, top, bot, 0.10)
    const ext = exteriorEdgeIds(f)
    expect(ext.has(divider)).toBe(false)
  })
})
