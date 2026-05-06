import { useState } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet'
import type { RawFields } from '../lib/types'
import { validateRaw } from '../lib/validateRaw'
import { colors, fonts } from '../lib/theme'

// ── helpers ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <div style={{
        fontFamily: fonts.label,
        fontSize: '10px',
        color: colors.secondary,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        marginBottom: '12px',
        borderBottom: `1px solid ${colors.border}`,
        paddingBottom: '8px',
      }}>
        {title}
      </div>
      {children}
    </section>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontFamily: fonts.label,
      fontSize: '10px',
      color: colors.secondary,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: '4px',
    }}>
      {children}
    </div>
  )
}

function MapClickHandler({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onPlace(e.latlng.lat, e.latlng.lng) })
  return null
}

// ── input style ───────────────────────────────────────────────────────────────

const inputStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '13px',
  padding: '4px 0',
  width: '100%',
  outline: 'none',
}

const gridTwo: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '16px',
}

// ── props ─────────────────────────────────────────────────────────────────────

interface Props {
  initial: Partial<RawFields>
  onSave: (data: RawFields) => Promise<void>
  onCancel?: () => void
  saving: boolean
  saveError: string | null
}

// ── component ─────────────────────────────────────────────────────────────────

export function ProspectForm({ initial, onSave, onCancel, saving, saveError }: Props) {
  const [form, setForm] = useState<Partial<RawFields>>(initial)

  const issues = validateRaw(form)
  const hasErrors = issues.some(i => i.severity === 'error')

  function set<K extends keyof RawFields>(key: K, value: RawFields[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const lat = form.latitude || 25.6866
  const lng = form.longitude || -100.3161
  const hasCoords = Boolean(form.latitude && form.longitude && form.latitude !== 0 && form.longitude !== 0)

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>

      {/* ── General ─────────────────────────────────────────────────── */}
      <Section title="General">
        <div style={{ marginBottom: '16px' }}>
          <FieldLabel>Nombre</FieldLabel>
          <input
            style={inputStyle}
            type="text"
            value={form.name ?? ''}
            onChange={e => set('name', e.target.value)}
          />
        </div>
        <div style={{ marginBottom: '16px' }}>
          <FieldLabel>Dirección</FieldLabel>
          <input
            style={inputStyle}
            type="text"
            value={form.address ?? ''}
            onChange={e => set('address', e.target.value)}
          />
        </div>
        <div style={{ ...gridTwo, marginBottom: '16px' }}>
          <div>
            <FieldLabel>Ciudad</FieldLabel>
            <input
              style={inputStyle}
              type="text"
              value={form.city ?? ''}
              onChange={e => set('city', e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Estado</FieldLabel>
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={form.status ?? 'evaluating'}
              onChange={e => set('status', e.target.value as RawFields['status'])}
            >
              <option value="evaluating">Evaluating</option>
              <option value="passed">Passed</option>
              <option value="converted">Converted</option>
            </select>
          </div>
        </div>
        <div>
          <FieldLabel>URL</FieldLabel>
          <input
            style={inputStyle}
            type="text"
            value={form.url ?? ''}
            onChange={e => set('url', e.target.value)}
          />
        </div>
      </Section>

      {/* ── Ubicación ───────────────────────────────────────────────── */}
      <Section title="Ubicación">
        <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, marginBottom: '8px' }}>
          Haz click en el mapa para fijar la ubicación
        </div>
        <div style={{ height: '300px', borderRadius: '2px', overflow: 'hidden', marginBottom: '16px' }}>
          <MapContainer
            center={[lat, lng]}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
            <MapClickHandler onPlace={(clickLat, clickLng) => {
              set('latitude', clickLat)
              set('longitude', clickLng)
            }} />
            {hasCoords && (
              <CircleMarker
                center={[form.latitude as number, form.longitude as number]}
                radius={10}
                pathOptions={{ color: colors.tertiary, fillColor: colors.tertiary, fillOpacity: 1 }}
              />
            )}
          </MapContainer>
        </div>
        <div style={gridTwo}>
          <div>
            <FieldLabel>Latitud</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              step="any"
              value={form.latitude ?? ''}
              onChange={e => set('latitude', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <FieldLabel>Longitud</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              step="any"
              value={form.longitude ?? ''}
              onChange={e => set('longitude', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
      </Section>

      {/* ── Tamaño ──────────────────────────────────────────────────── */}
      <Section title="Tamaño">
        <div style={gridTwo}>
          <div>
            <FieldLabel>m² Terreno</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              value={form.sqmLand ?? ''}
              onChange={e => set('sqmLand', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <FieldLabel>m² Construcción</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              value={form.sqmConstruction ?? ''}
              onChange={e => set('sqmConstruction', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
      </Section>

      {/* ── Costos de adquisición ───────────────────────────────────── */}
      <Section title="Costos de adquisición">
        <div style={{ ...gridTwo, marginBottom: '16px' }}>
          <div>
            <FieldLabel>Precio terreno (MXN)</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              value={form.landPrice ?? ''}
              onChange={e => set('landPrice', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <FieldLabel>Costo adquisición (%)</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              step="0.1"
              value={form.acquisitionCostPct !== undefined ? +(form.acquisitionCostPct * 100).toFixed(4) : ''}
              onChange={e => { const v = parseFloat(e.target.value); setForm(prev => ({ ...prev, acquisitionCostPct: isNaN(v) ? undefined : v / 100 })) }}
            />
          </div>
        </div>
        <div style={gridTwo}>
          <div>
            <FieldLabel>Permisos (MXN)</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              value={form.permitsCost ?? ''}
              onChange={e => set('permitsCost', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <FieldLabel>Subdivisión (MXN)</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              value={form.subdivisionCost ?? ''}
              onChange={e => set('subdivisionCost', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
      </Section>

      {/* ── Construcción ────────────────────────────────────────────── */}
      <Section title="Construcción">
        <div style={gridTwo}>
          <div>
            <FieldLabel>Costo/m² construcción (MXN)</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              value={form.constructionCostPerSqm ?? ''}
              onChange={e => set('constructionCostPerSqm', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <FieldLabel>Overhead (factor, ej. 1.15)</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              step="0.01"
              value={form.constructionOverhead ?? ''}
              onChange={e => { const v = parseFloat(e.target.value); setForm(prev => ({ ...prev, constructionOverhead: isNaN(v) ? undefined : v })) }}
            />
          </div>
        </div>
      </Section>

      {/* ── Proyección ──────────────────────────────────────────────── */}
      <Section title="Proyección">
        <div style={{ ...gridTwo, marginBottom: '16px' }}>
          <div>
            <FieldLabel>Venta proyectada (MXN)</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              value={form.projectedSale ?? ''}
              onChange={e => set('projectedSale', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <FieldLabel>Renta mensual (MXN)</FieldLabel>
            <input
              style={inputStyle}
              type="number"
              value={form.rentMonthly ?? ''}
              onChange={e => set('rentMonthly', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
        <div style={gridTwo}>
          <div>
            <FieldLabel>Fecha de inversión</FieldLabel>
            <input
              style={inputStyle}
              type="date"
              value={form.investmentDate ?? ''}
              onChange={e => set('investmentDate', e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Fecha de venta</FieldLabel>
            <input
              style={inputStyle}
              type="date"
              value={form.saleDate ?? ''}
              onChange={e => set('saleDate', e.target.value)}
            />
          </div>
        </div>
      </Section>

      {/* ── Notas ───────────────────────────────────────────────────── */}
      <Section title="Notas">
        <textarea
          style={{
            ...inputStyle,
            resize: 'vertical',
            minHeight: '96px',
            borderBottom: 'none',
            border: `1px solid ${colors.border}`,
            padding: '8px',
          }}
          value={form.notes ?? ''}
          onChange={e => set('notes', e.target.value)}
        />
      </Section>

      {/* ── Validation issues ────────────────────────────────────────── */}
      {issues.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          {issues.map((issue, i) => (
            <div
              key={i}
              style={{
                fontFamily: fonts.sans,
                fontSize: '12px',
                color: issue.severity === 'error' ? '#ef4444' : '#f59e0b',
                padding: '4px 0',
              }}
            >
              {issue.severity === 'error' ? '✕' : '△'} <strong>{issue.field}</strong>: {issue.message}
            </div>
          ))}
        </div>
      )}

      {/* ── Save error ───────────────────────────────────────────────── */}
      {saveError && (
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: '#ef4444', marginBottom: '12px' }}>
          {saveError}
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={() => onSave(form as RawFields)}
          disabled={hasErrors || saving}
          style={{
            background: hasErrors || saving ? colors.border : colors.primary,
            color: colors.neutral,
            border: 'none',
            cursor: hasErrors || saving ? 'not-allowed' : 'pointer',
            fontFamily: fonts.label,
            fontSize: '11px',
            letterSpacing: '0.1em',
            padding: '10px 24px',
            opacity: hasErrors || saving ? 0.6 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {saving ? 'Guardando…' : 'GUARDAR'}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              color: colors.secondary,
              border: `1px solid ${colors.border}`,
              cursor: 'pointer',
              fontFamily: fonts.label,
              fontSize: '11px',
              letterSpacing: '0.1em',
              padding: '10px 24px',
            }}
          >
            CANCELAR
          </button>
        )}
      </div>
    </div>
  )
}
