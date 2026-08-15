// app/web/src/components/FloorPlanPanel.tsx
import { useState } from 'react'
import type { Dispatch } from 'react'
import { colors, fonts } from '../lib/theme'
import type { Action, Sel, UI } from '../lib/floorplan/reducer'
import type { Edge, FloorGraph, FloorPlanModel } from '../lib/floorplan/types'
import type { RoomArea } from '../lib/floorplan/rooms'
import { traceFaces } from '../lib/floorplan/rooms'
import { shoelace } from '../lib/floorplan/geometry'

const PANEL_W = 280

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.08em', color: colors.secondary, marginBottom: '8px', textTransform: 'uppercase' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, value, onCommit, step = 0.05 }: {
  label: string; value: number; onCommit: (v: number) => void; step?: number
}) {
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        defaultValue={value}
        onChange={e => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onCommit(v) }}
        style={{ width: '80px', fontFamily: 'monospace', fontSize: '12px', background: colors.dark, color: colors.neutral, border: `1px solid ${colors.border}`, borderRadius: '4px', padding: '3px 6px' }}
      />
    </label>
  )
}

// Default anchor for editing a wall's length: keep the CONNECTED end fixed and grow the FREE
// end (the one not joined to any other wall), so lengthening a wall doesn't drag a corner that
// holds the rest of the plan together. Only one free end → anchor the other. Both ends free or
// both connected → fall back to v1. The ⇄ button still lets the user override.
export function anchorForLengthEdit(floor: FloorGraph, edge: Edge): 'v1' | 'v2' {
  const degree = (vid: string) =>
    Object.values(floor.edges).reduce((n, e) => n + (e.v1 === vid || e.v2 === vid ? 1 : 0), 0)
  const d1 = degree(edge.v1), d2 = degree(edge.v2)
  if (d1 === 1 && d2 > 1) return 'v2'   // v1 is free → v1 grows, v2 stays
  if (d2 === 1 && d1 > 1) return 'v1'   // v2 is free → v2 grows, v1 stays
  return 'v1'
}

function EdgeSection({ edge, floor, dispatch }: { edge: Edge; floor: FloorGraph; dispatch: Dispatch<Action> }) {
  // Which endpoint stays fixed while the length field grows the wall. Local view state:
  // resets per selection because the parent keys this component by the edge id.
  const [anchor, setAnchor] = useState<'v1' | 'v2'>(() => anchorForLengthEdit(floor, edge))
  const v1 = floor.vertices[edge.v1], v2 = floor.vertices[edge.v2]
  const length = Math.hypot(v2.x - v1.x, v2.y - v1.y)
  // Flip which end is fixed AND re-apply the same length from the new anchor, so the wall
  // visibly shifts to grow from the other side without the user retyping.
  const flip = () => {
    const next = anchor === 'v1' ? 'v2' : 'v1'
    setAnchor(next)
    dispatch({ type: 'SET_EDGE_LENGTH', edgeId: edge.id, value: length, anchor: next })
  }
  return (
    <Section title="Muro seleccionado">
      <Field label="Largo (m)" value={length} step={0.05}
        onCommit={value => dispatch({ type: 'SET_EDGE_LENGTH', edgeId: edge.id, value, anchor })} />
      <button onClick={flip}
        style={{ width: '100%', marginBottom: '8px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, background: colors.dark, border: `1px solid ${colors.border}`, borderRadius: '4px', padding: '4px 6px', cursor: 'pointer' }}>
        ⇄ cambiar extremo
      </button>
      <Field label="Espesor (m)" value={edge.thickness} step={0.01}
        onCommit={value => dispatch({ type: 'SET_EDGE_THICKNESS', edgeId: edge.id, value })} />
    </Section>
  )
}

function grossAreaM2(floor: FloorGraph): number {
  const faces = traceFaces(floor)
  if (faces.length === 0) return 0
  const outer = faces.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
  const pts = outer.vertexIds.map(id => [floor.vertices[id].x, floor.vertices[id].y] as [number, number])
  return shoelace(pts)
}

function selectedFields(sel: Sel, floor: FloorGraph, dispatch: Dispatch<Action>) {
  if (!sel) return null
  if (sel.t === 'vertex') {
    const v = floor.vertices[sel.id]
    if (!v) return null
    return (
      <Section title="Vértice seleccionado" key={sel.id}>
        <Field label="X (m)" value={v.x} onCommit={x => dispatch({ type: 'SET_VERTEX_POINT', id: sel.id, x, y: v.y })} />
        <Field label="Y (m)" value={v.y} onCommit={y => dispatch({ type: 'SET_VERTEX_POINT', id: sel.id, x: v.x, y })} />
      </Section>
    )
  }
  if (sel.t === 'edge') {
    const e = floor.edges[sel.id]
    if (!e) return null
    return <EdgeSection key={sel.id} edge={e} floor={floor} dispatch={dispatch} />
  }
  const e = floor.edges[sel.edgeId]
  const o = e?.openings[sel.index]
  if (!o) return null
  return (
    <Section title={o.kind === 'door' ? 'Puerta seleccionada' : 'Ventana seleccionada'} key={`${sel.edgeId}:${sel.index}`}>
      <Field label="Ancho (m)" value={o.width} step={0.05}
        onCommit={value => dispatch({ type: 'SET_OPENING_FIELD', edgeId: sel.edgeId, index: sel.index, key: 'width', value })} />
    </Section>
  )
}

interface Props {
  model: FloorPlanModel
  floor: FloorGraph
  rooms: RoomArea[]
  geoJson: string
  ui: UI
  dispatch: Dispatch<Action>
}

export default function FloorPlanPanel({ model, floor, rooms, geoJson, ui, dispatch }: Props) {
  const gross = grossAreaM2(floor)
  return (
    <div style={{ width: PANEL_W, flexShrink: 0, borderLeft: `1px solid ${colors.border}`, overflowY: 'auto', background: colors.dark }}>
      {selectedFields(ui.sel, floor, dispatch)}

      <Section title="Parámetros de planta">
        <Field label="Muro ext. (m)" value={floor.extWall_m} step={0.01}
          onCommit={value => dispatch({ type: 'SET_FLOOR_PARAM', key: 'extWall_m', value })} />
        <Field label="Muro int. (m)" value={floor.intWall_m} step={0.01}
          onCommit={value => dispatch({ type: 'SET_FLOOR_PARAM', key: 'intWall_m', value })} />
        <Field label="Altura (m)" value={floor.height_m} step={0.05}
          onCommit={value => dispatch({ type: 'SET_FLOOR_FIELD', key: 'height_m', value })} />
        <Field label="Losa (m)" value={model.slab_m} step={0.01}
          onCommit={value => dispatch({ type: 'SET_SLAB', value })} />
      </Section>

      <Section title="Estadísticas">
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, marginBottom: '8px' }}>
          Área bruta: <strong>{gross.toFixed(1)} m²</strong>
        </div>
        {rooms.length === 0 ? (
          <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary }}>Sin cuartos detectados</div>
        ) : rooms.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, marginBottom: '4px' }}>
            <span>{r.name}</span><span>{r.area.toFixed(1)} m²</span>
          </div>
        ))}
      </Section>

      {ui.showDims && (
        <Section title="Exportar BIM (JSON)">
          <pre style={{ fontFamily: 'monospace', fontSize: '10px', color: colors.secondary, whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' }}>{geoJson}</pre>
        </Section>
      )}
    </div>
  )
}
