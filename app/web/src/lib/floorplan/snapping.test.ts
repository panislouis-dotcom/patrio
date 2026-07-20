import { describe, it, expect } from 'vitest'
import { emptyFloorGraph } from './types'
import { addVertex } from './graph'
import { snapPoint } from './snapping'

describe('snapPoint', () => {
  it('snaps onto a nearby existing vertex (excluding the dragged one itself)', () => {
    const f = emptyFloorGraph('Test')
    const dragged = addVertex(f, 0, 0)
    addVertex(f, 4, 4)
    const s = snapPoint(f, 4.05, 3.98, new Set([dragged]))
    expect(s.x).toBeCloseTo(4)
    expect(s.y).toBeCloseTo(4)
    expect(s.guides).toEqual([{ t: 'pt', x: 4, y: 4 }])
  })

  it('shows an axis guide when aligned with another vertex but not on top of it', () => {
    const f = emptyFloorGraph('Test')
    const dragged = addVertex(f, 0, 0)
    addVertex(f, 4, 4)
    const s = snapPoint(f, 4.02, 1, new Set([dragged]))
    expect(s.x).toBeCloseTo(4)
    expect(s.guides.some(g => g.t === 'vx' && g.x === 4)).toBe(true)
  })

  it('falls back to the 1cm grid when nothing is nearby', () => {
    const f = emptyFloorGraph('Test')
    const dragged = addVertex(f, 0, 0)
    const s = snapPoint(f, 2.3333, 1.6666, new Set([dragged]))
    expect(s.x).toBeCloseTo(2.33)
    expect(s.y).toBeCloseTo(1.67)
    expect(s.guides).toEqual([])
  })
})
