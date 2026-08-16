import { describe, it, expect } from 'vitest'
import { emptyFloorGraph, type FloorGraph } from './types'
import { addVertex, addEdge } from './graph'
import { floorToSvg } from './exportSvg'

function room4x3(): FloorGraph {
  const f = emptyFloorGraph('Planta Baja')
  const a = addVertex(f, 0, 0), b = addVertex(f, 4, 0), c = addVertex(f, 4, 3), d = addVertex(f, 0, 3)
  addEdge(f, a, b, 0.15); addEdge(f, b, c, 0.15); addEdge(f, c, d, 0.15); addEdge(f, d, a, 0.15)
  f.rooms.push({ name: 'Sala', cx: 2, cy: 1.5 })
  return f
}

describe('floorToSvg', () => {
  it('produces a standalone, print-friendly SVG with room, area, dimensions and title', () => {
    const svg = floorToSvg(room4x3())
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('fill="#ffffff"')   // white background (not the dark editor theme)
    expect(svg).toContain('Planta Baja')       // floor title
    expect(svg).toContain('Sala')              // room name
    expect(svg).toContain('12.00 m²')          // 4 × 3 net area
    expect(svg).toContain('4.00')              // a wall length label
    expect(svg.trim().endsWith('</svg>')).toBe(true)
  })

  it('escapes XML-special characters in room names so the SVG stays well-formed', () => {
    const f = room4x3()
    f.rooms = [{ name: 'Baño & <Estudio>', cx: 2, cy: 1.5 }]
    const svg = floorToSvg(f)
    expect(svg).toContain('Baño &amp; &lt;Estudio&gt;')
    expect(svg).not.toContain('<Estudio>')
  })
})
