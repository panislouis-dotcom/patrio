import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { fetchProspect, updateProspect, createProspect } from '../lib/api'
import type { Prospect, RawFields } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { ProspectForm } from './ProspectForm'
import { EditableRow, rowStyle } from './EditableRow'

export const DEFAULT_PROSPECT: Partial<RawFields> = {
  city: 'Monterrey',
  status: 'evaluating',
  acquisitionCostPct: 0.065,
  constructionOverhead: 1.3,
  latitude: 0,
  longitude: 0,
  sqmLand: 0,
  sqmConstruction: 0,
  landPrice: 0,
  permitsCost: 0,
  subdivisionCost: 0,
  constructionCostPerSqm: 0,
  projectedSale: 0,
  rentMonthly: 0,
  holdMonths: 12,
  notes: '',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px', borderBottom: `1px solid ${colors.border}`, paddingBottom: '8px' }}>{title}</div>
      {children}
    </section>
  )
}

function Hero({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: fonts.serif, fontSize: '36px', color: colors.tertiary, lineHeight: 1 }}>{value}</div>
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

function fmt(n: number, type: 'pct' | 'mxn') {
  if (!n) return '—'
  if (type === 'pct') return `${(n * 100).toFixed(1)}%`
  return `$${n.toLocaleString('es-MX')} MXN`
}


