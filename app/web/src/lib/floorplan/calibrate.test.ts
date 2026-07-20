import { describe, it, expect } from 'vitest'
import { calibrationFromLine, pxToModel, modelToPx } from './calibrate'

describe('calibrationFromLine', () => {
  it('derives metres-per-pixel from a drawn line and a known real length', () => {
    const { scale_m_per_px } = calibrationFromLine([0, 0], [100, 0], 5, [0, 0])
    expect(scale_m_per_px).toBeCloseTo(0.05)
  })
})

describe('pxToModel / modelToPx', () => {
  it('round-trips a pixel through model space and back', () => {
    const ref = { scale_m_per_px: 0.02, origin_px: [50, 80] as [number, number] }
    const px: [number, number] = [150, 30]
    const model = pxToModel(px, ref)
    const back = modelToPx(model, ref)
    expect(back[0]).toBeCloseTo(px[0])
    expect(back[1]).toBeCloseTo(px[1])
  })
  it('flips y (image-down vs model-up)', () => {
    const ref = { scale_m_per_px: 1, origin_px: [0, 0] as [number, number] }
    const [, my] = pxToModel([0, 10], ref)
    expect(my).toBeCloseTo(-10)
  })
})
