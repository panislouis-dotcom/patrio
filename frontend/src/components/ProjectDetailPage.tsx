import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { fetchProject, updateProject } from '../lib/api'
import type { Project, RawProjectFields } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { EditableRow, rowStyle } from './EditableRow'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px', borderBottom: `1px solid ${colors.border}`, paddingBottom: '8px' }}>{title}</div>
      {children}
    </section>
  )
}

function Hero({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: fonts.serif, fontSize: '36px', color: valueColor ?? colors.tertiary, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: '6px' }}>{label}</div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.sans, fontSize: '13px' }}>
      <span style={{ color: colors.secondary }}>{label}</span>
      <span style={{ color: colors.neutral, fontWeight: bold ? 600 : 400 }}>{value}</span>
    </div>
  )
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [activeField, setActiveField] = useState<string | null>(null)
  const [edits, setEdits] = useState<Partial<RawProjectFields>>({})

  useEffect(() => {
    fetchProject(Number(id))
      .then(setProject)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  async function handleInlineSave() {
    if (Object.keys(edits).length === 0 || !project) return
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateProject(Number(id), edits)
      setProject(updated)
      setEdits({})
      setActiveField(null)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  function handleEdit(key: keyof RawProjectFields, raw: string, inputType: 'number' | 'text') {
    const value = inputType === 'number' ? (raw === '' ? undefined : parseFloat(raw)) : raw
    setEdits(prev => {
      const next = { ...prev }
      if (value === undefined) { delete (next as Record<string, unknown>)[key] }
      else { (next as Record<string, unknown>)[key] = value }
      return next
    })
  }

  function currentEditValue(key: keyof RawProjectFields): string {
    if (edits[key] !== undefined) return String(edits[key])
    const raw = project![key]
    return raw != null ? String(raw) : ''
  }

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>
  if (error || !project) return <div style={{ padding: '32px', color: 'tomato' }}>{error ?? 'No encontrado'}</div>

  const p = project
  const hasCoords = p.latitude !== 0 && p.longitude !== 0
  const gainColor = p.unrealizedGain >= 0 ? colors.tertiary : 'tomato'

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <button
          onClick={() => navigate('/proyectos')}
          style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '11px', letterSpacing: '0.1em', padding: 0 }}
        >
          ← PROYECTOS
        </button>
      </div>

      <h1 style={{ fontFamily: fonts.serif, fontSize: '28px', color: colors.neutral, marginBottom: '8px' }}>{p.name}</h1>
      <div style={{ fontFamily: fonts.sans, fontSize: '13px', color: colors.secondary, marginBottom: '32px' }}>{p.address} · {p.city} · {p.type}</div>

      {/* Hero metrics */}
      <Section title="Métricas clave">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', background: colors.surfaceAlt, padding: '24px', borderRadius: '2px' }}>
          <Hero label="Inversión" value={p.totalInvestment ? `$${(p.totalInvestment / 1_000_000).toFixed(1)}M` : '—'} valueColor={colors.neutral} />
          <Hero label="Valoración" value={p.currentValuation ? `$${(p.currentValuation / 1_000_000).toFixed(1)}M` : '—'} valueColor={colors.neutral} />
          <Hero label="Ganancia" value={p.unrealizedGain ? `$${(p.unrealizedGain / 1_000_000).toFixed(1)}M` : '—'} valueColor={gainColor} />
          <Hero label="Ganancia%" value={p.unrealizedGainPct !== 0 ? `${(p.unrealizedGainPct * 100).toFixed(1)}%` : '—'} valueColor={gainColor} />
        </div>
      </Section>

      {/* Milestones timeline */}
      {p.milestones && Object.keys(p.milestones).length > 0 && (
        <Section title="Hitos">
          {Object.entries(p.milestones)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, label]) => (
              <div key={date} style={rowStyle}>
                <span style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '10px' }}>{date}</span>
                <span style={{ color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px' }}>{label}</span>
              </div>
            ))
          }
        </Section>
      )}

      {/* Budget breakdown */}
      {p.budget && Object.keys(p.budget).length > 0 && (
        <Section title="Presupuesto">
          {Object.entries(p.budget).map(([cat, amount]) => (
            <Row key={cat} label={cat} value={`$${amount.toLocaleString('es-MX')}`} />
          ))}
          <Row label="TOTAL" value={`$${Object.values(p.budget).reduce((s, v) => s + v, 0).toLocaleString('es-MX')}`} bold />
        </Section>
      )}

      {/* Map */}
      {hasCoords && (
        <Section title="Ubicación">
          <div style={{ height: '320px', borderRadius: '2px', overflow: 'hidden' }}>
            <MapContainer center={[p.latitude, p.longitude]} zoom={15} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
              <CircleMarker center={[p.latitude, p.longitude]} radius={10} pathOptions={{ color: colors.tertiary, fillColor: colors.tertiary, fillOpacity: 1 }}>
                <Popup>{p.name}</Popup>
              </CircleMarker>
            </MapContainer>
          </div>
        </Section>
      )}

      {/* Campos — click-to-edit */}
      <Section title="Campos">
        {/* General */}
        <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', marginTop: '8px' }}>General</div>
        <EditableRow fieldKey="name" label="Nombre" displayValue={p.name || '—'} isActive={activeField === 'name'} inputType="text" inputValue={currentEditValue('name')} onActivate={() => setActiveField('name')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('name', r, 'text')} />
        <EditableRow fieldKey="address" label="Dirección" displayValue={p.address || '—'} isActive={activeField === 'address'} inputType="text" inputValue={currentEditValue('address')} onActivate={() => setActiveField('address')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('address', r, 'text')} />
        <EditableRow fieldKey="city" label="Ciudad" displayValue={p.city || '—'} isActive={activeField === 'city'} inputType="text" inputValue={currentEditValue('city')} onActivate={() => setActiveField('city')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('city', r, 'text')} />
        <EditableRow fieldKey="url" label="URL" displayValue={p.url || '—'} isActive={activeField === 'url'} inputType="text" inputValue={currentEditValue('url')} onActivate={() => setActiveField('url')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('url', r, 'text')} />

        {/* Status — select inline */}
        <div style={rowStyle}>
          <span style={{ color: colors.secondary }}>Estado</span>
          {activeField === 'status' ? (
            <select
              value={(edits.status as string) ?? p.status}
              autoFocus
              onChange={e => setEdits(prev => ({ ...prev, status: e.target.value }))}
              onBlur={() => setActiveField(null)}
              onKeyDown={e => { if (e.key === 'Escape') setActiveField(null) }}
              style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${colors.tertiary}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '13px', padding: '2px 0', width: '140px', outline: 'none', textAlign: 'right', cursor: 'pointer' }}
            >
              <option value="construction">construction</option>
              <option value="stabilizing">stabilizing</option>
              <option value="operating">operating</option>
              <option value="exited">exited</option>
            </select>
          ) : (
            <span style={{ color: colors.neutral, cursor: 'text' }} onClick={() => setActiveField('status')}>{(edits.status as string) ?? p.status}</span>
          )}
        </div>

        {/* Detalle */}
        <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', marginTop: '16px' }}>Detalle</div>
        <EditableRow fieldKey="type" label="Tipo" displayValue={p.type || '—'} isActive={activeField === 'type'} inputType="text" inputValue={currentEditValue('type')} onActivate={() => setActiveField('type')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('type', r, 'text')} />
        <EditableRow fieldKey="totalUnits" label="Unidades totales" displayValue={p.totalUnits > 0 ? String(p.totalUnits) : '—'} isActive={activeField === 'totalUnits'} inputType="number" inputValue={currentEditValue('totalUnits')} onActivate={() => setActiveField('totalUnits')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('totalUnits', r, 'number')} />
        <EditableRow fieldKey="acquisitionDate" label="Fecha adquisición (YYYY-MM)" displayValue={p.acquisitionDate || '—'} isActive={activeField === 'acquisitionDate'} inputType="text" inputValue={currentEditValue('acquisitionDate')} onActivate={() => setActiveField('acquisitionDate')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('acquisitionDate', r, 'text')} />
        <EditableRow fieldKey="firstRentDate" label="Primera renta (YYYY-MM)" displayValue={p.firstRentDate || '—'} isActive={activeField === 'firstRentDate'} inputType="text" inputValue={currentEditValue('firstRentDate')} onActivate={() => setActiveField('firstRentDate')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('firstRentDate', r, 'text')} />
        <EditableRow fieldKey="valuationDate" label="Fecha valuación (YYYY-MM)" displayValue={p.valuationDate || '—'} isActive={activeField === 'valuationDate'} inputType="text" inputValue={currentEditValue('valuationDate')} onActivate={() => setActiveField('valuationDate')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('valuationDate', r, 'text')} />

        {/* Financiero */}
        <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', marginTop: '16px' }}>Financiero</div>
        <EditableRow fieldKey="totalInvestment" label="Inversión total" displayValue={p.totalInvestment > 0 ? `$${p.totalInvestment.toLocaleString('es-MX')}` : '—'} isActive={activeField === 'totalInvestment'} inputType="number" inputValue={currentEditValue('totalInvestment')} onActivate={() => setActiveField('totalInvestment')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('totalInvestment', r, 'number')} />
        <EditableRow fieldKey="currentValuation" label="Valoración actual" displayValue={p.currentValuation > 0 ? `$${p.currentValuation.toLocaleString('es-MX')}` : '—'} isActive={activeField === 'currentValuation'} inputType="number" inputValue={currentEditValue('currentValuation')} onActivate={() => setActiveField('currentValuation')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('currentValuation', r, 'number')} />

        {/* Ubicación */}
        <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', marginTop: '16px' }}>Ubicación</div>
        <EditableRow fieldKey="latitude" label="Latitud" displayValue={p.latitude !== 0 ? String(p.latitude) : '—'} isActive={activeField === 'latitude'} inputType="number" inputStep="any" inputValue={currentEditValue('latitude')} onActivate={() => setActiveField('latitude')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('latitude', r, 'number')} />
        <EditableRow fieldKey="longitude" label="Longitud" displayValue={p.longitude !== 0 ? String(p.longitude) : '—'} isActive={activeField === 'longitude'} inputType="number" inputStep="any" inputValue={currentEditValue('longitude')} onActivate={() => setActiveField('longitude')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('longitude', r, 'number')} />

        {/* Notas */}
        <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', marginTop: '16px' }}>Notas</div>
        <EditableRow fieldKey="notes" label="Notas" displayValue={p.notes && p.notes !== '-' ? p.notes : '—'} isActive={activeField === 'notes'} inputType="text" inputValue={currentEditValue('notes')} onActivate={() => setActiveField('notes')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('notes', r, 'text')} />
      </Section>

      {saveError && (
        <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: 'tomato', marginBottom: '12px' }}>{saveError}</div>
      )}
      {Object.keys(edits).length > 0 && (
        <button
          onClick={handleInlineSave}
          disabled={saving}
          style={{
            background: saving ? colors.border : colors.primary,
            color: colors.neutral,
            border: 'none',
            cursor: saving ? 'default' : 'pointer',
            fontFamily: fonts.label,
            fontSize: '11px',
            letterSpacing: '0.1em',
            padding: '10px 24px',
            opacity: saving ? 0.6 : 1,
            marginBottom: '32px',
          }}
        >
          {saving ? 'Guardando…' : 'GUARDAR CAMBIOS ▸'}
        </button>
      )}
    </div>
  )
}
