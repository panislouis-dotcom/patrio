import type { Reference } from './types'
import type { Pt } from './geometry'

/** Derive scale from a line the user drew over a known real-world dimension. */
export function calibrationFromLine(
  p0_px: Pt, p1_px: Pt, realLen_m: number, origin_px: Pt,
): { scale_m_per_px: number; origin_px: Pt } {
  const pixelDist = Math.hypot(p1_px[0] - p0_px[0], p1_px[1] - p0_px[1])
  return { scale_m_per_px: realLen_m / pixelDist, origin_px }
}

/** Image pixel -> model metres. y flips (image y is down, model y is up). */
export function pxToModel(px: Pt, ref: Pick<Reference, 'scale_m_per_px' | 'origin_px'>): Pt {
  return [
    (px[0] - ref.origin_px[0]) * ref.scale_m_per_px,
    (ref.origin_px[1] - px[1]) * ref.scale_m_per_px,
  ]
}

/** Model metres -> image pixel (inverse of pxToModel). */
export function modelToPx(pt: Pt, ref: Pick<Reference, 'scale_m_per_px' | 'origin_px'>): Pt {
  return [
    ref.origin_px[0] + pt[0] / ref.scale_m_per_px,
    ref.origin_px[1] - pt[1] / ref.scale_m_per_px,
  ]
}
