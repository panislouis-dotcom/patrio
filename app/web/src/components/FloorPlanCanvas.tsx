// app/web/src/components/FloorPlanCanvas.tsx
import { forwardRef, useRef } from 'react'
import type React from 'react'
import { colors, fonts } from '../lib/theme'
import { isGhost, FIXTURE_CATALOG, type FloorSet, type FloorGraph, type FixtureKind } from '../lib/floorplan/types'
import type { ViewTransform } from '../lib/floorplan/viewTransform'
import type { RoomLabel } from '../lib/floorplan/rooms'
import type { CornerAngle } from '../lib/floorplan/dimensions'
import { widthHeightChains, cotaEdges, f2 } from '../lib/floorplan/dimensions'
import type { UI } from '../lib/floorplan/reducer'
import { BASE } from '../lib/api'
import { edgeAxis } from '../lib/floorplan/geometry'

// Punteado de una división (ghost). Local al canvas a propósito: los demás renderers
// (PNG de renders, SVG del prospecto, export BIM) EXCLUYEN las fantasmas, no las puntean.
const GHOST_DASH = '6 4'

// Familia visual mínima por tipo: UN acento sobrio (línea o círculo), nunca un ícono
// detallado — esto es un plano técnico, no un moodboard. El catálogo (types.ts) es dato de
// dimensiones; esta tabla es puramente de dibujo y vive aquí, no ahí.
type FixtureFamily = 'bed' | 'seat' | 'plain' | 'toilet' | 'sink' | 'shower' | 'tub' | 'laundry' | 'stove' | 'fridge'
const FIXTURE_FAMILY: Record<FixtureKind, FixtureFamily> = {
  cama_individual: 'bed', cama_matrimonial: 'bed', cama_queen: 'bed', cama_king: 'bed',
  silla: 'seat', sillon: 'seat',
  mesa: 'plain', escritorio: 'plain',
  inodoro: 'toilet', lavabo: 'sink', regadera: 'shower', tina: 'tub',
  lavadora: 'laundry', estufa: 'stove', refrigerador: 'fridge',
}

/** Acentos internos del glyph, en coordenadas LOCALES ya en px (origen = centro del mueble,
 * ANTES de rotar): viven como hijos del mismo <g rotate(...)> que el rect base, así que
 * heredan su rotación sin matemática propia. pointerEvents 'none' en todos: el único blanco
 * de hit-testing es el rect base (data-el="fixture"), para que un clic en cualquier punto
 * del glyph siempre resuelva al mismo elemento seleccionable/arrastrable. */
function fixtureAccents(family: FixtureFamily, wPx: number, hPx: number, key: string): React.ReactNode[] {
  const common = { stroke: colors.secondary, fill: 'none' as const, strokeWidth: 1, style: { pointerEvents: 'none' as const } }
  const minWH = Math.min(wPx, hPx)
  switch (family) {
    case 'bed': {
      // Almohada: un rect angosto pegado al borde "de la cabecera".
      const pw = wPx * 0.7, ph = hPx * 0.22
      const py0 = -hPx / 2 + hPx * 0.08
      return [<rect key={`${key}-pillow`} x={-pw / 2} y={py0} width={pw} height={ph} rx={2} {...common} />]
    }
    case 'seat': {
      // Respaldo: una línea cerca del borde superior.
      const y = -hPx / 2 + hPx * 0.2
      return [<line key={`${key}-back`} x1={-wPx * 0.4} y1={y} x2={wPx * 0.4} y2={y} {...common} />]
    }
    case 'toilet':
      return [<circle key={`${key}-bowl`} cx={0} cy={hPx * 0.12} r={minWH * 0.28} {...common} />]
    case 'sink':
      return [<circle key={`${key}-basin`} cx={0} cy={0} r={minWH * 0.28} {...common} />]
    case 'shower':
      return [<circle key={`${key}-drain`} cx={0} cy={0} r={Math.max(2, minWH * 0.08)} {...common} />]
    case 'tub': {
      const y = -hPx / 2 + hPx * 0.1
      return [<line key={`${key}-faucet`} x1={-wPx * 0.3} y1={y} x2={wPx * 0.3} y2={y} {...common} />]
    }
    case 'laundry':
      return [<circle key={`${key}-drum`} cx={0} cy={0} r={minWH * 0.3} {...common} />]
    case 'stove':
      return [
        <circle key={`${key}-b1`} cx={-wPx * 0.2} cy={-hPx * 0.15} r={minWH * 0.1} {...common} />,
        <circle key={`${key}-b2`} cx={wPx * 0.2} cy={-hPx * 0.15} r={minWH * 0.1} {...common} />,
      ]
    case 'fridge':
      return [<line key={`${key}-split`} x1={0} y1={-hPx * 0.35} x2={0} y2={hPx * 0.35} {...common} />]
    case 'plain':
    default:
      return []
  }
}

