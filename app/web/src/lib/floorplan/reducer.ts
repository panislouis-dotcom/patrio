import type { FloorPlanModel, FloorGraph, VertexId, EdgeId } from './types'
import { clone, genId } from './types'
import { deleteVertex, deleteEdge, splitEdgeAtVertex } from './graph'
import { exteriorEdgeIds } from './rooms'
import type { Guide } from './snapping'
import type { Camera } from './viewTransform'

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'room' | 'delete'
export type Sel =
  | { t: 'vertex'; id: VertexId }
  | { t: 'edge'; id: EdgeId }
  | { t: 'opening'; edgeId: EdgeId; index: number }
  | null

export interface DragState {
  kind: 'vertex' | 'edgeBody' | 'opening'
  id?: VertexId | EdgeId       // vertex id for 'vertex', edge id for 'edgeBody'/'opening'
  openingIndex?: number
  // Wall-body drag: drag-start endpoint positions + pointer position, so the wall can be
  // translated by the pointer delta. No axis-lock, no diagonal special-case — see graph.ts's
  // translateEdgeBody for why this alone fixes the old force-straightening bug.
  startV1?: { x: number; y: number }
  startV2?: { x: number; y: number }
  startPt?: { x: number; y: number }
}

export interface UI {
  tool: Tool
  sel: Sel
  drag: DragState | null
  editRoom: { cx: number; cy: number } | null
  snapGuides: Guide[]
  showDims: boolean
  calibrating: boolean
  camera: Camera | null
}

export interface EditorState {
  model: FloorPlanModel
  ui: UI
  dirty: boolean
  past: FloorPlanModel[]
  future: FloorPlanModel[]
  // Pre-gesture snapshot: set by the first DRAG_MODEL frame of a drag, consumed by the
  // committing SET_MODEL so history gets exactly one entry — the state before the whole
  // gesture, not the intermediate frames ("one push per gesture").
  dragBase: FloorPlanModel | null
}

const MAX_HISTORY = 50
const MIN_SCALE = 8
const MAX_SCALE = 4000
const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))

export function initialState(model: FloorPlanModel): EditorState {
  return {
    model,
    ui: { tool: 'select', sel: null, drag: null, editRoom: null, snapGuides: [], showDims: true, calibrating: false, camera: null },
    dirty: false,
    past: [], future: [],
    dragBase: null,
  }
}

export type Action =
  | { type: 'SET_TOOL'; tool: Tool }
  | { type: 'SET_SEL'; sel: Sel }
  | { type: 'TOGGLE_DIMS' }
  | { type: 'ADD_FLOOR' } | { type: 'DEL_FLOOR' } | { type: 'SWITCH_FLOOR'; index: number }
  | { type: 'SET_FLOOR_FIELD'; key: 'name' | 'height_m'; value: string | number }
  | { type: 'SET_FLOOR_PARAM'; key: 'extWall_m' | 'intWall_m'; value: number }
  | { type: 'SET_SLAB'; value: number }
  | { type: 'RENAME_ROOM'; cx: number; cy: number; name: string }
  | { type: 'DELETE_ROOM'; cx: number; cy: number }
  | { type: 'SET_OPENING_FIELD'; edgeId: EdgeId; index: number; key: 'width'; value: number }
  | { type: 'SET_OPENING_FIELD'; edgeId: EdgeId; index: number; key: 'kind'; value: 'door' | 'window' }
  | { type: 'SET_EDGE_THICKNESS'; edgeId: EdgeId; value: number }
  | { type: 'SET_EDGE_LENGTH'; edgeId: EdgeId; value: number; anchor: 'v1' | 'v2' }
  | { type: 'SET_VERTEX_POINT'; id: VertexId; x: number; y: number }
  | { type: 'SPLIT_EDGE_AT_POINT'; edgeId: EdgeId; x: number; y: number }
  | { type: 'SET_MODEL'; model: FloorPlanModel }
  | { type: 'DRAG_MODEL'; model: FloorPlanModel }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_DRAG'; drag: DragState | null }
  | { type: 'SET_GUIDES'; guides: Guide[] }
  | { type: 'SET_EDIT_ROOM'; editRoom: { cx: number; cy: number } | null }
  | { type: 'SET_CALIBRATING'; on: boolean }
  | { type: 'SET_REFERENCE_FIELD'; key: 'opacity' | 'scale_m_per_px'; value: number }
  | { type: 'SET_CAMERA'; camera: Camera }
  | { type: 'ZOOM_AT'; anchor: { x: number; y: number }; factor: number; seed: Camera }
  | { type: 'RESET_CAMERA' }
  | { type: 'DELETE_SEL' }
  | { type: 'MARK_SAVED' }

