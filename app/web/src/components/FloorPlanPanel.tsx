// app/web/src/components/FloorPlanPanel.tsx
import { useState } from 'react'
import type { Dispatch } from 'react'
import { colors, fonts } from '../lib/theme'
import type { Action, Sel, UI } from '../lib/floorplan/reducer'
import { isGhost, FIXTURE_CATALOG, type Edge, type FloorGraph, type FloorSet } from '../lib/floorplan/types'
import type { RoomArea } from '../lib/floorplan/rooms'
import { ROOM_TYPE_CATALOG } from '../lib/floorplan/types'
import { traceFaces } from '../lib/floorplan/rooms'
import { shoelace } from '../lib/floorplan/geometry'
import { btn, btnDisabled } from './floorplanStyles'

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
  // Con vanos, el convertir se deshabilita Y se explica: el reducer también lo rechaza,
  // pero ese no-op es silencioso — la UI debe comunicar el porqué, no depender de él.
  const blocked = edge.openings.length > 0
  const blockedReasonId = 'convertir-division-bloqueado'
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
      <button disabled={blocked} style={btnDisabled(blocked)}
        aria-describedby={blocked ? blockedReasonId : undefined}
        onClick={() => dispatch({ type: 'SET_EDGE_KIND', edgeId: edge.id, kind: 'ghost' })}>
        CONVERTIR EN DIVISIÓN
      </button>
      {blocked && (
        <div id={blockedReasonId} style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, marginTop: '6px' }}>
          Quita sus puertas y ventanas antes de convertirlo en división.
        </div>
      )}
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
    return <EdgeSection key={sel.id} edge={e} floor={floor} dispatch={dispatch} />
  }
  if (sel.t === 'fixture') {
    const fx = (floor.fixtures ?? []).find(x => x.id === sel.id)
    if (!fx) return null
    // El título ES el label del catálogo: mismo patrón que "Puerta seleccionada"/"Ventana
    // seleccionada", donde el tipo (de solo lectura) vive en el encabezado, no en un campo.
    return (
      <Section title={FIXTURE_CATALOG[fx.kind].label} key={fx.id}>
        <Field label="Ancho (m)" value={fx.w_m} step={0.05}
          onCommit={value => dispatch({ type: 'SET_FIXTURE_PARAM', id: fx.id, patch: { w_m: value } })} />
        <Field label="Largo (m)" value={fx.h_m} step={0.05}
          onCommit={value => dispatch({ type: 'SET_FIXTURE_PARAM', id: fx.id, patch: { h_m: value } })} />
        <Field label="Rotación (°)" value={fx.rot} step={1}
          onCommit={value => dispatch({ type: 'SET_FIXTURE_PARAM', id: fx.id, patch: { rot: value } })} />
        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
          <button style={btn(false)}
            onClick={() => dispatch({ type: 'SET_FIXTURE_PARAM', id: fx.id, patch: { rot: (fx.rot + 90) % 360 } })}>
            90°
          </button>
          <button style={btn(false)} onClick={() => dispatch({ type: 'DELETE_SEL' })}>ELIMINAR</button>
        </div>
      </Section>
    )
  }
  if (sel.t === 'manualDim') {
    const dim = (floor.manualDimensions ?? []).find(d => d.id === sel.id)
    if (!dim) return null
    const length = Math.hypot(dim.p2.x - dim.p1.x, dim.p2.y - dim.p1.y)
    // Resize: arrastrando una manija de extremo en el canvas (solo visible con la cota
    // seleccionada) O editando aquí las coordenadas de un punto a la vez — ambos caminos
    // despachan el mismo SET_MANUAL_DIM_POINT. El largo no es un campo propio (nunca se
    // guarda, se deriva de p1/p2 como en cualquier otro lugar del modelo) — solo se muestra.
    return (
      <Section title="Medida seleccionada" key={dim.id}>
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, marginBottom: '8px' }}>
          Longitud: <strong>{length.toFixed(2)} m</strong>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.06em', color: colors.secondary, marginBottom: '4px', textTransform: 'uppercase' }}>
          Punto 1
        </div>
        <Field label="X (m)" value={dim.p1.x} onCommit={x => dispatch({ type: 'SET_MANUAL_DIM_POINT', id: dim.id, which: 'p1', x, y: dim.p1.y })} />
        <Field label="Y (m)" value={dim.p1.y} onCommit={y => dispatch({ type: 'SET_MANUAL_DIM_POINT', id: dim.id, which: 'p1', x: dim.p1.x, y })} />
        <div style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.06em', color: colors.secondary, margin: '8px 0 4px', textTransform: 'uppercase' }}>
          Punto 2
        </div>
        <Field label="X (m)" value={dim.p2.x} onCommit={x => dispatch({ type: 'SET_MANUAL_DIM_POINT', id: dim.id, which: 'p2', x, y: dim.p2.y })} />
        <Field label="Y (m)" value={dim.p2.y} onCommit={y => dispatch({ type: 'SET_MANUAL_DIM_POINT', id: dim.id, which: 'p2', x: dim.p2.x, y })} />
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
          <button style={btn(false)} onClick={() => dispatch({ type: 'DELETE_SEL' })}>ELIMINAR</button>
        </div>
      </Section>
    )
  }
  if (sel.t !== 'opening') return null
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
            <span>
              {r.name}
              {/* Tipo explícito (dropdown al nivel del plano, ROOM_TYPE_CATALOG en
                  types.ts) — de solo lectura aquí, la edición vive en el input flotante
                  del canvas. Da visibilidad de qué cuartos siguen sin tipar. */}
              {r.type && <span style={{ color: colors.secondary }}> · {ROOM_TYPE_CATALOG[r.type].label}</span>}
            </span>
            <span>{r.area.toFixed(1)} m²</span>
          </div>
        ))}
      </Section>

      {/* Desacoplado de showDims (antes lo reusaba de prestado): el export BIM no tiene
          nada que ver con el abarrotamiento visual de las cotas automáticas del canvas
          — es un panel lateral aparte, ya con su propio scroll, sin relación real con
          ese toggle. Ver "Estadísticas" arriba, que tampoco depende de showDims. */}
      <Section title="Exportar BIM (JSON)">
        <pre style={{ fontFamily: 'monospace', fontSize: '10px', color: colors.secondary, whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' }}>{geoJson}</pre>
      </Section>
    </div>
  )
}
