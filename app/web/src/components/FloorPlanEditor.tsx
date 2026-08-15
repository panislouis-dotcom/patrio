// app/web/src/components/FloorPlanEditor.tsx
import { useReducer, useMemo, useRef, useState, useEffect } from 'react'
import type React from 'react'
import { colors, fonts } from '../lib/theme'
import {
  reducer, initialState, removeEdgeFromFloor, removeOpeningFromFloor, removeVertexFromFloor,
  removeFixtureFromFloor, removeManualDimFromFloor, type Tool,
} from '../lib/floorplan/reducer'
import {
  emptyFloorSet, clone, genId, isGhost, GHOST_THICKNESS_M, FIXTURE_CATALOG,
  type FloorSet, type FloorGraph, type FixtureKind, type RoomType,
} from '../lib/floorplan/types'
import { viewTransform, type Camera } from '../lib/floorplan/viewTransform'
import { roomAreas, roomLabels, roomPolygons } from '../lib/floorplan/rooms'
import { cornerAngles } from '../lib/floorplan/dimensions'
import { projectAt, pointAt } from '../lib/floorplan/geometry'
import {
  addVertex as graphAddVertex, addEdge as graphAddEdge, nearestVertex, nearestEdgePoint,
  mergeVertexInto, splitEdgeAtVertex, gridSnap, SNAP,
} from '../lib/floorplan/graph'
import { snapPoint } from '../lib/floorplan/snapping'
import { calibrationFromLine, modelToPx } from '../lib/floorplan/calibrate'
import { toGeometryJson } from '../lib/floorplan/export'
import { BASE } from '../lib/api'
import FloorPlanCanvas from './FloorPlanCanvas'
import FloorPlanPanel from './FloorPlanPanel'
import { EmptyState, ReferenceControls } from './FloorPlanReference'
import { btn, btnDisabled } from './floorplanStyles'

const W = 900, H = 560, MARGIN = 48
const TOOLS: Tool[] = ['select', 'wall', 'ghost', 'door', 'window', 'room', 'dim', 'delete']
// The toolbar shows tool ids verbatim; only these need a friendlier Spanish label.
const TOOL_LABELS: Partial<Record<Tool, string>> = { ghost: 'división', room: 'nombrar', dim: 'medida' }
const MIN_CAL_PX = 1e-6
const ZOOM_STEP = 1.25
const WHEEL_ZOOM_STEP = 1.08
const PAN_DRAG_THRESHOLD = 4 // SVG user-space px before a background press counts as a pan, not a click

type WorldPt = { x: number; y: number }

/** Nearest edge to a point, WITHOUT the T-junction endpoint-guard — used only for
 * placing a door/window opening on whatever wall the user clicks near, matching the old
 * model's click-anywhere-near-a-wall placement affordance. */
function nearestEdgeIgnoringEndpointGuard(f: FloorGraph, pt: WorldPt): string | null {
  let best: string | null = null, bd = 0.6
  for (const e of Object.values(f.edges)) {
    // Esta búsqueda solo sirve para colocar vanos y una división jamás los acepta: si no
    // se salta, una fantasma cercana "gana" y el clic muere en el no-op de ADD_OPENING.
    if (isGhost(e)) continue
    const p1 = f.vertices[e.v1], p2 = f.vertices[e.v2]
    const atM = projectAt([p1.x, p1.y], [p2.x, p2.y], pt)
    const [px, py] = pointAt([p1.x, p1.y], [p2.x, p2.y], atM)
    const d = Math.hypot(pt.x - px, pt.y - py)
    if (d < bd) { bd = d; best = e.id }
  }
  return best
}

/** Imperative handle the host page uses to persist a dirty plan via its own GUARDAR. */
export interface PlanApi {
  isDirty(): boolean
  getModel(): FloorSet
  markSaved(): void
}

interface Props {
  // El editor trabaja sobre UNA variante ya migrada (el host resuelve el envelope v3);
  // null = sin plano dibujado, y arranca en la pantalla de inicio (subir imagen / en blanco).
  initial: FloorSet | null
  onSave: (fs: FloorSet) => void | Promise<void>
  onUploadImage: (file: File) => Promise<{ imageKey: string }>
  onReady?: (api: PlanApi) => void
  onDirtyChange?: (dirty: boolean) => void
}