const uiChange = (s: EditorState, ui: Partial<UI>): EditorState => ({ ...s, ui: { ...s.ui, ...ui } })
const modelChange = (s: EditorState, model: FloorPlanModel): EditorState =>
  ({ ...s, model, dirty: true, past: [...s.past, s.dragBase ?? s.model].slice(-MAX_HISTORY), future: [], dragBase: null })

// ── element removal (shared by the delete tool and the keyboard DELETE_SEL path) ──
export function removeEdgeFromFloor(f: FloorGraph, id: EdgeId): void {
  deleteEdge(f, id)
}
export function removeVertexFromFloor(f: FloorGraph, id: VertexId): void {
  deleteVertex(f, id)
}
export function removeOpeningFromFloor(f: FloorGraph, edgeId: EdgeId, index: number): void {
  f.edges[edgeId].openings.splice(index, 1)
}

export function reducer(s: EditorState, a: Action): EditorState {
  const F = (m: FloorPlanModel): FloorGraph => m.floors[m.activeFloor]
  switch (a.type) {
    case 'SET_TOOL': return uiChange(s, { tool: a.tool, sel: null })
    case 'SET_SEL': return uiChange(s, { sel: a.sel })
    case 'TOGGLE_DIMS': return uiChange(s, { showDims: !s.ui.showDims })
    case 'SET_DRAG': return uiChange(s, { drag: a.drag })
    case 'SET_GUIDES': return uiChange(s, { snapGuides: a.guides })
    case 'SET_EDIT_ROOM': return uiChange(s, { editRoom: a.editRoom })
    case 'SET_CALIBRATING': return uiChange(s, { calibrating: a.on })
    case 'SET_CAMERA': return uiChange(s, { camera: a.camera })
    case 'RESET_CAMERA': return uiChange(s, { camera: null })
    case 'ZOOM_AT': {
      const cam = s.ui.camera ?? a.seed
      const newScale = clampScale(cam.scale * a.factor)
      const centerX = a.anchor.x + (cam.centerX - a.anchor.x) * (cam.scale / newScale)
      const centerY = a.anchor.y + (cam.centerY - a.anchor.y) * (cam.scale / newScale)
      return uiChange(s, { camera: { scale: newScale, centerX, centerY } })
    }
    case 'SET_MODEL': return modelChange(s, a.model)
    case 'DRAG_MODEL': return { ...s, model: a.model, dirty: true, dragBase: s.dragBase ?? s.model }
    case 'UNDO': {
      // Mid-gesture: undo cancels the in-flight drag back to its pre-gesture baseline
      // instead of popping history, so the uncommitted drag frame never pollutes past/future.
      if (s.dragBase != null) {
        return { ...s, model: s.dragBase, dirty: true, dragBase: null, ui: { ...s.ui, sel: null, drag: null, editRoom: null } }
      }
      if (s.past.length === 0) return s
      const prev = s.past[s.past.length - 1]
      return {
        ...s, model: prev, dirty: true, dragBase: null,
        past: s.past.slice(0, -1), future: [s.model, ...s.future],
        ui: { ...s.ui, sel: null, drag: null, editRoom: null },
      }
    }
    case 'REDO': {
      if (s.dragBase != null) {
        return { ...s, model: s.dragBase, dirty: true, dragBase: null, ui: { ...s.ui, sel: null, drag: null, editRoom: null } }
      }
      if (s.future.length === 0) return s
      const next = s.future[0]
      return {
        ...s, model: next, dirty: true, dragBase: null,
        past: [...s.past, s.model], future: s.future.slice(1),
        ui: { ...s.ui, sel: null, drag: null, editRoom: null },
      }
    }
    case 'MARK_SAVED': return { ...s, dirty: false }
    case 'ADD_FLOOR': {
      const m = clone(s.model)
      const src = clone(F(m))
      src.name = m.floors.length === 1 ? 'Planta Alta' : `Nivel ${m.floors.length + 1}`
      m.floors.push(src); m.activeFloor = m.floors.length - 1
      return { ...modelChange(s, m), ui: { ...s.ui, sel: null, editRoom: null } }
    }
    case 'DEL_FLOOR': {
      if (s.model.floors.length <= 1) return s
      const m = clone(s.model)
      m.floors.splice(m.activeFloor, 1); m.activeFloor = Math.max(0, m.activeFloor - 1)
      return { ...modelChange(s, m), ui: { ...s.ui, sel: null, editRoom: null } }
    }
    case 'SWITCH_FLOOR': {
      // Intentionally does NOT mark dirty: choosing which floor to view is a view action.
      const m = clone(s.model)
      m.activeFloor = Math.max(0, Math.min(m.floors.length - 1, a.index))
      return { ...s, model: m, ui: { ...s.ui, sel: null, editRoom: null } }
    }
    case 'SET_FLOOR_FIELD': {
      const m = clone(s.model); const f = F(m)
      if (a.key === 'height_m') f.height_m = Number(a.value)
      else f.name = String(a.value)
      return modelChange(s, m)
    }
    case 'SET_FLOOR_PARAM': {
      const m = clone(s.model); const f = F(m)
      const ext = exteriorEdgeIds(f)
      f[a.key] = a.value
      for (const e of Object.values(f.edges)) {
        const isExterior = ext.has(e.id)
        if ((a.key === 'extWall_m' && isExterior) || (a.key === 'intWall_m' && !isExterior)) e.thickness = a.value
      }
      return modelChange(s, m)
    }
    case 'SET_SLAB': {
      const m = clone(s.model); m.slab_m = a.value
      return modelChange(s, m)
    }
    case 'RENAME_ROOM': {
      const m = clone(s.model); const f = F(m)
      let best = -1, bd = 0.9
      f.rooms.forEach((r, i) => { const d = Math.hypot(r.cx - a.cx, r.cy - a.cy); if (d < bd) { bd = d; best = i } })
      if (best >= 0) { f.rooms[best].name = a.name; f.rooms[best].cx = a.cx; f.rooms[best].cy = a.cy }
      else f.rooms.push({ name: a.name, cx: a.cx, cy: a.cy })
      return { ...modelChange(s, m), ui: { ...s.ui, editRoom: null } }
    }
    case 'DELETE_ROOM': {
      const m = clone(s.model); const f = F(m)
      let best = -1, bd = 0.9
      f.rooms.forEach((r, i) => { const d = Math.hypot(r.cx - a.cx, r.cy - a.cy); if (d < bd) { bd = d; best = i } })
      if (best < 0) return s
      f.rooms.splice(best, 1)
      return { ...modelChange(s, m), ui: { ...s.ui, editRoom: null } }
    }
    case 'SET_OPENING_FIELD': {
      const m = clone(s.model); const f = F(m)
      const o = f.edges[a.edgeId]?.openings[a.index]
      if (!o) return s
      if (a.key === 'width') o.width = a.value
      else o.kind = a.value
      return modelChange(s, m)
    }
    case 'SET_EDGE_THICKNESS': {
      const m = clone(s.model); const f = F(m)
      const e = f.edges[a.edgeId]; if (!e) return s
      e.thickness = a.value
      return modelChange(s, m)
    }
    case 'SET_EDGE_LENGTH': {
      // Retype a wall's exact length: keep one endpoint fixed and slide the other along the
      // wall's own direction so |v2-v1| = value (angle preserved). The moving endpoint is a
      // shared vertex, so any walls meeting it at that corner follow — same as dragging the
      // point by hand, which keeps rooms closed. anchor picks which end stays put.
      const m = clone(s.model); const f = F(m)
      const e = f.edges[a.edgeId]; if (!e) return s
      const fixed = f.vertices[a.anchor === 'v2' ? e.v2 : e.v1]
      const moving = f.vertices[a.anchor === 'v2' ? e.v1 : e.v2]
      if (!fixed || !moving) return s
      const dx = moving.x - fixed.x, dy = moving.y - fixed.y
      const L = Math.hypot(dx, dy)
      if (L < 1e-9) return s   // degenerate wall: no direction to grow along
      const t = Math.max(0.05, a.value) / L
      moving.x = fixed.x + dx * t
      moving.y = fixed.y + dy * t
      return modelChange(s, m)
    }
    case 'SET_VERTEX_POINT': {
      const m = clone(s.model); const f = F(m)
      if (!f.vertices[a.id]) return s
      f.vertices[a.id].x = a.x; f.vertices[a.id].y = a.y
      return modelChange(s, m)
    }
    case 'SPLIT_EDGE_AT_POINT': {
      const m = clone(s.model); const f = F(m)
      if (!f.edges[a.edgeId]) return s
      const newVertexId = genId()
      f.vertices[newVertexId] = { id: newVertexId, x: a.x, y: a.y }
      splitEdgeAtVertex(f, a.edgeId, newVertexId)
      return { ...modelChange(s, m), ui: { ...s.ui, sel: { t: 'vertex', id: newVertexId } } }
    }
    case 'DELETE_SEL': {
      const sel = s.ui.sel
      if (!sel) return s
      const m = clone(s.model); const f = F(m)
      if (sel.t === 'edge') { if (!f.edges[sel.id]) return s; removeEdgeFromFloor(f, sel.id) }
      else if (sel.t === 'opening') { if (!f.edges[sel.edgeId]) return s; removeOpeningFromFloor(f, sel.edgeId, sel.index) }
      else if (sel.t === 'vertex') { if (!f.vertices[sel.id]) return s; removeVertexFromFloor(f, sel.id) }
      return { ...modelChange(s, m), ui: { ...s.ui, sel: null } }
    }
    case 'SET_REFERENCE_FIELD': {
      const m = clone(s.model); const f = F(m)
      if (!f.reference) return s
      f.reference[a.key] = a.value
      return modelChange(s, m)
    }
    default: return s
  }
}
