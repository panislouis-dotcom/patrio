import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BASE, fetchProspect, updateProspect, createProspect, deleteProspect, convertProspect, uploadProspectImage, deleteProspectImage, fetchProspectGeometry, saveProspectGeometry, uploadProspectFloorplanImage } from '../lib/api'
import type { Prospect, RawFields } from '../lib/types'
import { PROPERTY_TYPES } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import { fmtMXN, fmtPct } from '../lib/fmt'
import { MetricHero } from './finance/MetricHero'
import { InvestmentBreakdown } from './finance/InvestmentBreakdown'
import { LatLonPicker } from './LatLonPicker'
import { NumericInput } from './NumericInput'
import { ProspectForm } from './ProspectForm'
import { ProspectAnalysisSection } from './ProspectAnalysisSection'
import { PhotoGallery } from './PhotoGallery'
import FloorPlanEditor, { type PlanApi } from './FloorPlanEditor'
import type { FloorPlanModel } from '../lib/floorplan/types'
import { PROSPECT_STATUS_COLOR, PROSPECT_STATUS_LABEL, PROJECT_STATUS_LABEL } from '../lib/status'
import { useEdits } from '../lib/useEdits'
import { DetailHeader } from './detail/DetailHeader'
import { EditableRow } from './detail/EditableRow'
import { MapPanel } from './detail/MapPanel'
import { MediaTabs } from './detail/MediaTabs'
import { SectionDivider } from './detail/SectionDivider'
import { ErrorBanner } from './detail/ErrorBanner'

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

/**
 * Every prospect column is NOT NULL and the PATCH drops nulls (`exclude_none`),
 * so no row below may ever write `null`: emptying a box reverts the field to the
 * stored value (`setField(key, undefined)`), which is what NumericInput yields.
 */
type TextKey = { [K in keyof RawFields]-?: RawFields[K] extends string ? K : never }[keyof RawFields]
type NumKey = { [K in keyof RawFields]-?: RawFields[K] extends number ? K : never }[keyof RawFields]

