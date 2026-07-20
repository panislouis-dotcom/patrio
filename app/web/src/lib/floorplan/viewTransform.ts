import type { FloorGraph } from './types'

export interface ViewTransform {
  scale: number
  px: (x: number) => number
  py: (y: number) => number
  userToWorld: (ux: number, uy: number) => { x: number; y: number }
  viewBox: string
  width: number
  height: number
}

export function viewTransform(
  floors: FloorGraph[], opts: { width: number; height: number; margin: number },
): ViewTransform {
  const pts = floors.flatMap(f => Object.values(f.vertices).map(v => [v.x, v.y] as [number, number]))
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const minx = Math.min(...xs, 0), maxx = Math.max(...xs, 1)
  const miny = Math.min(...ys, 0), maxy = Math.max(...ys, 1)
  const { width, height, margin } = opts
  const spanx = maxx - minx || 1, spany = maxy - miny || 1
  const scale = Math.min((width - 2 * margin) / spanx, (height - 2 * margin) / spany)
  const px = (x: number) => margin + (x - minx) * scale
  const py = (y: number) => height - margin - (y - miny) * scale
  const userToWorld = (ux: number, uy: number) => ({
    x: (ux - margin) / scale + minx,
    y: (height - margin - uy) / scale + miny,
  })
  return { scale, px, py, userToWorld, viewBox: `0 0 ${width} ${height}`, width, height }
}
