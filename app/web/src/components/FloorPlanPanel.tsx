// app/web/src/components/FloorPlanPanel.tsx
import type { Dispatch } from 'react'
import { colors, fonts } from '../lib/theme'
import type { Action, Sel, UI } from '../lib/floorplan/reducer'
import { isGhost, type FloorGraph, type FloorSet } from '../lib/floorplan/types'
import type { RoomArea } from '../lib/floorplan/rooms'
import { traceFaces } from '../lib/floorplan/rooms'
import { shoelace } from '../lib/floorplan/geometry'
import { btn } from './floorplanStyles'

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
    // Una división no es muro: sin espesor editable y sin nada de vanos en su inspector —
    // solo la promoción de vuelta a muro (SET_EDGE_KIND recalcula el espesor según dónde quedó).
    if (isGhost(e)) {
      return (
        <Section title="División seleccionada" key={sel.id}>
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, marginBottom: '8px' }}>
            Separa espacios para nombres y áreas; no es un muro en renders ni exports.
          </div>
          <button style={btn(false)} onClick={() => dispatch({ type: 'SET_EDGE_KIND', edgeId: sel.id, kind: 'wall' })}>
            CONVERTIR EN MURO
          </button>
        </Section>
      )
    }
    // Con vanos, el convertir se deshabilita Y se explica: el reducer también lo rechaza,
    // pero ese no-op es silencioso — la UI debe comunicar el porqué, no depender de él.
    const blocked = e.openings.length > 0
    return (
      <Section title="Muro seleccionado" key={sel.id}>
        <Field label="Espesor (m)" value={e.thickness} step={0.01}
          onCommit={value => dispatch({ type: 'SET_EDGE_THICKNESS', edgeId: sel.id, value })} />
        <button disabled={blocked}
          style={{ ...btn(false), opacity: blocked ? 0.4 : 1, cursor: blocked ? 'default' : 'pointer' }}
          onClick={() => dispatch({ type: 'SET_EDGE_KIND', edgeId: sel.id, kind: 'ghost' })}>
          CONVERTIR EN DIVISIÓN
        </button>
        {blocked && (
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, marginTop: '6px' }}>
            Quita sus puertas y ventanas antes de convertirlo en división.
          </div>
        )}
      </Section>
    )
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
  model: FloorSet
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
