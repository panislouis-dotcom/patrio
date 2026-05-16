import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import { fetchProspect, updateProspect, createProspect, deleteProspect, createProject } from '../lib/api'
import type { Prospect, RawFields } from '../lib/types'
import { PROPERTY_TYPES } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import { fmtMXN } from '../lib/fmt'
import { ProspectForm } from './ProspectForm'
import { ProspectAnalysisSection } from './ProspectAnalysisSection'
import { PROSPECT_STATUS_COLOR, PROSPECT_STATUS_LABEL } from '../lib/status'

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


export function ProspectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === 'nuevo'

  const [prospect, setProspect] = useState<Prospect | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving]               = useState(false)
  const [saveError, setSaveError]         = useState<string | null>(null)
  const [edits, setEdits]                 = useState<Partial<RawFields>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [convertModal, setConvertModal]   = useState(false)
  const [converting, setConverting]       = useState(false)
  const [convertError, setConvertError]   = useState<string | null>(null)
  const [convertFields, setConvertFields] = useState({
    type: '',
    totalUnits: 1,
    acquisitionDate: '', conclusionDate: '',
    currentValuation: 0, valuationDate: '',
    status: 'activo',
  })
  const [mounted, setMounted] = useState(false)
  const [barsReady, setBarsReady] = useState(false)

  useEffect(() => {
    if (isNew) { setLoading(false); return }
    fetchProspect(Number(id))
      .then(p => {
        setProspect(p)
        setTimeout(() => setMounted(true), 40)
        setTimeout(() => setBarsReady(true), 420)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, isNew])

  async function handleFormSave(data: RawFields) {
    setSaving(true)
    setSaveError(null)
    try {
      const result = await createProspect(data)
      navigate(`/prospectos/tabla/${result.id}`, { replace: true })
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
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  function handleEdit(key: keyof RawFields, raw: string, inputType: 'number' | 'text', isAcqPct = false) {
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

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteProspect(Number(id))
      navigate('/prospectos/tabla')
    } catch {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  function openConvertModal(p: Prospect) {
    const now = new Date()
    const yyyymm = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const currentMonth = yyyymm(now)
    const concDate = new Date(now.getFullYear(), now.getMonth() + (p.holdMonths || 12), 1)
    setConvertFields({
      type: p.type || '',
      totalUnits: 1,
      acquisitionDate: currentMonth,
      conclusionDate: yyyymm(concDate),
      currentValuation: p.projectedSale || 0,
      valuationDate: currentMonth,
      status: 'activo',
    })
    setConvertError(null)
    setConvertModal(true)
  }

  async function handleConvert() {
    const p = prospect!
    setConverting(true)
    setConvertError(null)
    try {
      const project = await createProject({
        name: p.name,
        address: p.address,
        city: p.city,
        url: p.url || 'https://refigan.mx',
        latitude: p.latitude,
        longitude: p.longitude,
        notes: p.notes || '-',
        totalInvestment: p.acquisitionTotal,
        prospectId: p.id,
        ...convertFields,
      })
      await deleteProspect(p.id)
      navigate(`/proyectos/${project.id}`)
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : 'Error al crear proyecto')
      setConverting(false)
    }
  }

  function cv(key: keyof RawFields, isAcqPct = false): string {
    if (edits[key] !== undefined) {
      const v = edits[key] as number | string
      if (isAcqPct && typeof v === 'number') return (v * 100).toFixed(1)
      return String(v)
    }
    const raw = prospect![key]
    if (isAcqPct && typeof raw === 'number') return (raw * 100).toFixed(1)
    return raw != null ? String(raw) : ''
  }

  const fade = (delay = 0): React.CSSProperties => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(12px)',
    transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
  })

  if (!isNew && loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 49px)', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
        Cargando…
      </div>
    )
  }
  if (!isNew && (error || !prospect)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 49px)', color: 'tomato', fontFamily: fonts.sans, fontSize: '13px' }}>
        {error ?? 'No encontrado'}
      </div>
    )
  }

  if (isNew) {
    return (
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
          <button
            onClick={() => navigate('/prospectos/tabla')}
            style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '11px', letterSpacing: '0.1em', padding: 0 }}
          >
            ← PROSPECTOS
          </button>
        </div>
        <ProspectForm initial={DEFAULT_PROSPECT} onSave={handleFormSave} onCancel={undefined} saving={saving} saveError={saveError} />
      </div>
    )
  }

  const p = prospect!
  const hasCoords = p.latitude !== 0 && p.longitude !== 0
  const roi = p.roi ?? null
  const roiColor = roi != null && roi > 0.5 ? colors.primary : roi != null && roi > 0.25 ? colors.tertiary : '#c0392b'
  const hasEdits = Object.keys(edits).length > 0
  const errors = p.issues.filter(i => i.severity === 'error')
  const warnings = p.issues.filter(i => i.severity === 'warning')

  const divider = (label: string) => (
    <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, padding: '12px 0 6px', borderBottom: `1px solid ${colors.border}`, marginBottom: '8px', marginTop: '4px' }}>
      {label}
    </div>
  )

  const stat = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary }}>{label}</span>
      <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{value}</span>
    </div>
  )

  const investmentItems = [
    { label: 'Precio terreno', amount: p.landPrice },
    { label: 'Costos adq.', amount: p.acquisitionCosts },
    { label: 'Permisos', amount: p.permitsCost },
    { label: 'Subdivisión', amount: p.subdivisionCost },
    { label: 'Construcción', amount: p.constructionTotal },
  ].filter(item => item.amount > 0)

  const barColors = [colors.primary, '#654F6F', '#5C5D8D', colors.tertiary, colors.secondary]

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: colors.dark }}>

      {/* ── HEADER ── */}
      <div style={{
        ...fade(0),
        flexShrink: 0,
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '0 24px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.dark,
      }}>
        <button
          onClick={() => navigate('/prospectos/tabla')}
          style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: 0, flexShrink: 0 }}
        >
          ← PROSPECTOS
        </button>
        <span style={{ color: colors.border }}>·</span>
        <span style={{ fontFamily: fonts.serif, fontSize: '20px', color: colors.neutral, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.name}
        </span>
        <span style={{
          fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.12em',
          padding: '3px 10px', flexShrink: 0,
          background: PROSPECT_STATUS_COLOR[p.status] ?? colors.border,
          color: colors.neutral,
        }}>
          {PROSPECT_STATUS_LABEL[p.status] ?? p.status.toUpperCase()}
        </span>
        <button
          onClick={() => openConvertModal(p)}
          style={{ background: 'none', border: `1px solid ${colors.primary}`, color: colors.primary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '5px 12px', flexShrink: 0 }}
        >
          CONVERTIR ▸ PROYECTO
        </button>
        {confirmDelete ? (
          <>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{ background: 'none', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '5px 12px', flexShrink: 0 }}
            >
              CANCELAR
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{ background: '#c0392b', border: 'none', color: '#fff', cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '6px 16px', opacity: deleting ? 0.7 : 1, flexShrink: 0 }}
            >
              {deleting ? 'BORRANDO…' : '¿CONFIRMAR BORRADO?'}
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            style={{ background: 'none', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '5px 12px', flexShrink: 0 }}
          >
            ELIMINAR
          </button>
        )}
        {hasEdits && (
          <button
            onClick={handleInlineSave}
            disabled={saving}
            style={{
              background: colors.primary, border: 'none', color: colors.neutral,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em',
              padding: '6px 16px', opacity: saving ? 0.7 : 1,
              transition: 'opacity 0.2s', flexShrink: 0,
            }}
          >
            {saving ? 'GUARDANDO…' : 'GUARDAR ▸'}
          </button>
        )}
      </div>

      {/* ── MAIN 3-COLUMN GRID ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '290px 1fr 310px', overflow: 'hidden' }}>

        {/* ── LEFT: Métricas + Edición ── */}
        <div style={{
          ...fade(80),
          borderRight: `1px solid ${colors.border}`,
          overflowY: 'auto',
          padding: '20px',
          scrollbarWidth: 'none',
        }}>
          {/* Hero ROI */}
          <div style={{ paddingBottom: '16px', borderBottom: `1px solid ${colors.border}`, marginBottom: '4px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '10px' }}>ROI ANUAL</div>
            <div style={{ fontFamily: fonts.serif, fontSize: '42px', color: roi != null ? roiColor : colors.secondary, lineHeight: 1 }}>
              {roi != null ? `${roi > 0 ? '+' : ''}${(roi * 100).toFixed(1)}%` : '—'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
              <div style={{ flex: 1, height: '3px', background: colors.border, borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: barsReady && roi != null ? `${Math.min(100, Math.max(0, roi * 100))}%` : '0%',
                  background: roiColor,
                  transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
                }} />
              </div>
              <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, flexShrink: 0 }}>
                Score {p.score ?? '—'}
              </span>
            </div>
          </div>

          {stat('PROFIT', fmtMXN(p.profit))}
          {stat('CAP RATE', p.capRate > 0 ? `${(p.capRate * 100).toFixed(1)}%` : '—')}
          {stat('INVERSIÓN', fmtMXN(p.totalInvestment))}
          {stat('VENTA', fmtMXN(p.projectedSale))}
          {p.holdMonths > 0 ? stat('PLAZO', `${p.holdMonths} meses`) : null}
          {p.rentMonthly > 0 ? stat('RENTA/MES', fmtMXN(p.rentMonthly)) : null}
          {stat('TERRENO', `${p.sqmLand} m²`)}
          {stat('CONSTRUCCIÓN', `${p.sqmConstruction} m²`)}

          {divider('UBICACIÓN')}
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginBottom: '2px' }}>{p.address || '—'}</div>
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>{p.city}</div>

          {divider('EDITAR')}
          {([
            { key: 'name', label: 'Nombre', type: 'text' },
            { key: 'address', label: 'Dirección', type: 'text' },
            { key: 'city', label: 'Ciudad', type: 'text' },
            { key: 'url', label: 'URL', type: 'text' },
          ] as const).map(({ key, label, type }) => (
            <div key={key} style={{ marginBottom: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>{label.toUpperCase()}</div>
              <input value={cv(key)} onChange={e => handleEdit(key, e.target.value, 'text')} type={type} style={fieldInput} />
            </div>
          ))}

          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>TIPO</div>
            <select
              value={(edits.type as string) ?? p.type ?? ''}
              onChange={e => setEdits(prev => ({ ...prev, type: e.target.value }))}
              style={{ ...fieldInput, cursor: 'pointer' }}
            >
              <option value="">— sin tipo —</option>
              {PROPERTY_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>ESTADO</div>
            <select
              value={(edits.status as string) ?? p.status}
              onChange={e => setEdits(prev => ({ ...prev, status: e.target.value }))}
              style={{ ...fieldInput, cursor: 'pointer' }}
            >
              {Object.entries(PROSPECT_STATUS_LABEL).map(([val, lbl]) => (
                <option key={val} value={val}>{lbl}</option>
              ))}
            </select>
          </div>

          {([
            { key: 'landPrice', label: 'Precio terreno ($)' },
            { key: 'permitsCost', label: 'Permisos ($)' },
            { key: 'subdivisionCost', label: 'Subdivisión ($)' },
            { key: 'sqmLand', label: 'm² Terreno' },
            { key: 'sqmConstruction', label: 'm² Construcción' },
            { key: 'constructionCostPerSqm', label: 'Costo/m² ($)' },
            { key: 'projectedSale', label: 'Venta proyectada ($)' },
            { key: 'rentMonthly', label: 'Renta mensual ($)' },
            { key: 'holdMonths', label: 'Plazo (meses)' },
          ] as const).map(({ key, label }) => (
            <div key={key} style={{ marginBottom: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>{label.toUpperCase()}</div>
              <input value={cv(key)} onChange={e => handleEdit(key, e.target.value, 'number')} type="number" style={fieldInput} />
            </div>
          ))}

          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>COSTOS ADQ. (%)</div>
            <input value={cv('acquisitionCostPct', true)} onChange={e => handleEdit('acquisitionCostPct', e.target.value, 'number', true)} type="number" step="0.1" style={fieldInput} />
          </div>

          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>OVERHEAD CONSTRUCCIÓN</div>
            <input value={cv('constructionOverhead')} onChange={e => handleEdit('constructionOverhead', e.target.value, 'number')} type="number" step="0.01" style={fieldInput} />
          </div>

          {([
            { key: 'latitude', label: 'Latitud' },
            { key: 'longitude', label: 'Longitud' },
          ] as const).map(({ key, label }) => (
            <div key={key} style={{ marginBottom: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>{label.toUpperCase()}</div>
              <input value={cv(key)} onChange={e => handleEdit(key, e.target.value, 'number')} type="number" step="any" style={fieldInput} />
            </div>
          ))}

          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>NOTAS</div>
            <textarea value={cv('notes')} onChange={e => handleEdit('notes', e.target.value, 'text')} rows={3} style={{ ...fieldInput, resize: 'vertical' }} />
          </div>

          {saveError && (
            <div style={{ color: colors.tertiary, fontFamily: fonts.sans, fontSize: '11px', marginTop: '8px' }}>{saveError}</div>
          )}
        </div>

        {/* ── CENTER: Mapa ── */}
        <div style={{ ...fade(160), position: 'relative', overflow: 'hidden' }}>
          {hasCoords ? (
            <MapContainer
              center={[p.latitude, p.longitude]}
              zoom={15}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={false}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              />
              <CircleMarker
                center={[p.latitude, p.longitude]}
                radius={12}
                pathOptions={{ color: roiColor, fillColor: roiColor, fillOpacity: 0.7, weight: 2 }}
              />
            </MapContainer>
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.border }}>SIN COORDENADAS</div>
              <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Agrega lat/lng en el panel izquierdo</div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Inversión + Calidad + Notas ── */}
        <div style={{
          ...fade(240),
          borderLeft: `1px solid ${colors.border}`,
          overflowY: 'auto',
          padding: '20px',
          scrollbarWidth: 'none',
        }}>
          {/* Investment breakdown bars */}
          {investmentItems.length > 0 && (
            <>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '6px' }}>INVERSIÓN TOTAL</div>
              <div style={{ fontFamily: fonts.serif, fontSize: '28px', color: colors.neutral, marginBottom: '20px' }}>{fmtMXN(p.totalInvestment)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {investmentItems.map(({ label, amount }, i) => {
                  const pct = p.totalInvestment > 0 ? (amount / p.totalInvestment) * 100 : 0
                  return (
                    <div key={label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>
                          {label.toUpperCase()}
                        </span>
                        <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{fmtMXN(amount)}</span>
                      </div>
                      <div style={{ height: '3px', background: colors.border, borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: barsReady ? `${pct}%` : '0%',
                          background: barColors[i % barColors.length],
                          borderRadius: '2px',
                          transition: `width 0.9s cubic-bezier(0.4, 0, 0.2, 1) ${i * 70}ms`,
                        }} />
                      </div>
                      <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.border, marginTop: '3px', textAlign: 'right' }}>
                        {pct.toFixed(0)}%
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Venta + Profit summary */}
          <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: `1px solid ${colors.border}` }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>VENTA PROYECTADA</span>
                <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{fmtMXN(p.projectedSale)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>PROFIT</span>
                <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: (roi ?? 0) > 0 ? colors.primary : colors.secondary }}>{fmtMXN(p.profit)}</span>
              </div>
            </div>
          </div>

          {/* Data quality issues */}
          {(errors.length > 0 || warnings.length > 0) && (
            <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: `1px solid ${colors.border}` }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '12px' }}>CALIDAD DE DATOS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[...errors, ...warnings].map((issue, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: '8px', padding: '8px',
                    background: colors.surfaceAlt,
                    border: `1px solid ${issue.severity === 'error' ? '#c0392b44' : colors.border}`,
                  }}>
                    <span style={{ fontSize: '11px', flexShrink: 0 }}>{issue.severity === 'error' ? '🔴' : '⚠️'}</span>
                    <div>
                      <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>{issue.field.toUpperCase()}</div>
                      <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: issue.severity === 'error' ? colors.neutral : colors.secondary, marginTop: '2px' }}>{issue.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {p.notes && p.notes !== '-' && (
            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${colors.border}` }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '8px' }}>NOTAS</div>
              <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>{p.notes}</div>
            </div>
          )}

          {/* URL */}
          {p.url && (
            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${colors.border}` }}>
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary, textDecoration: 'none' }}
              >
                VER FUENTE ↗
              </a>
            </div>
          )}

          {/* Analysis section */}
          <ProspectAnalysisSection prospectId={p.id} />
        </div>
      </div>

      {/* ── CONVERT MODAL ── */}
      {convertModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: colors.dark, border: `1px solid ${colors.border}`,
            padding: '28px', width: '340px', display: 'flex', flexDirection: 'column', gap: '12px',
          }}>
            <div style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '4px' }}>
              CONVERTIR A PROYECTO — {p.name}
            </div>

            <div>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '3px' }}>TIPO</div>
              <select
                value={convertFields.type}
                onChange={e => setConvertFields(prev => ({ ...prev, type: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', background: colors.surfaceAlt, border: `1px solid ${colors.border}`, color: convertFields.type ? colors.neutral : colors.secondary, fontFamily: fonts.sans, fontSize: '12px', padding: '6px 10px', outline: 'none', cursor: 'pointer' }}
              >
                <option value="">— seleccionar tipo —</option>
                {PROPERTY_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {([
              { key: 'acquisitionDate', label: 'Fecha adquisición',     inputType: 'text', placeholder: 'YYYY-MM' },
              { key: 'conclusionDate',  label: 'Fecha conclusión',      inputType: 'text', placeholder: 'YYYY-MM' },
              { key: 'valuationDate',   label: 'Fecha valuación',       inputType: 'text', placeholder: 'YYYY-MM' },
            ] as const).map(({ key, label, inputType, placeholder }) => (
              <div key={key}>
                <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '3px' }}>{label.toUpperCase()}</div>
                <input
                  value={convertFields[key]}
                  placeholder={placeholder}
                  onChange={e => setConvertFields(prev => ({ ...prev, [key]: e.target.value }))}
                  type={inputType}
                  style={{ width: '100%', boxSizing: 'border-box', background: colors.surfaceAlt, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', padding: '6px 10px', outline: 'none' }}
                />
              </div>
            ))}

            <div>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '3px' }}>UNIDADES</div>
              <input
                value={convertFields.totalUnits}
                onChange={e => setConvertFields(prev => ({ ...prev, totalUnits: Number(e.target.value) || 1 }))}
                type="number" min="1"
                style={{ width: '100%', boxSizing: 'border-box', background: colors.surfaceAlt, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', padding: '6px 10px', outline: 'none' }}
              />
            </div>

            <div>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '3px' }}>VALUACIÓN ACTUAL ($)</div>
              <input
                value={convertFields.currentValuation}
                onChange={e => setConvertFields(prev => ({ ...prev, currentValuation: parseFloat(e.target.value) || 0 }))}
                type="number"
                style={{ width: '100%', boxSizing: 'border-box', background: colors.surfaceAlt, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', padding: '6px 10px', outline: 'none' }}
              />
            </div>

            <div>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '3px' }}>ESTADO</div>
              <select
                value={convertFields.status}
                onChange={e => setConvertFields(prev => ({ ...prev, status: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', background: colors.surfaceAlt, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', padding: '6px 10px', outline: 'none', cursor: 'pointer' }}
              >
                <option value="activo">Activo</option>
                <option value="en_proceso">En proceso</option>
                <option value="pausado">Pausado</option>
                <option value="concluido">Concluido</option>
              </select>
            </div>

            {convertError && (
              <div style={{ color: '#c0392b', fontFamily: fonts.sans, fontSize: '11px' }}>{convertError}</div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              <button
                onClick={() => setConvertModal(false)}
                style={{ flex: 1, background: 'none', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '8px' }}
              >
                CANCELAR
              </button>
              <button
                onClick={handleConvert}
                disabled={converting || !convertFields.type}
                style={{ flex: 2, background: colors.primary, border: 'none', color: colors.neutral, cursor: converting || !convertFields.type ? 'not-allowed' : 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '8px', opacity: converting || !convertFields.type ? 0.6 : 1 }}
              >
                {converting ? 'CREANDO…' : 'CREAR PROYECTO ▸'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
