import { describe, it, expect } from 'vitest'
import { dist, segLen, shoelaceSigned, shoelace, polygonCentroid, projectAt, pointAt, edgeAxis } from './geometry'

describe('dist / segLen', () => {
  it('computes euclidean distance', () => {
    expect(dist([0, 0], [3, 4])).toBe(5)
    expect(segLen([0, 0], [3, 4])).toBe(5)
  })
})

describe('shoelaceSigned / shoelace', () => {
  it('is positive for a CCW square, negative for CW, same magnitude', () => {
    const ccw: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]]
    const cw = [...ccw].reverse() as [number, number][]
    expect(shoelaceSigned(ccw)).toBeCloseTo(16)
    expect(shoelaceSigned(cw)).toBeCloseTo(-16)
    expect(shoelace(ccw)).toBeCloseTo(16)
    expect(shoelace(cw)).toBeCloseTo(16)
  })
})

describe('polygonCentroid', () => {
  it('finds the centroid of a square at its geometric center', () => {
    const sq: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]]
    const [cx, cy] = polygonCentroid(sq)
    expect(cx).toBeCloseTo(2)
    expect(cy).toBeCloseTo(2)
  })
})

describe('projectAt / pointAt', () => {
  it('projects a point onto a segment and inverts', () => {
    const atM = projectAt([0, 0], [10, 0], { x: 4, y: 3 })
    expect(atM).toBeCloseTo(4)
    const [x, y] = pointAt([0, 0], [10, 0], atM)
    expect(x).toBeCloseTo(4)
    expect(y).toBeCloseTo(0)
  })
  it('clamps to the segment ends', () => {
    expect(projectAt([0, 0], [10, 0], { x: -5, y: 0 })).toBe(0)
    expect(projectAt([0, 0], [10, 0], { x: 50, y: 0 })).toBe(10)
  })
})

describe('edgeAxis', () => {
  // Pin de signo: FloorPlanCanvas.tsx (línea de hoja de puerta, `ax + nx*op.width`) y
  // planImage.ts (mismo cálculo, sin JSX) YA asumen nx=-uy, ny=ux — la normal a la
  // IZQUIERDA del sentido p1->p2. Este test fija ese contrato numéricamente: si alguien
  // cambia el signo aquí, ambos consumidores dibujan la hoja/marcador del lado contrario
  // sin que ningún tipo lo detecte.
  it('a horizontal edge p1->p2 gives the unit axis and its left-hand normal', () => {
    const { L, ux, uy, nx, ny } = edgeAxis({ x: 0, y: 0 }, { x: 4, y: 0 })
    expect(L).toBe(4)
    expect(ux).toBe(1)
    expect(uy).toBe(0)
    expect(nx).toBe(-0) // -uy con uy=0 → -0, mismo valor numérico que 0
    expect(ny).toBe(1)
  })

  it('a vertical edge rotates axis and normal accordingly', () => {
    const { L, ux, uy, nx, ny } = edgeAxis({ x: 0, y: 0 }, { x: 0, y: 3 })
    expect(L).toBe(3)
    expect(ux).toBe(0)
    expect(uy).toBe(1)
    expect(nx).toBe(-1)
    expect(ny).toBe(0)
  })

  it('falls back to L=1 (avoids divide-by-zero) for a degenerate zero-length edge', () => {
    const { L, ux, uy } = edgeAxis({ x: 2, y: 2 }, { x: 2, y: 2 })
    expect(L).toBe(1)
    expect(ux).toBe(0)
    expect(uy).toBe(0)
  })
})
