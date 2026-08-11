import { describe, it, expect } from 'vitest'
import { emptyFloorGraph, GHOST_THICKNESS_M } from './types'
import { addVertex, addEdge } from './graph'
import { floorToSvgString } from './planImage'

describe('floorToSvgString', () => {
  it('draws a line per wall and a text per named room', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 })
    const svg = floorToSvgString(f)
    expect(svg.startsWith('<svg')).toBe(true)
    expect((svg.match(/<line /g) || []).length).toBe(4)   // one per wall
    expect(svg).toContain('>Sala<')                        // the room name
  })

  it('escapes XML in room names', () => {
    const f = emptyFloorGraph('Test')
    f.rooms.push({ name: 'A & B', cx: 0.5, cy: 0.5 })
    expect(floorToSvgString(f)).toContain('A &amp; B')
  })

  it('draws the real walls but never a ghost — the render model would build a wall where there is none', () => {
    const f = emptyFloorGraph('Test')
    const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
    addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
    addEdge(f, a, c, GHOST_THICKNESS_M, 'ghost')
    const svg = floorToSvgString(f)
    expect((svg.match(/<line /g) || []).length).toBe(4)   // los 4 muros reales, la fantasma no
  })
})
