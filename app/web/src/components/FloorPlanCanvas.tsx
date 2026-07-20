// app/web/src/components/FloorPlanCanvas.tsx
import { forwardRef } from 'react'
import type React from 'react'
import { colors, fonts } from '../lib/theme'
import type { FloorPlanModel, FloorGraph } from '../lib/floorplan/types'
import type { ViewTransform } from '../lib/floorplan/viewTransform'
import type { RoomArea } from '../lib/floorplan/rooms'
import type { CornerAngle } from '../lib/floorplan/dimensions'
import { widthHeightChains } from '../lib/floorplan/dimensions'
import type { UI } from '../lib/floorplan/reducer'
import { BASE } from '../lib/api'

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)

export interface CanvasProps {
  model: FloorPlanModel
  floor: FloorGraph
  t: ViewTransform
  rooms: RoomArea[]
  angles: CornerAngle[]
  ui: UI
  editName: string
  imgNatural?: { w: number; h: number } | null
  calDraft?: { p0: [number, number]; p1: [number, number] } | null
  onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void
  onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void
  onRoomCommit: (cx: number, cy: number, name: string) => void
  onRoomCancel: () => void
}

const FloorPlanCanvas = forwardRef<SVGSVGElement, CanvasProps>(function FloorPlanCanvas(
  { model, floor, t, rooms, angles, ui, editName, imgNatural, calDraft,
    onPointerDown, onPointerMove, onPointerUp, onMouseDown, onRoomCommit, onRoomCancel }, ref,
) {
  const { px, py, scale } = t
  const { sel, snapGuides, showDims, editRoom } = ui
  const reference = floor.reference
  const vertices = Object.values(floor.vertices)
  const edges = Object.values(floor.edges)
  const gel: React.ReactNode[] = []

  // ── reference underlay (bottom layer) ──
  let underlay: React.ReactNode = null
  if (reference) {
    const s = reference.scale_m_per_px
    const [ox, oy] = reference.origin_px
    const wUser = imgNatural ? imgNatural.w * s * scale : 1
    const hUser = imgNatural ? imgNatural.h * s * scale : 1
    underlay = (
      <image
        href={`${BASE}/files/${reference.imageKey}`}
        x={px(-ox * s)} y={py(oy * s)} width={wUser} height={hUser}
        opacity={reference.opacity} preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      />
    )
  }

  // ── grid ──
  const xs = vertices.map(v => v.x), ys = vertices.map(v => v.y)
  const gx0 = Math.floor(Math.min(...xs, 0)) - 1, gx1 = Math.ceil(Math.max(...xs, 1)) + 1
  const gy0 = Math.floor(Math.min(...ys, 0)) - 1, gy1 = Math.ceil(Math.max(...ys, 1)) + 1
  for (let x = gx0; x <= gx1; x++)
    gel.push(<line key={`gx${x}`} x1={px(x)} y1={py(gy0)} x2={px(x)} y2={py(gy1)} stroke={colors.border} strokeWidth={0.5} />)
  for (let y = gy0; y <= gy1; y++)
    gel.push(<line key={`gy${y}`} x1={px(gx0)} y1={py(y)} x2={px(gx1)} y2={py(y)} stroke={colors.border} strokeWidth={0.5} />)

  // ── ghost of the floor below (structural reference only — floors are fully independent graphs) ──
  if (model.activeFloor > 0) {
    const gf = model.floors[model.activeFloor - 1]
    for (const e of Object.values(gf.edges)) {
      const p1 = gf.vertices[e.v1], p2 = gf.vertices[e.v2]
      gel.push(<line key={`ghost-${e.id}`} x1={px(p1.x)} y1={py(p1.y)} x2={px(p2.x)} y2={py(p2.y)}
        stroke={colors.border} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />)
    }
  }

  // ── walls (unified — thickness/style comes from the edge itself, exterior or interior) ──
  edges.forEach(e => {
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    const on = sel?.t === 'edge' && sel.id === e.id
    gel.push(<line key={`edge${e.id}`} x1={px(p1.x)} y1={py(p1.y)} x2={px(p2.x)} y2={py(p2.y)}
      stroke={on ? colors.primary : colors.neutral} strokeWidth={Math.max(3, e.thickness * scale)}
      data-el="edge" data-id={e.id} style={{ cursor: 'pointer' }} />)
  })

  // ── midpoint handles: click-and-drag inserts a corner / T-junction anchor on ANY edge ──
  edges.forEach(e => {
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
    gel.push(<circle key={`mid${e.id}`} cx={px(mx)} cy={py(my)} r={3.5}
      fill="none" stroke={colors.border} strokeWidth={1.2} data-el="edgeMid" data-id={e.id}
      style={{ cursor: 'crosshair' }} />)
  })

  // ── openings ──
  edges.forEach(e => {
    const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
    const L = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
    const ux = (p2.x - p1.x) / L, uy = (p2.y - p1.y) / L, nx = -uy, ny = ux
    e.openings.forEach((op, i) => {
      const atM = op.offset * L
      const cx = p1.x + ux * atM, cy = p1.y + uy * atM, hw = op.width / 2
      const ax = cx - ux * hw, ay = cy - uy * hw, bx = cx + ux * hw, by = cy + uy * hw
      const on = sel?.t === 'opening' && sel.edgeId === e.id && sel.index === i
      const thick = e.thickness * scale + 2
      gel.push(<line key={`opgap${e.id}-${i}`} x1={px(ax)} y1={py(ay)} x2={px(bx)} y2={py(by)}
        stroke={colors.dark} strokeWidth={thick} data-el="opening" data-edge={e.id} data-index={i} style={{ cursor: 'pointer' }} />)
      if (op.kind === 'door') {
        gel.push(<line key={`opleaf${e.id}-${i}`} x1={px(ax)} y1={py(ay)} x2={px(ax + nx * op.width)} y2={py(ay + ny * op.width)}
          stroke={colors.tertiary} strokeWidth={1.3} data-el="opening" data-edge={e.id} data-index={i} />)
        gel.push(<path key={`oparc${e.id}-${i}`} d={`M ${px(bx)} ${py(by)} A ${op.width * scale} ${op.width * scale} 0 0 0 ${px(ax + nx * op.width)} ${py(ay + ny * op.width)}`}
          fill="none" stroke={colors.tertiary} strokeWidth={0.8} opacity={0.7} />)
      } else {
        gel.push(<line key={`opmul${e.id}-${i}`} x1={px(cx - nx * 0.12)} y1={py(cy - ny * 0.12)} x2={px(cx + nx * 0.12)} y2={py(cy + ny * 0.12)}
          stroke={colors.accent2} strokeWidth={1.3} data-el="opening" data-edge={e.id} data-index={i} />)
      }
      if (on) gel.push(<circle key={`ophandle${e.id}-${i}`} cx={px(cx)} cy={py(cy)} r={6} fill="none" stroke={colors.primary} strokeWidth={1.5} />)
    })
  })

  // ── room labels: clickable name (rename) + live net area ──
  rooms.forEach((rg, i) => {
    const editing = editRoom != null && Math.abs(rg.cx - editRoom.cx) < 0.05 && Math.abs(rg.cy - editRoom.cy) < 0.05
    if (editing) {
      const w = 156, h = 24
      gel.push(
        <foreignObject key={`edit${i}`} x={px(rg.cx) - w / 2} y={py(rg.cy) - h + 2} width={w} height={h}>
          <input
            className="roomedit"
            defaultValue={editName}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box', textAlign: 'center',
              background: colors.surfaceAlt, border: `1px solid ${colors.primary}`, borderRadius: '2px',
              color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', outline: 'none', padding: '2px 4px',
            }}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); onRoomCommit(rg.cx, rg.cy, (e.target as HTMLInputElement).value) }
              else if (e.key === 'Escape') { e.preventDefault(); onRoomCancel() }
            }}
            onBlur={e => onRoomCommit(rg.cx, rg.cy, e.target.value)}
          />
        </foreignObject>,
      )
    } else {
      const nm = rg.name
      const hw = Math.max(64, nm.length * 7 + 16)
      gel.push(<rect key={`rhit${i}`} x={px(rg.cx) - hw / 2} y={py(rg.cy) - 15} width={hw} height={20}
        fill="transparent" pointerEvents="all" data-el="room" data-cx={rg.cx} data-cy={rg.cy} style={{ cursor: 'text' }} />)
      gel.push(<text key={`rname${i}`} x={px(rg.cx)} y={py(rg.cy) - 3} textAnchor="middle"
        fontFamily={fonts.sans} fontSize={12} fill={colors.neutral} data-el="room" data-cx={rg.cx} data-cy={rg.cy}
        style={{ cursor: 'text' }}>{nm}</text>)
    }
    gel.push(<text key={`rarea${i}`} x={px(rg.cx)} y={py(rg.cy) + 10} textAnchor="middle"
      fontFamily={fonts.serif} fontSize={11} fill={colors.secondary}>{f2(rg.area)} m²</text>)
  })

  // ── vertex handles (unified — every vertex, whether a corner, a T-junction, or a plain wall end) ──
  vertices.forEach(v => {
    const on = sel?.t === 'vertex' && sel.id === v.id
    gel.push(<circle key={`v${v.id}`} cx={px(v.x)} cy={py(v.y)} r={on ? 6 : 4.5}
      fill={colors.dark} stroke={colors.primary} strokeWidth={1.5} data-el="vertex" data-id={v.id} style={{ cursor: 'move' }} />)
  })

  // ── dimensions ──
  if (showDims) {
    const { widthMarks, heightMarks } = widthHeightChains(floor)
    const x0 = widthMarks[0], x1 = widthMarks[widthMarks.length - 1]
    const y0 = heightMarks[0], y1 = heightMarks[heightMarks.length - 1]
    const dim = (mx: number, my: number, txt: string) =>
      gel.push(<text key={`dim${mx}-${my}-${txt}`} x={mx} y={my} textAnchor="middle"
        fontFamily={fonts.serif} fontSize={11} fill={colors.secondary}>{txt}</text>)

    gel.push(<line key="dimw" x1={px(x0)} y1={py(y0) + 40} x2={px(x1)} y2={py(y0) + 40} stroke={colors.border} strokeWidth={0.6} />)
    for (let k = 0; k < widthMarks.length - 1; k++) {
      const a = widthMarks[k], b = widthMarks[k + 1]
      dim((px(a) + px(b)) / 2, py(y0) + 54, `${f2(b - a)} m`)
    }
    widthMarks.slice(1, -1).forEach(sx => gel.push(<line key={`dimwtick${sx}`} x1={px(sx)} y1={py(y0) + 36} x2={px(sx)} y2={py(y0) + 44} stroke={colors.border} strokeWidth={0.6} />))

    gel.push(<line key="dimh" x1={px(x1) + 40} y1={py(y0)} x2={px(x1) + 40} y2={py(y1)} stroke={colors.border} strokeWidth={0.6} />)
    for (let k = 0; k < heightMarks.length - 1; k++) {
      const a = heightMarks[k], b = heightMarks[k + 1]
      dim(px(x1) + 64, (py(a) + py(b)) / 2, `${f2(b - a)} m`)
    }
    heightMarks.slice(1, -1).forEach(sy => gel.push(<line key={`dimhtick${sy}`} x1={px(x1) + 36} y1={py(sy)} x2={px(x1) + 44} y2={py(sy)} stroke={colors.border} strokeWidth={0.6} />))

    // per-edge length labels
    edges.forEach(e => {
      const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, L = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      dim(px(mx) + 11, py(my), f2(L))
    })
    // opening widths
    edges.forEach(e => {
      const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
      const L = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
      const ux = (p2.x - p1.x) / L, uy = (p2.y - p1.y) / L, nx = -uy, ny = ux
      e.openings.forEach((op, i) => {
        const atM = op.offset * L, cx = p1.x + ux * atM, cy = p1.y + uy * atM
        gel.push(<text key={`opw${e.id}-${i}`} x={px(cx + nx * 0.34)} y={py(cy + ny * 0.34) + 3} textAnchor="middle"
          fontFamily={fonts.serif} fontSize={10} fill={op.kind === 'door' ? colors.tertiary : colors.accent2}>{f2(op.width)}</text>)
      })
    })
    // corner angles: degree label only (decorative sweep arc deliberately deferred — see note below)
    angles.forEach((ca, i) => {
      gel.push(<text key={`ang${i}`} x={px(ca.x) + 14} y={py(ca.y) - 14} textAnchor="middle" fontFamily={fonts.serif} fontSize={10}
        fill={ca.isRight ? colors.secondary : colors.tertiary}>{Math.round(ca.deg)}°</text>)
    })
  }

  // ── snap guides (while dragging) ──
  snapGuides.forEach((gd, i) => {
    if (gd.t === 'vx' && gd.x != null)
      gel.push(<line key={`sg${i}`} x1={px(gd.x)} y1={py(gy0)} x2={px(gd.x)} y2={py(gy1)} stroke={colors.primary} strokeWidth={0.8} strokeDasharray="3 3" />)
    else if (gd.t === 'hy' && gd.y != null)
      gel.push(<line key={`sg${i}`} x1={px(gx0)} y1={py(gd.y)} x2={px(gx1)} y2={py(gd.y)} stroke={colors.primary} strokeWidth={0.8} strokeDasharray="3 3" />)
    else if (gd.t === 'pt' && gd.x != null && gd.y != null)
      gel.push(<circle key={`sg${i}`} cx={px(gd.x)} cy={py(gd.y)} r={7} fill="none" stroke={colors.primary} strokeWidth={1.5} />)
  })

  return (
    <svg
      ref={ref}
      viewBox={t.viewBox}
      style={{ width: '100%', height: '100%', background: colors.dark, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseDown={onMouseDown}
    >
      {underlay}
      {gel}
      {calDraft && (
        <line x1={px(calDraft.p0[0])} y1={py(calDraft.p0[1])} x2={px(calDraft.p1[0])} y2={py(calDraft.p1[1])}
          stroke={colors.tertiary} strokeWidth={2} strokeDasharray="5 3" style={{ pointerEvents: 'none' }} />
      )}
    </svg>
  )
})

export default FloorPlanCanvas
