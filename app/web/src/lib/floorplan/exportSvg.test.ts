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

function rect(w: number, h: number, name = 'Recámara'): FloorGraph {
  const pts = [[0, 0], [w, 0], [w, h], [0, h]]
  const vertices = Object.fromEntries(pts.map(([x, y], i) => [`v${i}`, { id: `v${i}`, x, y }]))
  const edges = Object.fromEntries(pts.map((_, i) => [`e${i}`, {
    id: `e${i}`, v1: `v${i}`, v2: `v${(i + 1) % 4}`, thickness: 0.15, openings: [],
  }]))
  return {
    id: 'f1', name: 'Planta Baja', height_m: 2.6, extWall_m: 0.15, intWall_m: 0.10,
    vertices, edges, rooms: [{ name, cx: w / 2, cy: h / 2 }], fixtures: [], manualDimensions: [],
  }
}
const xsOf = (svg: string) => [...svg.matchAll(/\sx[12]?="([-\d.]+)"/g)].map(m => parseFloat(m[1]))
const ysOf = (svg: string) => [...svg.matchAll(/\sy[12]?="([-\d.]+)"/g)].map(m => parseFloat(m[1]))
const box = (svg: string) => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!.slice(1).map(Number)
const wallPx = (svg: string) => parseFloat(svg.match(/<line[^>]*stroke-width="([\d.]+)"/)![1])

describe('floorToSvg con scale compartida', () => {
  it('dibuja dos pisos de distinto tamaño en proporción real y con el mismo grosor de muro', () => {
    // Este es el caso Antes/Después: el mismo piso, ensanchado de 4.2 a 5.0 m.
    const antes = floorToSvg(rect(4.2, 3.1), { scale: 160 })
    const despues = floorToSvg(rect(5.0, 3.1), { scale: 160 })
    const [wa] = box(antes), [wd] = box(despues)
    // 192 = 2 * margen(96); lo que queda es el ancho real del piso a la misma escala.
    expect((wd - 192) / (wa - 192)).toBeCloseTo(5.0 / 4.2, 2)
    expect(wallPx(despues)).toBeCloseTo(wallPx(antes), 5)
  })

  it('mantiene el alto igual cuando solo cambia el ancho', () => {
    const [, ha] = box(floorToSvg(rect(4.2, 3.1), { scale: 160 }))
    const [, hd] = box(floorToSvg(rect(5.0, 3.1), { scale: 160 }))
    expect(hd).toBe(ha)
  })

  it('no deja ninguna cota fuera del lienzo', () => {
    // Las cadenas de cota se dibujan hasta px(x1)+64 y py(y0)+54, FUERA del bbox del
    // contenido. Con el margen de 64 quedarían cortadas contra el borde derecho.
    const svg = floorToSvg(rect(4.2, 3.1), { scale: 160 })
    const [w, h] = box(svg)
    expect(Math.max(...xsOf(svg))).toBeLessThanOrEqual(w - 24)
    expect(Math.max(...ysOf(svg))).toBeLessThanOrEqual(h - 4)
    expect(Math.min(...xsOf(svg))).toBeGreaterThanOrEqual(0)
    expect(Math.min(...ysOf(svg))).toBeGreaterThanOrEqual(0)
  })

  it('sin scale la salida es idéntica a la de siempre — ↓ SVG no cambia', () => {
    const f = rect(4.2, 3.1)
    expect(floorToSvg(f)).toBe(floorToSvg(f, { width: 1200, height: 900, margin: 64 }))
    expect(box(floorToSvg(f))).toEqual([1200, 900])
  })
})