export function ProspectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === 'nuevo'

  const [prospect, setProspect] = useState<Prospect | null>(null)
  const { edits, field, setField, hasEdits, clear } = useEdits<RawFields>(prospect)
  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving]               = useState(false)
  const [saveError, setSaveError]         = useState<string | null>(null)
  const [editing, setEditing]             = useState(false)
  const [convertModal, setConvertModal]   = useState(false)
  const [converting, setConverting]       = useState(false)
  const [convertError, setConvertError]   = useState<string | null>(null)
  const [convertFields, setConvertFields] = useState({
    type: '',
    totalUnits: 1,
    acquisitionDate: '', conclusionDate: '',
    currentValuation: 0, valuationDate: '',
    status: 'construction',
  })
  const [mounted, setMounted] = useState(false)
  const [barsReady, setBarsReady] = useState(false)
  const [leftTab, setLeftTab] = useState<'general' | 'analisis'>('general')
  const [geometry, setGeometry] = useState<FloorPlanModel | Record<string, never> | null>(null)
  const planApiRef = useRef<PlanApi | null>(null)
  const [planDirty, setPlanDirty] = useState(false)

  useEffect(() => {
    if (isNew) { setLoading(false); return }
    Promise.all([fetchProspect(Number(id)), fetchProspectGeometry(Number(id))])
      .then(([p, geo]) => {
        setProspect(p)
        setGeometry(geo)
        setTimeout(() => setMounted(true), 40)
        setTimeout(() => setBarsReady(true), 420)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, isNew])

  const onPlanReady = useCallback((api: PlanApi) => { planApiRef.current = api }, [])

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

  async function save() {
    if ((!hasEdits && !planApiRef.current?.isDirty()) || !prospect) return
    setSaving(true)
    setSaveError(null)
    try {
      if (hasEdits) {
        const updated = await updateProspect(Number(id), edits)
        setProspect(updated)
        clear()
      }
      if (planApiRef.current?.isDirty()) {
        const saved = await saveProspectGeometry(Number(id), planApiRef.current.getModel())
        setGeometry(saved)
        planApiRef.current.markSaved()
        setPlanDirty(false)
      }
      setEditing(false)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    await deleteProspect(Number(id))
    navigate('/prospectos/tabla')
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
      status: 'construction',
    })
    setConvertError(null)
    setConvertModal(true)
  }

  async function handleConvert() {
    const p = prospect!
    setConverting(true)
    setConvertError(null)
    try {
      // Atomic + lossless: the server carries the full underwriting from the
      // prospect and archives it (status='converted') — no client-side copy/delete.
      const project = await convertProspect(p.id, {
        type: convertFields.type,
        totalUnits: convertFields.totalUnits,
        acquisitionDate: convertFields.acquisitionDate,
        conclusionDate: convertFields.conclusionDate,
        currentValuation: convertFields.currentValuation,
        valuationDate: convertFields.valuationDate,
        status: convertFields.status,
      })
      navigate(`/proyectos/${project.id}`)
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : 'Error al crear proyecto')
      setConverting(false)
    }
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 49px)', color: '#E62300', fontFamily: fonts.sans, fontSize: '13px' }}>
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
  const roi = p.roi ?? null
  const roiColor = roi != null && roi > 0.5 ? colors.primary : roi != null && roi > 0.25 ? colors.tertiary : '#c0392b'
  const roiTotal = p.roiTotal ?? null
  const roiTotalColor = roiTotal != null && roiTotal > 0.5 ? colors.primary : roiTotal != null && roiTotal > 0.25 ? colors.tertiary : '#c0392b'
  const errors = p.issues.filter(i => i.severity === 'error')
  const warnings = p.issues.filter(i => i.severity === 'warning')
  const url = field('url') ?? ''
  const acquisitionCostPct = field('acquisitionCostPct')

  const investmentItems = [
    { label: 'Precio terreno', amount: p.landPrice },
    { label: 'Costos adq.', amount: p.acquisitionCosts },
    { label: 'Permisos', amount: p.permitsCost },
    { label: 'Subdivisión', amount: p.subdivisionCost },
    { label: 'Construcción', amount: p.constructionTotal },
  ].filter(item => item.amount > 0)

  const textRow = (label: string, key: TextKey) => (
    <EditableRow
      label={label}
      editing={editing}
      value={field(key) || '—'}
      input={
        <input
          value={field(key) ?? ''}
          onChange={e => setField(key, e.target.value)}
          aria-label={label}
          style={fieldInput}
        />
      }
    />
  )

  const numRow = (label: string, key: NumKey, format: (n: number | undefined) => string, step?: number) => (
    <EditableRow
      label={label}
      editing={editing}
      value={format(field(key))}
      input={
        <NumericInput
          value={field(key)}
          onChange={n => setField(key, n)}
          step={step}
          ariaLabel={label}
          style={fieldInput}
        />
      }
    />
  )

  const selectRow = (label: string, key: 'type' | 'status', value: string, options: React.ReactNode) => (
    <EditableRow
      label={label}
      editing={editing}
      value={value}
      input={
        <select
          value={field(key) ?? ''}
          onChange={e => setField(key, e.target.value)}
          aria-label={label}
          style={{ ...fieldInput, cursor: 'pointer' }}
        >
          {options}
        </select>
      }
    />
  )

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: colors.dark }}>

      <DetailHeader
        style={fade(0)}
        backLabel="PROSPECTOS"
        onBack={() => navigate('/prospectos/tabla')}
        title={field('name') ?? ''}
        editingTitle={{ value: field('name') ?? '', onChange: v => setField('name', v) }}
        statusLabel={PROSPECT_STATUS_LABEL[field('status') ?? ''] ?? (field('status') ?? '').toUpperCase()}
        statusColor={PROSPECT_STATUS_COLOR[field('status') ?? ''] ?? colors.border}
        editing={editing}
        onToggleEdit={() => setEditing(v => !v)}
        hasChanges={hasEdits || planDirty}
        saving={saving}
        onSave={save}
        onCancel={() => { clear(); setEditing(false) }}
        onDelete={handleDelete}
        actions={
          <button
            onClick={() => openConvertModal(p)}
            style={{ background: 'none', border: `1px solid ${colors.primary}`, color: colors.primary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '5px 12px', flexShrink: 0 }}
          >
            CONVERTIR ▸ PROYECTO
          </button>
        }
      />

      <ErrorBanner message={saveError} />

      {/* ── MAIN 2-COLUMN GRID ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '360px 1fr', overflow: 'hidden' }}>

        {/* ── LEFT: Tabbed (GENERAL / ANÁLISIS) ── */}
        <div style={{
          ...fade(80),
          borderRight: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Left tab bar */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
            {(['general', 'analisis'] as const).map(tab => (
              <button key={tab} onClick={() => setLeftTab(tab)} style={{
                background: 'transparent', border: 'none',
                borderBottom: leftTab === tab ? `2px solid ${colors.primary}` : '2px solid transparent',
                color: leftTab === tab ? colors.neutral : colors.secondary,
                cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px',
                letterSpacing: '0.12em', padding: '10px 16px 8px', textTransform: 'uppercase' as const,
              }}>
                {tab === 'general' ? 'GENERAL' : 'ANÁLISIS'}
              </button>
            ))}
          </div>

          {/* GENERAL tab */}
          {leftTab === 'general' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>

              {/* Hero ROI */}
              <MetricHero
                label="ROI ANUAL"
                value={roi != null ? `${roi > 0 ? '+' : ''}${(roi * 100).toFixed(1)}%` : '—'}
                color={roi != null ? roiColor : colors.secondary}
                barPct={roi != null ? roi * 100 : 0}
                barsReady={barsReady}
                caption={`Score ${p.score ?? '—'}`}
              />

              <MetricHero
                label="ROI TOTAL"
                value={roiTotal != null ? `${roiTotal > 0 ? '+' : ''}${(roiTotal * 100).toFixed(1)}%` : '—'}
                color={roiTotal != null ? roiTotalColor : colors.secondary}
                size={24}
              />

              {/* PROFIT, CAP RATE and INVERSIÓN are always derived from the breakdown */}
              <EditableRow label="PROFIT" editing={editing} value={fmtMXN(p.profit)} />
              <EditableRow label="CAP RATE" editing={editing} value={fmtPct(p.capRate)} />
              <EditableRow label="INVERSIÓN" editing={editing} value={fmtMXN(p.totalInvestment)} />
              {numRow('VENTA', 'projectedSale', fmtMXN)}
              {numRow('PLAZO', 'holdMonths', n => (n ? `${n} meses` : '—'))}
              {numRow('RENTA/MES', 'rentMonthly', fmtMXN)}
              {numRow('TERRENO', 'sqmLand', n => `${n ?? 0} m²`)}
              {numRow('CONSTRUCCIÓN', 'sqmConstruction', n => `${n ?? 0} m²`)}
              {selectRow('TIPO', 'type', field('type') || '—', (
                <>
                  <option value="">— sin tipo —</option>
                  {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </>
              ))}
              {selectRow('ESTADO', 'status', PROSPECT_STATUS_LABEL[field('status') ?? ''] ?? (field('status') || '—'), (
                Object.entries(PROSPECT_STATUS_LABEL).map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)
              ))}

              <SectionDivider label="UBICACIÓN" />
              {textRow('DIRECCIÓN', 'address')}
              {textRow('CIUDAD', 'city')}
              <EditableRow
                label="URL"
                editing={editing}
                value={url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: colors.secondary, textDecoration: 'none' }}>VER FUENTE ↗</a>
                ) : '—'}
                input={
                  <input
                    value={url}
                    onChange={e => setField('url', e.target.value)}
                    aria-label="URL"
                    style={fieldInput}
                  />
                }
              />
              {editing && (
                <div style={{ marginTop: '12px' }}>
                  <LatLonPicker
                    lat={field('latitude') ?? 0}
                    lon={field('longitude') ?? 0}
                    onChange={(newLat, newLon) => {
                      setField('latitude', newLat)
                      setField('longitude', newLon)
                    }}
                  />
                </div>
              )}

              {/* Underwriting — raw inputs while editing, the derived bars while viewing */}
              {editing ? (
                <>
                  <SectionDivider label="DESGLOSE DE INVERSIÓN" />
                  {numRow('PRECIO TERRENO', 'landPrice', fmtMXN)}
                  {numRow('COSTO CONSTR./m²', 'constructionCostPerSqm', fmtMXN)}
                  {numRow('PERMISOS', 'permitsCost', fmtMXN)}
                  {numRow('SUBDIVISIÓN', 'subdivisionCost', fmtMXN)}
                  <EditableRow
                    label="COSTOS ADQ. (%)"
                    editing={editing}
                    value={fmtPct(acquisitionCostPct)}
                    input={
                      <NumericInput
                        value={acquisitionCostPct != null ? acquisitionCostPct * 100 : undefined}
                        onChange={n => setField('acquisitionCostPct', n != null ? n / 100 : undefined)}
                        step={0.1}
                        ariaLabel="COSTOS ADQ. (%)"
                        style={fieldInput}
                      />
                    }
                  />
                  {numRow('OVERHEAD CONSTRUCCIÓN', 'constructionOverhead', n => (n != null ? String(n) : '—'), 0.01)}
                </>
              ) : (
                <InvestmentBreakdown label="INVERSIÓN TOTAL" total={p.totalInvestment} items={investmentItems} barsReady={barsReady} />
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

              {/* Notas */}
              <SectionDivider label="NOTAS" />
              {editing ? (
                <textarea
                  value={field('notes') ?? ''}
                  onChange={e => setField('notes', e.target.value)}
                  rows={3}
                  aria-label="NOTAS"
                  style={{ ...fieldInput, resize: 'vertical' }}
                />
              ) : (
                <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
                  {field('notes') && field('notes') !== '-' ? field('notes') : '—'}
                </div>
              )}
            </div>
          )}

          {/* ANÁLISIS tab */}
          {leftTab === 'analisis' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>
              <ProspectAnalysisSection prospectId={p.id} />
            </div>
          )}
        </div>

        {/* ── CENTER: Mapa / Fotos / Plano ── */}
        <MediaTabs
          style={fade(160)}
          mapa={<MapPanel lat={p.latitude} lon={p.longitude} markerColor={roiColor} />}
          fotos={
            <PhotoGallery
              images={p.images}
              base={BASE}
              onUpload={async file => {
                const img = await uploadProspectImage(p.id, file)
                setProspect(prev => prev ? { ...prev, images: [...prev.images, img] } : prev)
              }}
              onDelete={async imageId => {
                await deleteProspectImage(p.id, imageId)
                setProspect(prev => prev ? { ...prev, images: prev.images.filter(i => i.id !== imageId) } : prev)
              }}
            />
          }
          plano={geometry !== null && (
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <FloorPlanEditor
                initial={geometry}
                onSave={async m => { const saved = await saveProspectGeometry(p.id, m); setGeometry(saved) }}
                onUploadImage={file => uploadProspectFloorplanImage(p.id, file)}
                onReady={onPlanReady}
                onDirtyChange={setPlanDirty}
              />
            </div>
          )}
        />

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
                {Object.entries(PROJECT_STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
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
