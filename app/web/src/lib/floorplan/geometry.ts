export type Pt = [number, number]

export const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1])
export const segLen = dist

/** Signed area (positive = counter-clockwise winding, negative = clockwise). */
export function shoelaceSigned(poly: Pt[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = poly[i], [c, d] = poly[(i + 1) % poly.length]
    s += a * d - c * b
  }
  return s / 2
}

export const shoelace = (poly: Pt[]): number => Math.abs(shoelaceSigned(poly))

/** True polygon centroid (not vertex average) — correct even for non-convex/L-shaped rooms. */
export function polygonCentroid(poly: Pt[]): Pt {
  const A = shoelaceSigned(poly)
  if (Math.abs(A) < 1e-9) {
    const n = poly.length || 1
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n]
  }
  let cx = 0, cy = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]
    const cross = x0 * y1 - x1 * y0
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  return [cx / (6 * A), cy / (6 * A)]
}

/** Ray-casting point-in-polygon test: true when (x, y) lies inside `poly`. */
export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/** Distance along segment p0->p1 nearest to pt, clamped to [0, L]. */
export function projectAt(p0: Pt, p1: Pt, pt: { x: number; y: number }): number {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy)
  if (L < 1e-9) return 0
  const t = ((pt.x - p0[0]) * dx + (pt.y - p0[1]) * dy) / (L * L)
  return Math.max(0, Math.min(L, t * L))
}

/** Point at distance atM along segment p0->p1 (inverse of projectAt). */
export function pointAt(p0: Pt, p1: Pt, atM: number): Pt {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy)
  const t = L ? atM / L : 0
  return [p0[0] + dx * t, p0[1] + dy * t]
}
