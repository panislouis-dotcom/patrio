import { describe, it, expect } from 'vitest'
import { dist, segLen, shoelaceSigned, shoelace, polygonCentroid, projectAt, pointAt } from './geometry'

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