export interface CanvasProps {
  model: FloorSet
  floor: FloorGraph
  t: ViewTransform
  rooms: RoomLabel[]
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
  // Guards against the browser firing a native blur on the room-rename <input> when it
  // unmounts right after Enter/Escape (React's onBlur delegation still sees it), which
  // would otherwise re-commit/wrongly-commit the value a keyboard handler already resolved.
  const roomEditHandledRef = useRef(false)

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
    // Una división (ghost) se dibuja punteada y tenue — no es muro — pero con el MISMO
    // data-el="edge": seleccionar, arrastrar y borrar la tratan como cualquier arista.
    // Ya es delgada por sí sola: strokeWidth ∝ thickness y la suya es la nominal chica.
    const ghost = isGhost(e)
    gel.push(<line key={`edge${e.id}`} x1={px(p1.x)} y1={py(p1.y)} x2={px(p2.x)} y2={py(p2.y)}
      stroke={on ? colors.primary : ghost ? colors.secondary : colors.neutral}
      strokeDasharray={ghost ? GHOST_DASH : undefined}
      strokeWidth={Math.max(3, e.thickness * scale)}
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
    const { L, ux, uy, nx, ny } = edgeAxis(p1, p2)
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

  // ── fixtures (mobiliario): rect rotado a escala + glyph sobrio + label con el nombre ──
  // fx.rot es CCW en coordenadas de MUNDO (y-arriba). El mapeo mundo→pantalla invierte el
  // eje Y (py decrece cuando y crece), así que una rotación CCW de mundo se VE en pantalla
  // como una rotación CW — y SVG rotate() con ángulo positivo YA es CW en pantalla. Sin
  // invertir el signo, un mueble rotado 90° quedaría mostrando la rotación contraria.
  // El label se dibuja siempre, sin gating por zoom: igual que los labels de cuarto más
  // abajo, que también se muestran incondicionalmente — no hay ningún otro lugar en este
  // canvas que oculte texto según la escala, así que inventar un umbral aquí sería una
  // regla de UX no verificada.
  const fixtures = floor.fixtures ?? []
  fixtures.forEach(fx => {
    const meta = FIXTURE_CATALOG[fx.kind]
    const on = sel?.t === 'fixture' && sel.id === fx.id
    const wPx = fx.w_m * scale, hPx = fx.h_m * scale
    const cx = px(fx.x), cy = py(fx.y)
    gel.push(
      <g key={`fx${fx.id}`} transform={`translate(${cx} ${cy}) rotate(${-fx.rot})`}>
        <rect x={-wPx / 2} y={-hPx / 2} width={wPx} height={hPx}
          fill={colors.surfaceAlt} stroke={on ? colors.primary : colors.secondary} strokeWidth={on ? 2 : 1.2}
          data-el="fixture" data-id={fx.id} style={{ cursor: 'move' }} />
        {fixtureAccents(FIXTURE_FAMILY[fx.kind], wPx, hPx, fx.id)}
      </g>,
    )
    gel.push(<text key={`fxlabel${fx.id}`} x={cx} y={cy + 3} textAnchor="middle"
      fontFamily={fonts.sans} fontSize={9} fill={colors.secondary} style={{ pointerEvents: 'none' }}>{meta.label}</text>)
  })

  // ── room labels: clickable name (rename) + live net area ──
  // The rename input, shared by an existing label being renamed and a brand-new label
  // being placed on an open spot (no traced face, no stored room there yet).
  const roomInput = (cx: number, cy: number, key: string) => {
    const w = 156, h = 24
    return (
      <foreignObject key={key} x={px(cx) - w / 2} y={py(cy) - h + 2} width={w} height={h}>
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
            if (e.key === 'Enter') { e.preventDefault(); roomEditHandledRef.current = true; onRoomCommit(cx, cy, (e.target as HTMLInputElement).value) }
            else if (e.key === 'Escape') { e.preventDefault(); roomEditHandledRef.current = true; onRoomCancel() }
          }}
          onBlur={e => {
            if (roomEditHandledRef.current) { roomEditHandledRef.current = false; return }
            onRoomCommit(cx, cy, e.target.value)
          }}
        />
      </foreignObject>
    )
  }

  let editingExisting = false
  rooms.forEach((rg, i) => {
    const editing = editRoom != null && Math.abs(rg.cx - editRoom.cx) < 0.05 && Math.abs(rg.cy - editRoom.cy) < 0.05
    if (editing) {
      editingExisting = true
      gel.push(roomInput(rg.cx, rg.cy, `edit${i}`))
    } else {
      const nm = rg.name
      const hw = Math.max(64, nm.length * 7 + 16)
      gel.push(<rect key={`rhit${i}`} x={px(rg.cx) - hw / 2} y={py(rg.cy) - 15} width={hw} height={20}
        fill="transparent" pointerEvents="all" data-el="room" data-cx={rg.cx} data-cy={rg.cy} style={{ cursor: 'text' }} />)
      gel.push(<text key={`rname${i}`} x={px(rg.cx)} y={py(rg.cy) - 3} textAnchor="middle"
        fontFamily={fonts.sans} fontSize={12} fill={colors.neutral} data-el="room" data-cx={rg.cx} data-cy={rg.cy}
        style={{ cursor: 'text' }}>{nm}</text>)
    }
    // Open spaces carry a name only — no enclosed face, so no net area to show.
    if (rg.area != null) {
      gel.push(<text key={`rarea${i}`} x={px(rg.cx)} y={py(rg.cy) + 10} textAnchor="middle"
        fontFamily={fonts.serif} fontSize={11} fill={colors.secondary}>{f2(rg.area)} m²</text>)
    }
  })
  // A new label being placed on an open spot: no existing label matched editRoom.
  if (editRoom != null && !editingExisting) gel.push(roomInput(editRoom.cx, editRoom.cy, 'edit-new'))

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

    // per-edge length labels — una fantasma no es muro, no lleva su propia cota (dimensions.ts)
    cotaEdges(floor).forEach(e => {
      const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, L = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      dim(px(mx) + 11, py(my), f2(L))
    })
    // opening widths
    edges.forEach(e => {
      const p1 = floor.vertices[e.v1], p2 = floor.vertices[e.v2]
      const { L, ux, uy, nx, ny } = edgeAxis(p1, p2)
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