export default function FloorPlanEditor({ initial, onSave, onUploadImage, onReady, onDirtyChange }: Props) {
  // La precondición vive AQUÍ, no en los hosts: su contrato es solo null-o-no. Un
  // FloorSet sin pisos es posible en un blob v3 legítimo y `floors[activeFloor]`
  // no existiría — se trata igual que null: pantalla de inicio y arranque en blanco.
  const hasFloors = initial != null && initial.floors.length > 0
  const [entered, setEntered] = useState(hasFloors)
  const [uploading, setUploading] = useState(false)
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null)
  const [calDraft, setCalDraft] = useState<{ p0: [number, number]; p1: [number, number] } | null>(null)
  const [calLen, setCalLen] = useState<number | undefined>(undefined)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const calDragRef = useRef(false)
  // Herramienta "medida" (dim): mismo patrón que calDraft/calDragRef arriba — un trazo
  // LOCAL del componente mientras dura el gesto de clic-arrastra-suelta, que se vuelve una
  // ManualDimension real (ADD_MANUAL_DIM) solo al soltar. No vive en el reducer mientras
  // está a medias: un draft a medio arrastrar no es un dato del modelo todavía.
  const [dimDraft, setDimDraft] = useState<{ p0: [number, number]; p1: [number, number] } | null>(null)
  const dimDragRef = useRef(false)
  // One history-creating SET_MODEL per drag gesture; every subsequent pointermove frame in
  // the same gesture uses DRAG_MODEL (no push). Reset once at the top of onPointerDown.
  const dragMovedRef = useRef(false)
  const panRef = useRef<{ startUx: number; startUy: number; camera: Camera } | null>(null)
  const panMovedRef = useRef(false)
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    initialState(initial != null && initial.floors.length > 0 ? initial : emptyFloorSet()))
  const svgRef = useRef<SVGSVGElement>(null)
  const { model, ui } = state
  const floor = model.floors[model.activeFloor]

  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    onReady?.({
      isDirty: () => stateRef.current.dirty,
      getModel: () => stateRef.current.model,
      markSaved: () => dispatch({ type: 'MARK_SAVED' }),
    })
  }, [onReady])
  useEffect(() => { onDirtyChange?.(state.dirty) }, [state.dirty, onDirtyChange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z') {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' })
        return
      }
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      const st = stateRef.current
      if (st.ui.calibrating || !st.ui.sel) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      dispatch({ type: 'DELETE_SEL' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const doSave = async () => { await onSave(model); dispatch({ type: 'MARK_SAVED' }) }

  const refImageKey = floor.reference?.imageKey
  useEffect(() => {
    if (!refImageKey) { setImgNatural(null); return }
    const im = new window.Image()
    im.onload = () => setImgNatural({ w: im.naturalWidth, h: im.naturalHeight })
    im.src = `${BASE}/files/${refImageKey}`
  }, [refImageKey])

  async function onUpload(file: File) {
    setUploading(true)
    try {
      const { imageKey } = await onUploadImage(file)
      const m = emptyFloorSet()
      m.floors[0].reference = { imageKey, scale_m_per_px: 0.01, origin_px: [0, 0], opacity: 0.5 }
      dispatch({ type: 'SET_MODEL', model: m })
      dispatch({ type: 'SET_CALIBRATING', on: true })
      setEntered(true)
    } finally { setUploading(false) }
  }

  function applyCalibration() {
    const ref = floor.reference
    if (!calDraft || !ref || !(calLen && calLen > 0)) return
    const p0px = modelToPx(calDraft.p0, ref)
    const p1px = modelToPx(calDraft.p1, ref)
    const pixelDist = Math.hypot(p1px[0] - p0px[0], p1px[1] - p0px[1])
    if (!(pixelDist > MIN_CAL_PX)) return
    const { scale_m_per_px } = calibrationFromLine(p0px, p1px, calLen, ref.origin_px)
    dispatch({ type: 'SET_REFERENCE_FIELD', key: 'scale_m_per_px', value: scale_m_per_px })
    dispatch({ type: 'SET_CALIBRATING', on: false })
    setCalDraft(null); setCalLen(undefined)
  }

  const canApplyCalibration = (() => {
    const ref = floor.reference
    if (!calDraft || !ref) return false
    const p0px = modelToPx(calDraft.p0, ref)
    const p1px = modelToPx(calDraft.p1, ref)
    return Math.hypot(p1px[0] - p0px[0], p1px[1] - p0px[1]) > MIN_CAL_PX
  })()

  const t = useMemo(
    () => viewTransform(model.floors, { width: W, height: H, margin: MARGIN }, ui.camera),
    [model.floors, ui.camera],
  )
  /** The camera to zoom FROM: the live camera if the user has already taken manual control,
   * or a value seeded from the current auto-fit view otherwise -- the reducer has no access
   * to the live viewTransform calculation, only this component does. */
  function seedCamera(): Camera {
    const c = t.userToWorld(W / 2, H / 2)
    return { scale: t.scale, centerX: c.x, centerY: c.y }
  }
  function onZoomButton(dir: 1 | -1) {
    const seed = seedCamera()
    dispatch({ type: 'ZOOM_AT', anchor: { x: seed.centerX, y: seed.centerY }, factor: dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, seed })
  }
  /** Colocar un mueble desde la paleta: aparece al centro del viewport actual (mismo cálculo
   * que seedCamera() usa para ZOOM_AT, no el centro del modelo) y cambia a select para que el
   * usuario pueda arrastrarlo de inmediato. SET_TOOL primero (limpia sel), ADD_FIXTURE
   * después — el reducer selecciona el mueble recién creado, igual que ADD_OPENING con vanos. */
  function onFixturePick(kind: FixtureKind) {
    const seed = seedCamera()
    dispatch({ type: 'SET_TOOL', tool: 'select' })
    dispatch({ type: 'ADD_FIXTURE', kind, x: seed.centerX, y: seed.centerY })
    setPaletteOpen(false)
  }
  const rooms = useMemo(() => roomAreas(floor), [floor])
  // Every drawn label = enclosed rooms (with area) + free named points on open spaces.
  const labels = useMemo(() => roomLabels(floor), [floor])
  // Polígonos de los cuartos CERRADOS, en el MISMO orden que roomLabels antepone los suyos
  // (rooms.ts::roomLabels = [...enclosed, ...free] — invariante ya documentado y ya usado
  // así en planFacts.ts): FloorPlanCanvas empareja por posición, labels[i] <-> polygons[i]
  // para i < polygons.length, para saber si un nombre cabe en su cuarto real.
  const polygons = useMemo(() => roomPolygons(floor), [floor])
  const angles = useMemo(() => cornerAngles(floor), [floor])
  const geoJson = useMemo(() => JSON.stringify(toGeometryJson(model), null, 1), [model])
  const editingRoom = ui.editRoom
    ? labels.find(r => Math.abs(r.cx - ui.editRoom!.cx) < 0.05 && Math.abs(r.cy - ui.editRoom!.cy) < 0.05)
    : undefined
  const editName = editingRoom?.name ?? ''
  const editType = editingRoom?.type

  function onToolClick(tool: Tool) {
    // 'wall' y 'ghost' no son modos: el clic inserta de inmediato la misma plantilla
    // vertical y vuelve a select para ajustarla. Este es el ÚNICO call site que aparea
    // kind 'ghost' con GHOST_THICKNESS_M — el pairing es disciplina del caller de addEdge.
    if (tool === 'wall' || tool === 'ghost') {
      const xs = Object.values(floor.vertices).map(v => v.x), ys = Object.values(floor.vertices).map(v => v.y)
      const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 3
      const y0 = ys.length ? Math.min(...ys) : 0, y1 = ys.length ? Math.max(...ys) : 4
      const m = clone(model); const f = m.floors[m.activeFloor]
      const v1 = graphAddVertex(f, cx, y0 + 0.5), v2 = graphAddVertex(f, cx, y1 - 0.5)
      const newEdgeId = tool === 'ghost'
        ? graphAddEdge(f, v1, v2, GHOST_THICKNESS_M, 'ghost')
        : graphAddEdge(f, v1, v2, f.intWall_m)
      dispatch({ type: 'SET_MODEL', model: m })
      dispatch({ type: 'SET_TOOL', tool: 'select' })
      dispatch({ type: 'SET_SEL', sel: { t: 'edge', id: newEdgeId } })
    } else {
      dispatch({ type: 'SET_TOOL', tool })
    }
  }

  /** Screen client coords -> SVG user-space (viewBox) coords, independent of the camera --
   * the pre-userToWorld half of pointerToWorld, split out so pan-drag can diff two
   * user-space points using the FIXED start-of-gesture camera instead of the live one
   * (which is being updated every frame of the pan itself). */
  const pointerToUser = (e: { clientX: number; clientY: number }): { ux: number; uy: number } => {
    const svg = svgRef.current
    if (!svg) return { ux: 0, uy: 0 }
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null
    if (ctm) {
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY
      const u = p.matrixTransform(ctm.inverse())
      return { ux: u.x, uy: u.y }
    }
    const rect = svg.getBoundingClientRect()
    const sx = rect.width ? (e.clientX - rect.left) * (W / rect.width) : e.clientX - rect.left
    const sy = rect.height ? (e.clientY - rect.top) * (H / rect.height) : e.clientY - rect.top
    return { ux: sx, uy: sy }
  }

  const pointerToWorld = (e: { clientX: number; clientY: number }): WorldPt => {
    const { ux, uy } = pointerToUser(e)
    return t.userToWorld(ux, uy)
  }

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const anchor = pointerToWorld(e)
      const seed = seedCamera()
      const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP
      dispatch({ type: 'ZOOM_AT', anchor, factor, seed })
    }
    svg.addEventListener('wheel', onWheelNative, { passive: false })
    return () => svg.removeEventListener('wheel', onWheelNative)
  }, [t])

  const attr = (el: Element, k: string) => el.getAttribute(k)

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (attr(e.target as Element, 'data-el') === 'room') e.preventDefault()
  }

  const capturePointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (svg?.setPointerCapture) { try { svg.setPointerCapture(e.pointerId) } catch { /* jsdom */ } }
  }

  // "Nombrar": click anywhere to name that spot — an existing label to rename it, or
  // empty space (enclosed or not) to drop a new one. This is what frees naming from
  // requiring a closed room.
  const handleRoomTool = (e: React.PointerEvent<SVGSVGElement>, target: Element, elk: string | null, pt: WorldPt) => {
    e.preventDefault()
    const at = elk === 'room'
      ? { cx: +attr(target, 'data-cx')!, cy: +attr(target, 'data-cy')! }
      : { cx: pt.x, cy: pt.y }
    dispatch({ type: 'SET_EDIT_ROOM', editRoom: at })
  }

  const handleOpeningTool = (kind: 'door' | 'window', target: Element, elk: string | null, pt: WorldPt) => {
    const edgeId = elk === 'edge' ? attr(target, 'data-id')! : nearestEdgeIgnoringEndpointGuard(floor, pt)
    if (!edgeId) return
    const edge = floor.edges[edgeId]
    const p1 = floor.vertices[edge.v1], p2 = floor.vertices[edge.v2]
    const L = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
    const atM = gridSnap(projectAt([p1.x, p1.y], [p2.x, p2.y], pt))
    // SET_TOOL primero (limpia sel), ADD_OPENING después: la acción del engine es quien
    // agrega, selecciona el vano nuevo y empuja UNA entrada de historia — y quien rechaza
    // fantasmas, para que la guarda viva en el reducer y no en esta UI.
    dispatch({ type: 'SET_TOOL', tool: 'select' })
    dispatch({ type: 'ADD_OPENING', edgeId, opening: { kind, offset: atM / L, width: 0.9 } })
  }

  const handleDeleteTool = (target: Element, elk: string | null) => {
    if (elk === 'opening') delOpen(attr(target, 'data-edge')!, +attr(target, 'data-index')!)
    else if (elk === 'edge') delEdge(attr(target, 'data-id')!)
    else if (elk === 'vertex') delVertex(attr(target, 'data-id')!)
    else if (elk === 'fixture') delFixture(attr(target, 'data-id')!)
    else if (elk === 'manualDim') delManualDim(attr(target, 'data-id')!)
    else if (elk === 'room') dispatch({ type: 'DELETE_ROOM', cx: +attr(target, 'data-cx')!, cy: +attr(target, 'data-cy')! })
  }

  // Select es también el fall-through de cualquier herramienta sin rama propia: arranca
  // selección/arrastre sobre un elemento, o un paneo sobre el fondo.
  const handleSelectTool = (e: React.PointerEvent<SVGSVGElement>, target: Element, elk: string | null, pt: WorldPt) => {
    // El guard `ui.tool === 'select'` NO es código muerto: esta función es el fall-through
    // de herramientas sin rama propia, y el split de midpoint es exclusivo de select.
    if (ui.tool === 'select' && elk === 'edgeMid') {
      const edgeId = attr(target, 'data-id')!
      const edge = floor.edges[edgeId]
      const p1 = floor.vertices[edge.v1], p2 = floor.vertices[edge.v2]
      const atM = gridSnap(projectAt([p1.x, p1.y], [p2.x, p2.y], pt))
      const [sx, sy] = pointAt([p1.x, p1.y], [p2.x, p2.y], atM)
      const m = clone(model); const f = m.floors[m.activeFloor]
      const newVertexId = genId()
      f.vertices[newVertexId] = { id: newVertexId, x: sx, y: sy }
      splitEdgeAtVertex(f, edgeId, newVertexId)
      // Do NOT force dragMovedRef here: the split itself already commits via its own
      // SET_MODEL below. dragMovedRef must stay false unless a real onPointerMove frame
      // follows — otherwise a click-and-release-without-dragging on this handle would make
      // onPointerUp unconditionally commit a second, no-op SET_MODEL (the model unchanged
      // since the split), producing a duplicate history entry that makes the first Ctrl+Z
      // a visible no-op.
      dispatch({ type: 'SET_MODEL', model: m })
      dispatch({ type: 'SET_SEL', sel: { t: 'vertex', id: newVertexId } })
      dispatch({ type: 'SET_DRAG', drag: { kind: 'vertex', id: newVertexId } })
      capturePointer(e)
      return
    }

    if (elk === 'vertex') {
      const id = attr(target, 'data-id')!
      dispatch({ type: 'SET_SEL', sel: { t: 'vertex', id } })
      dispatch({ type: 'SET_DRAG', drag: { kind: 'vertex', id } })
    } else if (elk === 'edge') {
      const id = attr(target, 'data-id')!
      const edge = floor.edges[id]
      dispatch({ type: 'SET_SEL', sel: { t: 'edge', id } })
      dispatch({
        type: 'SET_DRAG',
        drag: {
          kind: 'edgeBody', id,
          startV1: { x: floor.vertices[edge.v1].x, y: floor.vertices[edge.v1].y },
          startV2: { x: floor.vertices[edge.v2].x, y: floor.vertices[edge.v2].y },
          startPt: { x: pt.x, y: pt.y },
        },
      })
    } else if (elk === 'opening') {
      const edgeId = attr(target, 'data-edge')!, index = +attr(target, 'data-index')!
      dispatch({ type: 'SET_SEL', sel: { t: 'opening', edgeId, index } })
      dispatch({ type: 'SET_DRAG', drag: { kind: 'opening', id: edgeId, openingIndex: index } })
    } else if (elk === 'fixture') {
      const id = attr(target, 'data-id')!
      const fx = floor.fixtures!.find(x => x.id === id)!
      dispatch({ type: 'SET_SEL', sel: { t: 'fixture', id } })
      dispatch({
        type: 'SET_DRAG',
        drag: { kind: 'fixture', id, startV1: { x: fx.x, y: fx.y }, startPt: { x: pt.x, y: pt.y } },
      })
    } else if (elk === 'manualDimEndpoint') {
      // Manija de un extremo (visible solo cuando la cota ya está seleccionada, ver
      // FloorPlanCanvas.tsx): arrastra ESE punto solo, igual que un vértice — a diferencia
      // de 'manualDim' abajo, que traslada la cota entera. Esto SÍ cambia el largo: es el
      // "resize con drag" que 'manualDim' (traslación pura) no ofrece.
      const id = attr(target, 'data-id')!
      const which = attr(target, 'data-which') as 'p1' | 'p2'
      dispatch({ type: 'SET_SEL', sel: { t: 'manualDim', id } })
      dispatch({ type: 'SET_DRAG', drag: { kind: 'manualDimEndpoint', id, which } })
    } else if (elk === 'manualDim') {
      // Mismo patrón que 'edge': selecciona y arranca un arrastre que traslada TODA la
      // cota (los dos puntos por el mismo delta) — para cambiar el LARGO, arrastra una
      // manija de extremo ('manualDimEndpoint' arriba) o edita las coordenadas en el panel.
      const id = attr(target, 'data-id')!
      const dim = (floor.manualDimensions ?? []).find(d => d.id === id)!
      dispatch({ type: 'SET_SEL', sel: { t: 'manualDim', id } })
      dispatch({
        type: 'SET_DRAG',
        drag: {
          kind: 'manualDim', id,
          startV1: { x: dim.p1.x, y: dim.p1.y },
          startV2: { x: dim.p2.x, y: dim.p2.y },
          startPt: { x: pt.x, y: pt.y },
        },
      })
    } else {
      const { ux, uy } = pointerToUser(e)
      panRef.current = { startUx: ux, startUy: uy, camera: seedCamera() }
      panMovedRef.current = false
    }
    capturePointer(e)
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const target = e.target as Element
    if (target.tagName === 'INPUT') return
    const elk = attr(target, 'data-el')
    const pt = pointerToWorld(e)
    dragMovedRef.current = false

    // La calibración es un MODO, no una herramienta: mientras está activa secuestra el
    // puntero completo, así que se resuelve antes de despachar por herramienta.
    if (ui.calibrating) {
      setCalDraft({ p0: [pt.x, pt.y], p1: [pt.x, pt.y] })
      calDragRef.current = true
      capturePointer(e)
      return
    }

    // Despacho por herramienta: cada rama resuelve el gesto completo y termina (return).
    // Una herramienta nueva agrega aquí su condición y arriba su handler. El orden importa:
    // clic sobre una etiqueta de cuarto con select renombra (misma acción que "nombrar")
    // antes de que cualquier otra rama pueda reclamar el evento.
    if (ui.tool === 'room') { handleRoomTool(e, target, elk, pt); return }
    if (elk === 'room' && ui.tool === 'select') { handleRoomTool(e, target, elk, pt); return }
    if (ui.tool === 'door' || ui.tool === 'window') { handleOpeningTool(ui.tool, target, elk, pt); return }
    if (ui.tool === 'delete') { handleDeleteTool(target, elk); return }
    if (ui.tool === 'dim') {
      // Mismo patrón que la calibración arriba: un trazo local de dos puntos por
      // clic-arrastra-suelta, con snapping a vértices/grilla (mismo snapPoint que ya usa
      // el arrastre de vértice) para poder anclar la medida a una esquina real.
      const s = snapPoint(floor, pt.x, pt.y, new Set())
      setDimDraft({ p0: [s.x, s.y], p1: [s.x, s.y] })
      dimDragRef.current = true
      capturePointer(e)
      return
    }
    handleSelectTool(e, target, elk, pt)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (ui.calibrating) {
      if (!calDragRef.current) return
      const p = pointerToWorld(e)
      setCalDraft(d => d ? { p0: d.p0, p1: [p.x, p.y] } : d)
      return
    }
    if (dimDragRef.current) {
      const p = pointerToWorld(e)
      const s = snapPoint(floor, p.x, p.y, new Set())
      setDimDraft(d => d ? { p0: d.p0, p1: [s.x, s.y] } : d)
      return
    }
    if (panRef.current) {
      const { ux, uy } = pointerToUser(e)
      const dxUser = ux - panRef.current.startUx, dyUser = uy - panRef.current.startUy
      if (Math.abs(dxUser) > PAN_DRAG_THRESHOLD || Math.abs(dyUser) > PAN_DRAG_THRESHOLD) panMovedRef.current = true
      if (panMovedRef.current) {
        const { scale, centerX, centerY } = panRef.current.camera
        // Dragging right (dxUser > 0) moves the camera center LEFT so the content follows the
        // pointer, hence centerX subtracts; centerY ADDS because userToWorld flips the Y axis
        // relative to screen space (screen-down is world-up), so the two signs differ.
        dispatch({ type: 'SET_CAMERA', camera: { scale, centerX: centerX - dxUser / scale, centerY: centerY + dyUser / scale } })
      }
      return
    }
    const drag = ui.drag
    if (!drag) return
    const pt = pointerToWorld(e)
    const m = clone(model); const f = m.floors[m.activeFloor]
    let guides: ReturnType<typeof snapPoint>['guides'] = []

    if (drag.kind === 'edgeBody') {
      const edge = f.edges[drag.id!]
      const dx = pt.x - drag.startPt!.x, dy = pt.y - drag.startPt!.y
      // Translate both endpoints by an identical delta — no axis-lock, no shape
      // special-casing. This alone is what fixes the old force-straightening bug: shape
      // is preserved because both endpoints move by the same vector, unconditionally.
      f.vertices[edge.v1].x = drag.startV1!.x + dx; f.vertices[edge.v1].y = drag.startV1!.y + dy
      f.vertices[edge.v2].x = drag.startV2!.x + dx; f.vertices[edge.v2].y = drag.startV2!.y + dy
    } else if (drag.kind === 'vertex') {
      const s = snapPoint(f, pt.x, pt.y, new Set([drag.id!]))
      f.vertices[drag.id!].x = s.x; f.vertices[drag.id!].y = s.y
      guides = s.guides
    } else if (drag.kind === 'opening') {
      const edge = f.edges[drag.id!]
      const p1 = f.vertices[edge.v1], p2 = f.vertices[edge.v2]
      const L = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
      const atM = gridSnap(projectAt([p1.x, p1.y], [p2.x, p2.y], pt))
      edge.openings[drag.openingIndex!].offset = atM / L
    } else if (drag.kind === 'fixture') {
      // Mismo patrón de traslación que edgeBody: delta del puntero desde el inicio del
      // gesto, sumado a la posición inicial — sin snapping (un mueble no vive en la grilla
      // de vértices).
      const fx = f.fixtures!.find(x => x.id === drag.id)!
      const dx = pt.x - drag.startPt!.x, dy = pt.y - drag.startPt!.y
      fx.x = drag.startV1!.x + dx; fx.y = drag.startV1!.y + dy
    } else if (drag.kind === 'manualDim') {
      // Idéntico a edgeBody: traslada AMBOS puntos por el mismo delta — sin snapping (la
      // reposición fina se hace borrando y volviendo a trazar, mismo alcance que fixture).
      const dim = (f.manualDimensions ?? []).find(d => d.id === drag.id)!
      const dx = pt.x - drag.startPt!.x, dy = pt.y - drag.startPt!.y
      dim.p1.x = drag.startV1!.x + dx; dim.p1.y = drag.startV1!.y + dy
      dim.p2.x = drag.startV2!.x + dx; dim.p2.y = drag.startV2!.y + dy
    } else if (drag.kind === 'manualDimEndpoint') {
      // Idéntico a 'vertex': el punto se mueve directo al puntero (con el mismo snapPoint
      // a vértices/grilla), no por delta — el otro extremo de la cota no se toca, así que
      // esto cambia el largo.
      const dim = (f.manualDimensions ?? []).find(d => d.id === drag.id)!
      const s = snapPoint(f, pt.x, pt.y, new Set())
      dim[drag.which!].x = s.x; dim[drag.which!].y = s.y
      guides = s.guides
    }
    // Every frame of a gesture — including the first — dispatches DRAG_MODEL, never
    // SET_MODEL: per reducer.ts's own contract, dragBase is captured by the FIRST
    // DRAG_MODEL frame and held through every subsequent one, then consumed by a single
    // COMMITTING SET_MODEL once the gesture ends (see onPointerUp). Committing on every
    // frame here would let each later frame's DRAG_MODEL re-capture dragBase from the
    // previous frame's result instead of the true pre-gesture state, corrupting undo.
    dispatch({ type: 'DRAG_MODEL', model: m })
    dragMovedRef.current = true
    dispatch({ type: 'SET_GUIDES', guides })
  }

  const onPointerUp = () => {
    if (ui.calibrating) { calDragRef.current = false; return }
    if (dimDragRef.current) {
      // A diferencia de la calibración (que exige un paso aparte porque la escala px→m es
      // justo lo que se está resolviendo), aquí p0/p1 YA están en metros reales — se puede
      // comprometer de inmediato al soltar, sin pedir nada más al usuario.
      dimDragRef.current = false
      if (dimDraft) {
        dispatch({ type: 'ADD_MANUAL_DIM', p1: { x: dimDraft.p0[0], y: dimDraft.p0[1] }, p2: { x: dimDraft.p1[0], y: dimDraft.p1[1] } })
        dispatch({ type: 'SET_TOOL', tool: 'select' })
      }
      setDimDraft(null)
      return
    }
    if (panRef.current) {
      if (!panMovedRef.current) { dispatch({ type: 'SET_SEL', sel: null }); dispatch({ type: 'SET_DRAG', drag: null }) }
      panRef.current = null
      return
    }
    const drag = ui.drag
    if (!drag) return
    // Resolve the structural decision (vertex-merge / T-junction split) once, against the
    // live end-of-drag position, then commit the WHOLE gesture — every intermediate
    // DRAG_MODEL frame plus this resolution — as exactly one SET_MODEL, which is what
    // consumes reducer.ts's dragBase into a single undo step for the entire drag.
    let finalModel = model
    if (drag.kind === 'vertex' && dragMovedRef.current) {
      const f = model.floors[model.activeFloor]
      const v = f.vertices[drag.id!]
      const nearV = nearestVertex(f, v, new Set([drag.id!]))
      if (nearV) {
        const m = clone(model); const mf = m.floors[m.activeFloor]
        mergeVertexInto(mf, drag.id!, nearV.id)
        finalModel = m
        dispatch({ type: 'SET_SEL', sel: { t: 'vertex', id: nearV.id } })
      } else {
        const incidentEdges = new Set(Object.values(f.edges).filter(e => e.v1 === drag.id || e.v2 === drag.id).map(e => e.id))
        const nearEdge = nearestEdgePoint(f, v, incidentEdges)
        if (nearEdge && nearEdge.distance < SNAP) {
          const m = clone(model); const mf = m.floors[m.activeFloor]
          mf.vertices[drag.id!].x = nearEdge.x; mf.vertices[drag.id!].y = nearEdge.y
          splitEdgeAtVertex(mf, nearEdge.edgeId, drag.id!)
          finalModel = m
        }
      }
    }
    if (dragMovedRef.current) dispatch({ type: 'SET_MODEL', model: finalModel })
    dispatch({ type: 'SET_DRAG', drag: null })
    dispatch({ type: 'SET_GUIDES', guides: [] })
  }

  const delOpen = (edgeId: string, index: number) => {
    const m = clone(model); removeOpeningFromFloor(m.floors[m.activeFloor], edgeId, index)
    dispatch({ type: 'SET_MODEL', model: m }); dispatch({ type: 'SET_SEL', sel: null })
  }
  const delEdge = (id: string) => {
    const m = clone(model); removeEdgeFromFloor(m.floors[m.activeFloor], id)
    dispatch({ type: 'SET_MODEL', model: m }); dispatch({ type: 'SET_SEL', sel: null })
  }
  const delVertex = (id: string) => {
    const m = clone(model); removeVertexFromFloor(m.floors[m.activeFloor], id)
    dispatch({ type: 'SET_MODEL', model: m }); dispatch({ type: 'SET_SEL', sel: null })
  }
  const delFixture = (id: string) => {
    const m = clone(model); removeFixtureFromFloor(m.floors[m.activeFloor], id)
    dispatch({ type: 'SET_MODEL', model: m }); dispatch({ type: 'SET_SEL', sel: null })
  }
  const delManualDim = (id: string) => {
    const m = clone(model); removeManualDimFromFloor(m.floors[m.activeFloor], id)
    dispatch({ type: 'SET_MODEL', model: m }); dispatch({ type: 'SET_SEL', sel: null })
  }

  const onRoomCommit = (cx: number, cy: number, name: string, type?: RoomType) => {
    const nm = name.trim()
    if (nm) dispatch({ type: 'RENAME_ROOM', cx, cy, name: nm, roomType: type })
    else dispatch({ type: 'SET_EDIT_ROOM', editRoom: null })
  }
  const onRoomCancel = () => dispatch({ type: 'SET_EDIT_ROOM', editRoom: null })

  if (!entered) return <EmptyState onUpload={onUpload} onStartBlank={() => setEntered(true)} uploading={uploading} />

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.dark, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'center', padding: '10px 16px', borderBottom: `1px solid ${colors.border}` }}>
        {TOOLS.map(tool => (
          <button key={tool} onClick={() => onToolClick(tool)} style={btn(ui.tool === tool)}>{TOOL_LABELS[tool] ?? tool}</button>
        ))}
        <button onClick={() => setPaletteOpen(o => !o)} style={btn(paletteOpen)}>MUEBLE</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => dispatch({ type: 'UNDO' })} disabled={state.past.length === 0}
          style={btnDisabled(state.past.length === 0)}>UNDO</button>
        <button onClick={() => dispatch({ type: 'REDO' })} disabled={state.future.length === 0}
          style={btnDisabled(state.future.length === 0)}>REDO</button>
        <button onClick={() => dispatch({ type: 'TOGGLE_DIMS' })} style={btn(ui.showDims)}>Dims</button>
        <button onClick={doSave} style={btn(state.dirty)}>Save</button>
      </div>

      {paletteOpen && (
        <div style={{ flexShrink: 0, display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap', padding: '6px 16px', borderBottom: `1px solid ${colors.border}` }}>
          {Object.entries(FIXTURE_CATALOG).map(([kind, meta]) => (
            <button key={kind} onClick={() => onFixturePick(kind as FixtureKind)}
              style={{ ...btn(false), textTransform: 'none', fontFamily: fonts.sans, fontSize: '11px' }}>
              {meta.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ flexShrink: 0, display: 'flex', gap: '4px', alignItems: 'center', padding: '6px 16px', borderBottom: `1px solid ${colors.border}` }}>
        {model.floors.map((f, i) => (
          <button key={i} onClick={() => dispatch({ type: 'SWITCH_FLOOR', index: i })} style={{
            ...btn(i === model.activeFloor), textTransform: 'none', letterSpacing: '0.04em', fontFamily: fonts.sans, fontSize: '11px',
          }}>{f.name}</button>
        ))}
        <button onClick={() => dispatch({ type: 'ADD_FLOOR' })} style={{ ...btn(false), textTransform: 'none', fontFamily: fonts.sans, fontSize: '11px' }}>+ Floor</button>
      </div>

      {floor.reference && (
        <ReferenceControls
          opacity={floor.reference.opacity}
          onOpacity={v => dispatch({ type: 'SET_REFERENCE_FIELD', key: 'opacity', value: v })}
          calibrating={ui.calibrating}
          onToggleCalibrate={() => { setCalDraft(null); dispatch({ type: 'SET_CALIBRATING', on: !ui.calibrating }) }}
          hasDraft={calDraft != null}
          canApply={canApplyCalibration}
          len={calLen}
          onLen={setCalLen}
          onApply={applyCalibration}
        />
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <FloorPlanCanvas
            ref={svgRef} model={model} floor={floor} t={t} rooms={labels} polygons={polygons} angles={angles} ui={ui} editName={editName}
            editType={editType} imgNatural={imgNatural} calDraft={calDraft} dimDraft={dimDraft}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onMouseDown={onMouseDown}
            onRoomCommit={onRoomCommit} onRoomCancel={onRoomCancel}
          />
          <div style={{ position: 'absolute', bottom: '12px', right: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button aria-label="Zoom in" onClick={() => onZoomButton(1)} style={{ ...btn(false), padding: '4px 10px', fontSize: '14px' }}>+</button>
            <button aria-label="Fit to screen" onClick={() => dispatch({ type: 'RESET_CAMERA' })} style={{ ...btn(false), padding: '4px 10px', fontSize: '11px' }}>⤢</button>
            <button aria-label="Zoom out" onClick={() => onZoomButton(-1)} style={{ ...btn(false), padding: '4px 10px', fontSize: '14px' }}>−</button>
          </div>
        </div>
        <FloorPlanPanel model={model} floor={floor} rooms={rooms} geoJson={geoJson} ui={ui} dispatch={dispatch} />
      </div>
    </div>
  )
}