export function ProspectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === 'nuevo'

  const [prospect, setProspect] = useState<Prospect | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [activeField, setActiveField] = useState<string | null>(null)
  const [edits, setEdits] = useState<Partial<RawFields>>({})

  useEffect(() => {
    if (isNew) {
      setLoading(false)
      return
    }
    fetchProspect(Number(id))
      .then(setProspect)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, isNew])

  async function handleFormSave(data: RawFields) {
    setSaving(true)
    setSaveError(null)
    try {
      const result = await createProspect(data)
      navigate(`/tabla/${result.id}`, { replace: true })
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleInlineSave() {
    if (Object.keys(edits).length === 0 || !prospect) return
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateProspect(Number(id), edits)
      setProspect(updated)
      setEdits({})
      setActiveField(null)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  function handleEdit(key: keyof RawFields, raw: string, inputType: 'number' | 'date' | 'text', isAcqPct = false) {
    let value: string | number | undefined
    if (inputType === 'number') {
      if (raw === '') { value = undefined }
      else { const parsed = parseFloat(raw); value = isAcqPct ? parsed / 100 : parsed }
    } else { value = raw }
    setEdits(prev => {
      const next = { ...prev }
      if (value === undefined) { delete (next as Record<string, unknown>)[key as string] }
      else { (next as Record<string, unknown>)[key as string] = value }
      return next
    })
  }

  function currentEditValue(key: keyof RawFields, isAcqPct = false): string {
    if (edits[key] !== undefined) {
      const v = edits[key] as number | string
      if (isAcqPct && typeof v === 'number') return (v * 100).toFixed(1)
      return String(v)
    }
    const raw = prospect![key]
    if (isAcqPct && typeof raw === 'number') return (raw * 100).toFixed(1)
    return raw != null ? String(raw) : ''
  }

  if (!isNew && loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>
  if (!isNew && (error || !prospect)) return <div style={{ padding: '32px', color: 'tomato' }}>{error ?? 'No encontrado'}</div>

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
      <button
        onClick={() => navigate('/tabla')}
        style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '11px', letterSpacing: '0.1em', padding: 0 }}
      >
        ← PROSPECTOS
      </button>
    </div>
  )

  if (isNew) {
    return (
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>
        {header}
        <ProspectForm
          initial={DEFAULT_PROSPECT}
          onSave={handleFormSave}
          onCancel={undefined}
          saving={saving}
          saveError={saveError}
        />
      </div>
    )
  }

  // Read-only view with inline editing — prospect is guaranteed non-null here
  const p = prospect!
  const hasCoords = p.latitude !== 0 && p.longitude !== 0
  const errors = p.issues.filter(i => i.severity === 'error')
  const warnings = p.issues.filter(i => i.severity === 'warning')
  const issueMap = Object.fromEntries(p.issues.map(i => [i.field, i]))
  function badge(field: string) {
    const issue = issueMap[field]
    return issue ? (issue.severity === 'error' ? ' 🔴' : ' ⚠️') : ''
  }

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>
      {header}

      <h1 style={{ fontFamily: fonts.serif, fontSize: '28px', color: colors.neutral, marginBottom: '8px' }}>{p.name}</h1>
      <div style={{ fontFamily: fonts.sans, fontSize: '13px', color: colors.secondary, marginBottom: '32px' }}>{p.address} · {p.sqmLand} m²</div>

      <Section title="Métricas clave">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', background: colors.surfaceAlt, padding: '24px', borderRadius: '2px' }}>
          <Hero label="ROI" value={fmt(p.roi, 'pct')} />
          <Hero label="Profit" value={`$${(p.profit / 1_000_000).toFixed(1)}M`} />
          <Hero label="Cap Rate" value={fmt(p.capRate, 'pct')} />
          <Hero label="Score" value={String(p.score ?? '—')} />
        </div>
      </Section>

      <Section title="Desglose de inversión">
        <Row label="Precio terreno" value={fmt(p.landPrice, 'mxn')} />
        <Row label={`Costos adquisición (${(p.acquisitionCostPct * 100).toFixed(1)}%)`} value={fmt(p.acquisitionCosts, 'mxn')} />
        <Row label="Permisos" value={fmt(p.permitsCost, 'mxn')} />
        <Row label="Subdivisión" value={fmt(p.subdivisionCost, 'mxn')} />
        <Row label={`Construcción (${p.constructionCostPerSqm?.toLocaleString('es-MX')}/m² × ${p.sqmConstruction} m²)`} value={fmt(p.constructionBase, 'mxn')} />
        <Row label={`+ IVA/indirectos (×${p.constructionOverhead})`} value={fmt(p.constructionTotal, 'mxn')} />
        <Row label="INVERSIÓN TOTAL" value={fmt(p.totalInvestment, 'mxn')} bold />
        <Row label="Venta proyectada" value={fmt(p.projectedSale, 'mxn')} />
        <Row label="PROFIT" value={fmt(p.profit, 'mxn')} bold />
      </Section>

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

      {p.holdMonths > 0 && (
        <Section title="Plazo">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontFamily: fonts.sans, fontSize: '13px' }}>
            <span style={{ flex: 1, borderTop: `1px solid ${colors.tertiary}`, position: 'relative' }}>
              <span style={{ position: 'absolute', top: '-18px', left: '50%', transform: 'translateX(-50%)', fontFamily: fonts.label, fontSize: '10px', color: colors.tertiary, whiteSpace: 'nowrap' }}>{p.holdMonths} meses</span>
            </span>
          </div>
        </Section>
      )}

      {(errors.length > 0 || warnings.length > 0) && (
        <Section title="Calidad de datos">
          {errors.map((issue, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontSize: '13px' }}>
              <span>🔴</span>
              <div>
                <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{issue.field}</span>
                <div style={{ color: colors.neutral, marginTop: '2px' }}>{issue.message}</div>
              </div>
            </div>
          ))}
          {warnings.map((issue, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontSize: '13px' }}>
              <span>⚠️</span>
              <div>
                <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{issue.field}</span>
                <div style={{ color: colors.secondary, marginTop: '2px' }}>{issue.message}</div>
              </div>
            </div>
          ))}
        </Section>
      )}

      <Section title="Campos">
        {/* General */}
        <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', marginTop: '8px' }}>General</div>
        <EditableRow fieldKey="name" label={`Nombre${badge('name')}`} displayValue={p.name || '—'} isActive={activeField === 'name'} inputType="text" inputValue={currentEditValue('name')} onActivate={() => setActiveField('name')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('name', r, 'text')} />
        <EditableRow fieldKey="address" label={`Dirección${badge('address')}`} displayValue={p.address || '—'} isActive={activeField === 'address'} inputType="text" inputValue={currentEditValue('address')} onActivate={() => setActiveField('address')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('address', r, 'text')} />
        <EditableRow fieldKey="city" label={`Ciudad${badge('city')}`} displayValue={p.city || '—'} isActive={activeField === 'city'} inputType="text" inputValue={currentEditValue('city')} onActivate={() => setActiveField('city')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('city', r, 'text')} />

        {/* Status — select, handle inline */}
        <div style={rowStyle}>
          <span style={{ color: colors.secondary }}>Estado{badge('status')}</span>
          {activeField === 'status' ? (
            <select
              value={(edits.status as string) ?? p.status}
              autoFocus
              onChange={e => setEdits(prev => ({ ...prev, status: e.target.value }))}
              onBlur={() => setActiveField(null)}
              onKeyDown={e => { if (e.key === 'Escape') setActiveField(null) }}
              style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${colors.tertiary}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '13px', padding: '2px 0', width: '140px', outline: 'none', textAlign: 'right', cursor: 'pointer' }}
            >
              <option value="evaluating">evaluating</option>
              <option value="passed">passed</option>
              <option value="converted">converted</option>
            </select>
          ) : (
            <span style={{ color: colors.neutral, cursor: 'text' }} onClick={() => setActiveField('status')}>{(edits.status as string) ?? p.status}</span>
          )}
        </div>

        <EditableRow fieldKey="url" label={`URL${badge('url')}`} displayValue={p.url || '—'} isActive={activeField === 'url'} inputType="text" inputValue={currentEditValue('url')} onActivate={() => setActiveField('url')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('url', r, 'text')} />

        {/* Tamaño */}
        <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', marginTop: '16px' }}>Tamaño</div>
        <EditableRow fieldKey="sqmLand" label={`m² Terreno${badge('sqmLand')}`} displayValue={p.sqmLand > 0 ? p.sqmLand.toLocaleString('es-MX') : '—'} isActive={activeField === 'sqmLand'} inputType="number" inputValue={currentEditValue('sqmLand')} onActivate={() => setActiveField('sqmLand')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('sqmLand', r, 'number')} />
        <EditableRow fieldKey="sqmConstruction" label={`m² Construcción${badge('sqmConstruction')}`} displayValue={p.sqmConstruction > 0 ? p.sqmConstruction.toLocaleString('es-MX') : '—'} isActive={activeField === 'sqmConstruction'} inputType="number" inputValue={currentEditValue('sqmConstruction')} onActivate={() => setActiveField('sqmConstruction')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('sqmConstruction', r, 'number')} />

        {/* Adquisición */}
        <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', marginTop: '16px' }}>Adquisición</div>
        <EditableRow fieldKey="landPrice" label={`Precio terreno${badge('landPrice')}`} displayValue={p.landPrice > 0 ? `$${p.landPrice.toLocaleString('es-MX')}` : '—'} isActive={activeField === 'landPrice'} inputType="number" inputValue={currentEditValue('landPrice')} onActivate={() => setActiveField('landPrice')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('landPrice', r, 'number')} />
        <EditableRow fieldKey="acquisitionCostPct" label={`Costos adquisición${badge('acquisitionCostPct')}`} displayValue={`${(p.acquisitionCostPct * 100).toFixed(1)}%`} isActive={activeField === 'acquisitionCostPct'} inputType="number" inputStep="0.1" inputValue={currentEditValue('acquisitionCostPct', true)} onActivate={() => setActiveField('acquisitionCostPct')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('acquisitionCostPct', r, 'number', true)} />
        <EditableRow fieldKey="permitsCost" label={`Permisos${badge('permitsCost')}`} displayValue={p.permitsCost > 0 ? `$${p.permitsCost.toLocaleString('es-MX')}` : '—'} isActive={activeField === 'permitsCost'} inputType="number" inputValue={currentEditValue('permitsCost')} onActivate={() => setActiveField('permitsCost')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('permitsCost', r, 'number')} />
        <EditableRow fieldKey="subdivisionCost" label={`Subdivisión${badge('subdivisionCost')}`} displayValue={p.subdivisionCost > 0 ? `$${p.subdivisionCost.toLocaleString('es-MX')}` : '—'} isActive={activeField === 'subdivisionCost'} inputType="number" inputValue={currentEditValue('subdivisionCost')} onActivate={() => setActiveField('subdivisionCost')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('subdivisionCost', r, 'number')} />

        {/* Construcción */}
        <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', marginTop: '16px' }}>Construcción</div>
        <EditableRow fieldKey="constructionCostPerSqm" label={`Costo/m²${badge('constructionCostPerSqm')}`} displayValue={p.constructionCostPerSqm > 0 ? `$${p.constructionCostPerSqm.toLocaleString('es-MX')}` : '—'} isActive={activeField === 'constructionCostPerSqm'} inputType="number" inputValue={currentEditValue('constructionCostPerSqm')} onActivate={() => setActiveField('constructionCostPerSqm')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('constructionCostPerSqm', r, 'number')} />
        <EditableRow fieldKey="constructionOverhead" label={`Overhead${badge('constructionOverhead')}`} displayValue={String(p.constructionOverhead)} isActive={activeField === 'constructionOverhead'} inputType="number" inputStep="0.01" inputValue={currentEditValue('constructionOverhead')} onActivate={() => setActiveField('constructionOverhead')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('constructionOverhead', r, 'number')} />

        {/* Proyección */}
        <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', marginTop: '16px' }}>Proyección</div>
        <EditableRow fieldKey="projectedSale" label={`Venta proyectada${badge('projectedSale')}`} displayValue={p.projectedSale > 0 ? `$${p.projectedSale.toLocaleString('es-MX')}` : '—'} isActive={activeField === 'projectedSale'} inputType="number" inputValue={currentEditValue('projectedSale')} onActivate={() => setActiveField('projectedSale')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('projectedSale', r, 'number')} />
        <EditableRow fieldKey="rentMonthly" label={`Renta mensual${badge('rentMonthly')}`} displayValue={p.rentMonthly > 0 ? `$${p.rentMonthly.toLocaleString('es-MX')}` : '—'} isActive={activeField === 'rentMonthly'} inputType="number" inputValue={currentEditValue('rentMonthly')} onActivate={() => setActiveField('rentMonthly')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('rentMonthly', r, 'number')} />
        <EditableRow fieldKey="holdMonths" label={`Plazo (meses)${badge('holdMonths')}`} displayValue={p.holdMonths > 0 ? `${p.holdMonths} meses` : '—'} isActive={activeField === 'holdMonths'} inputType="number" inputValue={currentEditValue('holdMonths')} onActivate={() => setActiveField('holdMonths')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('holdMonths', r, 'number')} />

        {/* Ubicación */}
        <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', marginTop: '16px' }}>Ubicación</div>
        <EditableRow fieldKey="latitude" label={`Latitud${badge('latitude')}`} displayValue={p.latitude !== 0 ? String(p.latitude) : '—'} isActive={activeField === 'latitude'} inputType="number" inputStep="any" inputValue={currentEditValue('latitude')} onActivate={() => setActiveField('latitude')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('latitude', r, 'number')} />
        <EditableRow fieldKey="longitude" label={`Longitud${badge('longitude')}`} displayValue={p.longitude !== 0 ? String(p.longitude) : '—'} isActive={activeField === 'longitude'} inputType="number" inputStep="any" inputValue={currentEditValue('longitude')} onActivate={() => setActiveField('longitude')} onDeactivate={() => setActiveField(null)} onChange={r => handleEdit('longitude', r, 'number')} />

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
