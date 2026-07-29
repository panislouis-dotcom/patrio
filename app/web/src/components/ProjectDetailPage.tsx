import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BASE, fetchProject, updateProject, deleteProject, fetchInstances, updateInstance, fetchTeam, fetchProjectInvestors, fetchInvestors, addProjectInvestor, updateProjectInvestment, deleteProjectInvestment, fetchProjectProfit, uploadProjectImage, deleteProjectImage, updateProjectImageType, fetchProjectGeometry, saveProjectGeometry, uploadFloorplanImage } from '../lib/api'
import type { Project, RawProjectFields, ProcessInstance, TeamMember, ProjectInvestor, Investor, ProfitWaterfall } from '../lib/types'
import { PROPERTY_TYPES } from '../lib/types'
import { ProjectProfitSection } from './ProjectProfitSection'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import { LatLonPicker } from './LatLonPicker'
import FloorPlanEditor, { type PlanApi } from './FloorPlanEditor'
import type { FloorPlanModel } from '../lib/floorplan/types'
import { NumericInput } from './NumericInput'
import { PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL, PROCESS_INSTANCE_STATUS_COLOR } from '../lib/status'
import { fmtMXN, fmtPct } from '../lib/fmt'
import { StatRow } from './StatRow'
import { MetricHero } from './finance/MetricHero'
import { InvestmentBreakdown } from './finance/InvestmentBreakdown'
import { ProjectPhotoGallery } from './ProjectPhotoGallery'
import { useEdits } from '../lib/useEdits'
import { DetailHeader } from './detail/DetailHeader'
import { EditableRow } from './detail/EditableRow'
import { MapPanel } from './detail/MapPanel'
import { MediaTabs } from './detail/MediaTabs'
import { SectionDivider } from './detail/SectionDivider'
import { ErrorBanner } from './detail/ErrorBanner'

/**
 * The editable columns, split by what the database accepts, so every row below
 * is forced to declare which group its field belongs to:
 *
 *  - `TextKey` / `NumKey` are NOT NULL columns. An emptied box means `''` or `0`
 *    — never `null`, which the PATCH (exclude_unset) would happily write.
 *  - `NullableNumKey` are the underwriting columns, all nullable: an emptied box
 *    sends `null` and genuinely clears the column.
 */
type TextKey = { [K in keyof RawProjectFields]-?: RawProjectFields[K] extends string ? K : never }[keyof RawProjectFields]
type NumKey = { [K in keyof RawProjectFields]-?: RawProjectFields[K] extends number ? K : never }[keyof RawProjectFields]
type NullableNumKey = { [K in keyof RawProjectFields]-?: null extends RawProjectFields[K] ? K : never }[keyof RawProjectFields]

const fmtNum = (n: number | null | undefined) => (n != null ? String(n) : '—')

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const projectId = Number(id)

  const [project, setProject] = useState<Project | null>(null)
  const { edits, field, setField, hasEdits, clear } = useEdits<RawProjectFields>(project)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [barsReady, setBarsReady] = useState(false)
  const [instances, setInstances] = useState<ProcessInstance[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [projectInvestors, setProjectInvestors] = useState<ProjectInvestor[]>([])
  const [allInvestors, setAllInvestors] = useState<Investor[]>([])
  const [showAddInvestor, setShowAddInvestor] = useState(false)
  const [addInvestorId, setAddInvestorId] = useState<string>('')
  const [addInterested, setAddInterested] = useState<string>('')
  const [addCommitted, setAddCommitted] = useState<string>('')
  const [addFunded, setAddFunded] = useState<string>('')
  const [addRate, setAddRate] = useState<string>('12')
  const [addDate, setAddDate] = useState<string>('')
  const [addingInvestor, setAddingInvestor] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editInterested, setEditInterested] = useState<string>('')
  const [editCommitted, setEditCommitted] = useState<string>('')
  const [editFunded, setEditFunded] = useState<string>('')
  const [editRate, setEditRate] = useState<string>('12')
  const [editDate, setEditDate] = useState<string>('')
  const [editReturnAmount, setEditReturnAmount] = useState<string>('')
  const [editReturnDate, setEditReturnDate] = useState<string>('')
  const [savingId, setSavingId] = useState<number | null>(null)
  const [leftTab, setLeftTab] = useState<'general' | 'finanzas'>('general')
  const [geometry, setGeometry] = useState<FloorPlanModel | Record<string, never> | null>(null)
  const planApiRef = useRef<PlanApi | null>(null)
  const [planDirty, setPlanDirty] = useState(false)
  const [waterfall, setWaterfall] = useState<ProfitWaterfall | null>(null)
  const [showLinkTask, setShowLinkTask] = useState(false)
  const [allInstances, setAllInstances] = useState<ProcessInstance[]>([])
  const [linkTaskId, setLinkTaskId] = useState<string>('')
  const [linkingTask, setLinkingTask] = useState(false)

  useEffect(() => {
    Promise.all([
      fetchProject(projectId),
      fetchInstances(projectId),
      fetchTeam(),
      fetchProjectInvestors(projectId),
      fetchInvestors(),
      fetchProjectProfit(projectId),
      fetchProjectGeometry(projectId),
    ]).then(([p, inst, t, pis, allInv, { waterfall: wf }, geo]) => {
      setProject(p)
      setInstances(inst)
      setTeam(t)
      setProjectInvestors(pis)
      setAllInvestors(allInv)
      setWaterfall(wf)
      setGeometry(geo)
      setTimeout(() => setMounted(true), 40)
      setTimeout(() => setBarsReady(true), 420)
    }).catch(e => setError(e instanceof Error ? e.message : 'Error al cargar el proyecto'))
  }, [projectId])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      if (hasEdits) {
        const updated = await updateProject(projectId, edits)
        setProject(updated)
        clear()
        // Dates affect hold_months in the view — refresh dependent data
        const [pis, { waterfall: wf }] = await Promise.all([
          fetchProjectInvestors(projectId),
          fetchProjectProfit(projectId),
        ])
        setProjectInvestors(pis)
        setWaterfall(wf)
      }
      if (planApiRef.current?.isDirty()) {
        const saved = await saveProjectGeometry(projectId, planApiRef.current.getModel())
        setGeometry(saved)
        planApiRef.current.markSaved()
        setPlanDirty(false)
      }
      setEditing(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const onPlanReady = useCallback((api: PlanApi) => { planApiRef.current = api }, [])

  async function handleDelete() {
    await deleteProject(projectId)
    navigate('/proyectos')
  }

  async function handleLinkTask() {
    if (!linkTaskId) return
    setLinkingTask(true)
    try {
      const { instance } = await updateInstance(Number(linkTaskId), { projectId })
      setInstances(prev => [...prev, instance])
      setShowLinkTask(false)
      setLinkTaskId('')
    } finally {
      setLinkingTask(false)
    }
  }

  async function handleUnlinkTask(inst: ProcessInstance) {
    if (!window.confirm(`¿Desligar "${inst.name}" de este proyecto?`)) return
    await updateInstance(inst.id, { projectId: null })
    setInstances(prev => prev.filter(i => i.id !== inst.id))
  }

  async function handleShowLinkTask() {
    setShowLinkTask(v => !v)
    setLinkTaskId('')
    if (!showLinkTask && allInstances.length === 0) {
      const all = await fetchInstances()
      setAllInstances(all)
    }
  }

  async function handleAddInvestor() {
    if (!addInvestorId) return
    setAddingInvestor(true)
    try {
      const interested = Number(addInterested) || 0
      const committed = Number(addCommitted) || 0
      const funded = Number(addFunded) || 0
      const status: 'interesado' | 'comprometido' | 'fondeado' =
        funded > 0 ? 'fondeado' : committed > 0 ? 'comprometido' : 'interesado'
      const pi = await addProjectInvestor(projectId, {
        investorId: Number(addInvestorId),
        status,
        interestedAmount: interested,
        committedAmount: committed,
        fundedAmount: funded,
        interestRateAnnual: Number(addRate) / 100,
        investmentDate: addDate || null,
        notes: '',
      })
      setProjectInvestors(prev => [...prev, pi])
      setShowAddInvestor(false)
      setAddInvestorId('')
      setAddInterested('')
      setAddCommitted('')
      setAddFunded('')
      setAddRate('12')
      setAddDate('')
    } finally {
      setAddingInvestor(false)
    }
  }

  function startEditInvestor(pi: ProjectInvestor) {
    setEditingId(pi.id)
    setEditInterested(pi.interestedAmount ? String(pi.interestedAmount) : '')
    setEditCommitted(pi.committedAmount ? String(pi.committedAmount) : '')
    setEditFunded(pi.fundedAmount ? String(pi.fundedAmount) : '')
    setEditRate(String(Math.round(pi.interestRateAnnual * 100)))
    setEditDate(pi.investmentDate ?? '')
    setEditReturnAmount(pi.returnAmount != null ? String(pi.returnAmount) : '')
    setEditReturnDate(pi.returnDate ?? '')
  }

  async function handleSaveEditInvestment(investmentId: number) {
    setSavingId(investmentId)
    try {
      const interested = Number(editInterested) || 0
      const committed = Number(editCommitted) || 0
      const funded = Number(editFunded) || 0
      const status: 'interesado' | 'comprometido' | 'fondeado' =
        funded > 0 ? 'fondeado' : committed > 0 ? 'comprometido' : 'interesado'
      const pi = await updateProjectInvestment(projectId, investmentId, {
        status,
        interestedAmount: interested,
        committedAmount: committed,
        fundedAmount: funded,
        interestRateAnnual: Number(editRate) / 100,
        investmentDate: editDate || null,
        returnAmount: editReturnAmount ? Number(editReturnAmount) : null,
        returnDate: editReturnDate || null,
      })
      setProjectInvestors(prev => prev.map(x => x.id === investmentId ? pi : x))
      setEditingId(null)
    } finally {
      setSavingId(null)
    }
  }

  async function handleRemoveInvestment(investmentId: number) {
    if (!window.confirm('¿Quitar esta inversión del proyecto?')) return
    await deleteProjectInvestment(projectId, investmentId)
    setProjectInvestors(prev => prev.filter(x => x.id !== investmentId))
    if (editingId === investmentId) setEditingId(null)
  }

  async function handleLiquidarInvestment(pi: ProjectInvestor) {
    const today = new Date().toISOString().split('T')[0]
    setSavingId(pi.id)
    try {
      const updated = await updateProjectInvestment(projectId, pi.id, {
        returnAmount: pi.expectedReturn,
        returnDate: today,
      })
      setProjectInvestors(prev => prev.map(x => x.id === pi.id ? updated : x))
    } finally {
      setSavingId(null)
    }
  }

  const fade = (delay = 0): React.CSSProperties => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(12px)',
    transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
  })

  if (error && !project) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 49px)', color: '#E62300', fontFamily: fonts.sans, fontSize: '13px' }}>
        {error}
      </div>
    )
  }
  if (!project) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 49px)', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
        Cargando…
      </div>
    )
  }

  const milestones = (project.milestones ?? {}) as Record<string, string>
  const milestoneEntries = Object.entries(milestones).sort(([a], [b]) => a.localeCompare(b))
  const gain = project.unrealizedGain ?? 0
  const gainPositive = gain >= 0
  const roi = project.roi ?? null
  const roiColor = roi != null && roi > 0.5 ? colors.primary : roi != null && roi > 0.25 ? colors.tertiary : '#c0392b'
  const roiTotal = project.unrealizedGainPct
  const roiTotalColor = roiTotal > 0.5 ? colors.primary : roiTotal > 0.25 ? colors.tertiary : '#c0392b'
  const url = field('url') ?? ''
  // Investment is derived from the breakdown as soon as there is a land price —
  // clearing PRECIO TERRENO hands the field back to manual capture, live.
  const hasBreakdown = field('landPrice') != null
  const acquisitionCostPct = field('acquisitionCostPct')

  /** NOT NULL text column: an emptied box stays an empty string. */
  const textRow = (label: string, key: TextKey, placeholder?: string) => (
    <EditableRow
      label={label}
      editing={editing}
      value={field(key) || '—'}
      input={
        <input
          value={field(key) ?? ''}
          onChange={e => setField(key, e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          style={fieldInput}
        />
      }
    />
  )

  /** NOT NULL numeric column: an emptied box coerces to 0. */
  const numRow = (label: string, key: NumKey, format: (n: number | undefined) => string) => (
    <EditableRow
      label={label}
      editing={editing}
      value={format(field(key))}
      input={
        <NumericInput
          value={field(key) || undefined}
          onChange={n => setField(key, n ?? 0)}
          ariaLabel={label}
          style={fieldInput}
        />
      }
    />
  )

  /** Nullable underwriting column: an emptied box sends null and clears it. */
  const underwritingRow = (label: string, key: NullableNumKey, format: (n: number | null | undefined) => string, step?: number) => (
    <EditableRow
      label={label}
      editing={editing}
      value={format(field(key))}
      input={
        <NumericInput
          value={field(key) ?? undefined}
          onChange={n => setField(key, n ?? null)}
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
        backLabel="PROYECTOS"
        onBack={() => navigate('/proyectos')}
        title={field('name') ?? ''}
        editingTitle={{ value: field('name') ?? '', onChange: v => setField('name', v) }}
        statusLabel={PROJECT_STATUS_LABEL[field('status') ?? ''] ?? (field('status') ?? '').toUpperCase()}
        statusColor={PROJECT_STATUS_COLOR[field('status') ?? ''] ?? colors.border}
        editing={editing}
        onToggleEdit={() => setEditing(v => !v)}
        hasChanges={hasEdits || planDirty}
        saving={saving}
        onSave={save}
        onCancel={() => { clear(); setEditing(false) }}
        onDelete={handleDelete}
      />

      <ErrorBanner message={error} />

      {/* ── MAIN 2-COLUMN GRID ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '360px 1fr', overflow: 'hidden' }}>

        {/* ── LEFT: Tabbed (GENERAL / FINANZAS) ── */}
        <div style={{
          ...fade(80),
          borderRight: `1px solid ${colors.border}`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>

          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
            {(['general', 'finanzas'] as const).map(tab => (
              <button key={tab} onClick={() => setLeftTab(tab)} style={{
                background: 'transparent', border: 'none',
                borderBottom: leftTab === tab ? `2px solid ${colors.primary}` : '2px solid transparent',
                color: leftTab === tab ? colors.neutral : colors.secondary,
                cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px',
                letterSpacing: '0.12em', padding: '10px 16px 8px', textTransform: 'uppercase' as const,
              }}>
                {tab.toUpperCase()}
              </button>
            ))}
          </div>

          {/* ── GENERAL tab ── */}
          {leftTab === 'general' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>

              {/* Hero ROI */}
              <MetricHero
                label="ROI ANUAL"
                value={roi != null ? `${roi > 0 ? '+' : ''}${(roi * 100).toFixed(1)}%` : '—'}
                color={roi != null ? roiColor : colors.secondary}
                barPct={roi != null ? roi * 100 : 0}
                barsReady={barsReady}
                caption={`${gainPositive ? '+' : ''}${fmtMXN(gain)}`}
              />

              <MetricHero
                label="ROI TOTAL"
                value={roiTotal !== 0 ? `${roiTotal > 0 ? '+' : ''}${(roiTotal * 100).toFixed(1)}%` : '—'}
                color={roiTotal !== 0 ? roiTotalColor : colors.secondary}
                size={24}
              />

              {/* Investment is either derived from the breakdown or captured by hand */}
              <EditableRow
                label="INVERSIÓN"
                editing={editing}
                value={fmtMXN(field('totalInvestment'))}
                hint={editing ? (hasBreakdown ? 'CALCULADA DEL DESGLOSE' : 'CAPTURA MANUAL') : undefined}
                input={hasBreakdown ? undefined : (
                  <NumericInput
                    value={field('totalInvestment') || undefined}
                    onChange={n => setField('totalInvestment', n ?? 0)}
                    ariaLabel="INVERSIÓN"
                    style={fieldInput}
                  />
                )}
              />
              {numRow('VALORACIÓN', 'currentValuation', fmtMXN)}
              {underwritingRow('RENTA/MES', 'rentMonthly', fmtMXN)}
              {project.capRate != null && (
                <EditableRow label="CAP RATE" editing={editing} value={fmtPct(project.capRate)} />
              )}
              <EditableRow
                label="PLAZO REAL"
                editing={editing}
                value={project.holdMonthsActual ? `${project.holdMonthsActual} meses` : '—'}
                hint={editing ? 'DERIVADO DE FECHAS' : undefined}
              />
              {numRow('UNIDADES', 'totalUnits', fmtNum)}
              {selectRow('TIPO', 'type', field('type') || '—', (
                <>
                  <option value="">— sin tipo —</option>
                  {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </>
              ))}
              {selectRow('ESTADO', 'status', PROJECT_STATUS_LABEL[field('status') ?? ''] ?? (field('status') || '—'), (
                Object.entries(PROJECT_STATUS_LABEL).map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)
              ))}

              <SectionDivider label="FECHAS" />
              {textRow('ADQUISICIÓN', 'acquisitionDate', 'YYYY-MM')}
              {textRow('PRIMERA RENTA', 'conclusionDate', 'YYYY-MM')}
              {textRow('VALUACIÓN', 'valuationDate', 'YYYY-MM')}

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
                    lat={Number(field('latitude')) || 0}
                    lon={Number(field('longitude')) || 0}
                    onChange={(newLat, newLon) => {
                      setField('latitude', newLat)
                      setField('longitude', newLon)
                    }}
                  />
                </div>
              )}

              {/* Underwriting superset — raw inputs while editing, derived blocks while viewing */}
              {editing ? (
                <>
                  <SectionDivider label="DESGLOSE DE INVERSIÓN" />
                  {underwritingRow('PRECIO TERRENO', 'landPrice', fmtMXN)}
                  {underwritingRow('TERRENO (m²)', 'sqmLand', fmtNum)}
                  {underwritingRow('CONSTRUCCIÓN (m²)', 'sqmConstruction', fmtNum)}
                  {underwritingRow('COSTO CONSTR./m²', 'constructionCostPerSqm', fmtMXN)}
                  {underwritingRow('PERMISOS', 'permitsCost', fmtMXN)}
                  {underwritingRow('SUBDIVISIÓN', 'subdivisionCost', fmtMXN)}
                  {underwritingRow('VENTA PROYECTADA', 'projectedSale', fmtMXN)}
                  <EditableRow
                    label="COSTOS ADQ. (%)"
                    editing={editing}
                    value={fmtPct(acquisitionCostPct)}
                    input={
                      <NumericInput
                        value={acquisitionCostPct != null ? acquisitionCostPct * 100 : undefined}
                        onChange={n => setField('acquisitionCostPct', n != null ? n / 100 : null)}
                        step={0.1}
                        ariaLabel="COSTOS ADQ. (%)"
                        style={fieldInput}
                      />
                    }
                  />
                  {underwritingRow('OVERHEAD CONSTRUCCIÓN', 'constructionOverhead', fmtNum, 0.01)}
                  {underwritingRow('PLAZO PROYECTADO (MESES)', 'holdMonths', fmtNum)}
                </>
              ) : hasBreakdown ? (
                <>
                  <InvestmentBreakdown
                    label="DESGLOSE DE INVERSIÓN"
                    total={project.totalInvestment}
                    barsReady={barsReady}
                    items={[
                      { label: 'Precio terreno', amount: project.landPrice ?? 0 },
                      { label: 'Costos adq.', amount: project.acquisitionCosts ?? 0 },
                      { label: 'Permisos', amount: project.permitsCost ?? 0 },
                      { label: 'Subdivisión', amount: project.subdivisionCost ?? 0 },
                      { label: 'Construcción', amount: project.constructionTotal ?? 0 },
                    ]}
                  />
                  <SectionDivider label="MÉTRICAS" />
                  <StatRow label="INVERSIÓN/m²" value={fmtMXN(project.investmentPerSqm)} />
                  <StatRow label="VENTA/m²" value={fmtMXN(project.salePerSqm)} />
                  <StatRow label="COSTO PROPIEDAD" value={fmtMXN(project.landPrice)} />
                  <SectionDivider label="PROYECCIÓN" />
                  <StatRow label="VENTA PROYECTADA" value={fmtMXN(project.projectedSale)} />
                  <StatRow label="PROFIT PROYECTADO" value={fmtMXN(project.projectedProfit)} />
                  <StatRow label="ROI PROYECTADO" value={fmtPct(project.projectedRoi)} />
                </>
              ) : (
                <>
                  <SectionDivider label="DESGLOSE DE INVERSIÓN" />
                  <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>
                    Agrega el desglose de inversión en EDITAR para calcular la inversión y las métricas.
                  </div>
                </>
              )}

              {/* Hitos */}
              {milestoneEntries.length > 0 && (
                <div style={{ marginTop: '20px' }}>
                  <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '16px' }}>HITOS</div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {milestoneEntries.map(([date, label], i) => (
                      <div key={date} style={{ display: 'flex', gap: '14px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '8px' }}>
                          <div style={{
                            width: '8px', height: '8px', borderRadius: '50%',
                            background: colors.primary,
                            flexShrink: 0,
                            boxShadow: `0 0 6px ${colors.primary}66`,
                          }} />
                          {i < milestoneEntries.length - 1 && (
                            <div style={{ width: '1px', flex: 1, minHeight: '20px', background: colors.border }} />
                          )}
                        </div>
                        <div style={{ paddingBottom: '16px' }}>
                          <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.05em' }}>{date}</div>
                          <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, marginTop: '2px' }}>{label}</div>
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
                  {field('notes') || '—'}
                </div>
              )}

              {/* TAREAS */}
              <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '24px', marginTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em' }}>TAREAS</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={handleShowLinkTask}
                      style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '3px 10px' }}
                    >
                      {showLinkTask ? '✕' : 'LIGAR EXISTENTE'}
                    </button>
                    <button
                      onClick={() => navigate(`/procesos/tareas?proyecto=${project.id}&tipo=proyecto`)}
                      style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '3px 10px' }}
                    >
                      + NUEVA TAREA
                    </button>
                  </div>
                </div>

                {/* Link picker */}
                {showLinkTask && (() => {
                  const linkedIds = new Set(instances.map(i => i.id))
                  const available = allInstances.filter(i => !linkedIds.has(i.id))
                  const iStyle: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '5px 8px', outline: 'none', flex: 1 }
                  return (
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', padding: '10px', background: colors.surface, border: `1px solid ${colors.border}` }}>
                      <select value={linkTaskId} onChange={e => setLinkTaskId(e.target.value)} style={iStyle}>
                        <option value="">— seleccionar tarea —</option>
                        {available.map(i => (
                          <option key={i.id} value={i.id}>{i.name}{i.projectName ? ` (${i.projectName})` : ''}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleLinkTask}
                        disabled={!linkTaskId || linkingTask}
                        style={{ background: linkTaskId ? colors.primary : colors.border, border: 'none', color: colors.neutral, cursor: linkTaskId ? 'pointer' : 'not-allowed', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '5px 14px', opacity: linkingTask ? 0.6 : 1 }}
                      >
                        {linkingTask ? '…' : 'LIGAR'}
                      </button>
                    </div>
                  )
                })()}

                {instances.length === 0 ? (
                  <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Sin tareas ligadas a este proyecto.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                        {['NOMBRE', 'TIPO', 'ESTADO', 'INICIO', ''].map(h => (
                          <th key={h} style={{ padding: '5px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'left', letterSpacing: '0.1em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {instances.map(inst => (
                        <tr
                          key={inst.id}
                          style={{ borderBottom: `1px solid ${colors.border}` }}
                        >
                          <td
                            style={{ padding: '6px 10px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, cursor: 'pointer' }}
                            onClick={() => navigate(`/procesos/tareas/${inst.id}`)}
                          >
                            {inst.name}
                          </td>
                          <td style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.06em' }}>{inst.taskType.toUpperCase().replace('_', ' ')}</td>
                          <td style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.06em', color: PROCESS_INSTANCE_STATUS_COLOR[inst.status] ?? colors.secondary }}>{inst.status.toUpperCase()}</td>
                          <td style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary }}>{inst.startDate}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                            <button
                              onClick={() => handleUnlinkTask(inst)}
                              style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '0 4px', opacity: 0.6 }}
                              title="Desligar"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

            </div>
          )}

          {/* ── FINANZAS tab ── */}
          {leftTab === 'finanzas' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>

              {/* FLUJO FINANCIERO */}
              {waterfall && (() => {
                const isrPct = waterfall.operatorGross > 0 ? Math.round(waterfall.isr / waterfall.operatorGross * 100) : 0
                const rowS: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${colors.border}` }
                const lblS: React.CSSProperties = { fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary }
                const valS: React.CSSProperties = { fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }
                const totLblS: React.CSSProperties = { fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.neutral }
                const totValS: React.CSSProperties = { fontFamily: fonts.sans, fontSize: '12px', color: colors.primary, fontWeight: 700 }
                return (
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '8px' }}>FLUJO FINANCIERO</div>
                    <div style={rowS}><span style={lblS}>PRECIO DE SALIDA</span><span style={valS}>{fmtMXN(waterfall.exitPrice)}</span></div>
                    <div style={rowS}><span style={lblS}>− INVERSIÓN TOTAL</span><span style={valS}>{fmtMXN(waterfall.investment)}</span></div>
                    <div style={{ ...rowS, borderTop: `1px solid ${colors.border}`, marginTop: '2px', paddingTop: '7px' }}><span style={totLblS}>GANANCIA BRUTA</span><span style={valS}>{fmtMXN(waterfall.grossProfit)}</span></div>
                    <div style={rowS}><span style={lblS}>− CUOTA INVERSORES</span><span style={valS}>{fmtMXN(waterfall.investorCuota)}</span></div>
                    <div style={{ ...rowS, borderTop: `1px solid ${colors.border}`, marginTop: '2px', paddingTop: '7px' }}><span style={totLblS}>GANANCIA OPERADOR</span><span style={valS}>{fmtMXN(waterfall.operatorGross)}</span></div>
                    <div style={rowS}><span style={lblS}>− ISR ({isrPct}%)</span><span style={valS}>{fmtMXN(waterfall.isr)}</span></div>
                    <div style={{ ...rowS, borderTop: `1px solid ${colors.border}`, marginTop: '2px', paddingTop: '7px', borderBottom: 'none' }}><span style={totLblS}>DISTRIBUIBLE</span><span style={totValS}>{fmtMXN(waterfall.distributable)}</span></div>
                  </div>
                )
              })()}

              {/* INVERSIONISTAS */}
              <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em' }}>
                    INVERSIONISTAS{waterfall ? ` (${waterfall.months} meses)` : ''}
                  </span>
                  <button
                    onClick={() => { setShowAddInvestor(v => !v); setEditingId(null) }}
                    style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em', padding: '2px 8px' }}
                  >
                    {showAddInvestor ? '✕' : '+ AGREGAR'}
                  </button>
                </div>

                {/* Add form */}
                {showAddInvestor && (() => {
                  const iStyle: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '4px 6px', outline: 'none' }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px', padding: '10px', background: colors.surface, border: `1px solid ${colors.border}` }}>
                      <select value={addInvestorId} onChange={e => setAddInvestorId(e.target.value)} style={iStyle}>
                        <option value="">— seleccionar inversionista —</option>
                        {allInvestors.map(inv => <option key={inv.id} value={inv.id}>{[inv.name, inv.apellidos].filter(Boolean).join(' ')}</option>)}
                      </select>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 60px 120px', gap: '6px' }}>
                        {([['Fondeado', addFunded, setAddFunded], ['Interesado', addInterested, setAddInterested]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
                          <div key={label}>
                            <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '2px' }}>{label.toUpperCase()}</div>
                            <input type="number" value={val} onChange={e => setter(e.target.value)} placeholder="0" style={{ ...iStyle, width: '100%', textAlign: 'right', boxSizing: 'border-box' }} />
                          </div>
                        ))}
                        <div>
                          <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '2px' }}>TASA %</div>
                          <input type="number" value={addRate} onChange={e => setAddRate(e.target.value)} style={{ ...iStyle, width: '100%', textAlign: 'right', boxSizing: 'border-box' }} />
                        </div>
                        <div>
                          <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '2px' }}>FECHA INVERSIÓN</div>
                          <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} style={{ ...iStyle, width: '100%', boxSizing: 'border-box' }} />
                        </div>
                      </div>
                      <button
                        onClick={handleAddInvestor}
                        disabled={!addInvestorId || addingInvestor}
                        style={{ background: !addInvestorId ? colors.border : colors.primary, border: 'none', color: colors.neutral, cursor: !addInvestorId ? 'not-allowed' : 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '5px 12px', opacity: addingInvestor ? 0.6 : 1 }}
                      >
                        {addingInvestor ? 'GUARDANDO…' : 'AGREGAR'}
                      </button>
                    </div>
                  )
                })()}

                {/* Investments table */}
                {projectInvestors.length === 0 && !showAddInvestor ? (
                  <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Sin inversionistas registrados.</div>
                ) : (() => {
                  const eStyle: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '3px 5px', outline: 'none', width: '60px', textAlign: 'right' }

                  const totalsById: Record<number, { name: string; funded: number; cuota: number; total: number }> = {}
                  for (const pi of projectInvestors) {
                    if (!totalsById[pi.investorId]) totalsById[pi.investorId] = { name: pi.investorName, funded: 0, cuota: 0, total: 0 }
                    totalsById[pi.investorId].funded += pi.fundedAmount
                    totalsById[pi.investorId].cuota += pi.interestAmount
                    totalsById[pi.investorId].total += pi.expectedReturn
                  }
                  const multipleInvestors = Object.keys(totalsById).length > 1 || projectInvestors.length > 1

                  return (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                          {(['NOMBRE', 'FECHA', 'FONDEADO', 'TASA', 'CUOTA', 'TOTAL', 'RET %', 'PAGADO', 'ESTADO', ''] as string[]).map(h => (
                            <th key={h} style={{ padding: '4px 5px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, textAlign: h === 'NOMBRE' || h === 'FECHA' ? 'left' : 'right', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {projectInvestors.map(pi => {
                          const isEditing = editingId === pi.id
                          const isSaving = savingId === pi.id
                          return (
                            <tr key={pi.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                              <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, whiteSpace: 'nowrap' }}>{pi.investorName}</td>
                              {isEditing ? (
                                <>
                                  <td style={{ padding: '4px 5px' }}><input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} style={{ ...eStyle, width: '110px', textAlign: 'left' }} /></td>
                                  <td style={{ padding: '4px 5px', textAlign: 'right' }}><input type="number" value={editFunded} onChange={e => setEditFunded(e.target.value)} style={eStyle} /></td>
                                  <td style={{ padding: '4px 5px', textAlign: 'right' }}><input type="number" value={editRate} onChange={e => setEditRate(e.target.value)} style={{ ...eStyle, width: '44px' }} /></td>
                                  <td style={{ padding: '4px 5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>—</td>
                                  <td style={{ padding: '4px 5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>—</td>
                                  <td style={{ padding: '4px 5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>—</td>
                                  <td style={{ padding: '4px 5px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                      <input type="number" value={editReturnAmount} onChange={e => setEditReturnAmount(e.target.value)} placeholder="Monto" style={{ ...eStyle, width: '70px' }} />
                                      <input type="date" value={editReturnDate} onChange={e => setEditReturnDate(e.target.value)} style={{ ...eStyle, width: '110px', textAlign: 'left' }} />
                                    </div>
                                  </td>
                                  <td style={{ padding: '4px 5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>—</td>
                                  <td style={{ padding: '4px 5px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    <button onClick={() => handleSaveEditInvestment(pi.id)} disabled={isSaving} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 7px', marginRight: '3px', opacity: isSaving ? 0.6 : 1 }}>{isSaving ? '…' : 'OK'}</button>
                                    <button onClick={() => setEditingId(null)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '2px 5px' }}>✕</button>
                                  </td>
                                </>
                              ) : (
                                <>
                                  {(() => {
                                    const paid = pi.returnAmount ?? 0
                                    const estado = paid <= 0 ? 'PENDIENTE' : paid >= pi.expectedReturn ? 'LIQUIDADO' : 'PARCIAL'
                                    const estadoColor = paid <= 0 ? colors.secondary : paid >= pi.expectedReturn ? colors.primary : '#8A6D00'
                                    return (
                                      <>
                                        <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '10px', color: colors.secondary }}>{pi.investmentDate ?? '—'}</td>
                                        <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: pi.fundedAmount ? colors.primary : colors.secondary, textAlign: 'right' }}>{pi.fundedAmount ? fmtMXN(pi.fundedAmount) : '—'}</td>
                                        <td style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>{Math.round(pi.interestRateAnnual * 100)}%</td>
                                        <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, textAlign: 'right' }}>{pi.fundedAmount ? fmtMXN(pi.interestAmount) : '—'}</td>
                                        <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, textAlign: 'right' }}>{pi.fundedAmount ? fmtMXN(pi.expectedReturn) : '—'}</td>
                                        <td style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>{pi.fundedAmount ? `${pi.returnPct.toFixed(1)}%` : '—'}</td>
                                        <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: pi.returnAmount ? colors.primary : colors.secondary, textAlign: 'right' }}>
                                          {pi.returnAmount ? fmtMXN(pi.returnAmount) : '—'}
                                          {pi.returnDate && <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary }}>{pi.returnDate}</div>}
                                        </td>
                                        <td style={{ padding: '5px 5px', textAlign: 'right' }}>
                                          <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.08em', color: estadoColor }}>{estado}</span>
                                        </td>
                                        <td style={{ padding: '5px 5px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                          {estado !== 'LIQUIDADO' && pi.fundedAmount > 0 && (
                                            <button onClick={() => handleLiquidarInvestment(pi)} disabled={savingId === pi.id} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.05em', padding: '2px 6px', marginRight: '3px', opacity: savingId === pi.id ? 0.6 : 1 }}>LIQUIDAR</button>
                                          )}
                                          <button onClick={() => startEditInvestor(pi)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.05em', padding: '2px 6px', marginRight: '3px' }}>EDITAR</button>
                                          <button onClick={() => handleRemoveInvestment(pi.id)} style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '0 2px' }}>✕</button>
                                        </td>
                                      </>
                                    )
                                  })()}
                                </>
                              )}
                            </tr>
                          )
                        })}
                        {/* Accumulated totals row */}
                        {multipleInvestors && (
                          <tr style={{ borderTop: `1px solid ${colors.border}`, background: colors.surface }}>
                            <td colSpan={2} style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>TOTAL ACUMULADO</td>
                            <td style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '10px', color: colors.primary, textAlign: 'right' }}>
                              {fmtMXN(Object.values(totalsById).reduce((s, t) => s + t.funded, 0))}
                            </td>
                            <td />
                            <td style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '10px', color: colors.neutral, textAlign: 'right' }}>
                              {fmtMXN(Object.values(totalsById).reduce((s, t) => s + t.cuota, 0))}
                            </td>
                            <td style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '10px', color: colors.neutral, textAlign: 'right' }}>
                              {fmtMXN(Object.values(totalsById).reduce((s, t) => s + t.total, 0))}
                            </td>
                            <td /><td /><td /><td />
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )
                })()}
              </div>

              {/* GANANCIA / PROFIT */}
              <ProjectProfitSection
                projectId={project.id}
                team={team}
                showWaterfall={false}
                showInvestorBreakdown={false}
                onWaterfallChange={w => setWaterfall(w)}
              />

            </div>
          )}

        </div>

        {/* ── CENTER: Mapa / Fotos / Plano ── */}
        <MediaTabs
          style={fade(160)}
          mapa={<MapPanel lat={project.latitude} lon={project.longitude} markerColor={colors.primary} />}
          fotos={
            <ProjectPhotoGallery
              images={project.images}
              base={BASE}
              onUpload={async (file, imageType) => {
                const img = await uploadProjectImage(project.id, file, imageType)
                setProject(prev => prev ? { ...prev, images: [...prev.images, img] } : prev)
              }}
              onDelete={async imageId => {
                await deleteProjectImage(project.id, imageId)
                setProject(prev => prev ? { ...prev, images: prev.images.filter(i => i.id !== imageId) } : prev)
              }}
              onFlipType={async (imageId, newType) => {
                const updated = await updateProjectImageType(project.id, imageId, newType)
                setProject(prev => prev ? { ...prev, images: prev.images.map(i => i.id === imageId ? updated : i) } : prev)
              }}
            />
          }
          plano={geometry !== null && (
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <FloorPlanEditor
                initial={geometry}
                onSave={async m => { const saved = await saveProjectGeometry(projectId, m); setGeometry(saved) }}
                onUploadImage={file => uploadFloorplanImage(projectId, file)}
                onReady={onPlanReady}
                onDirtyChange={setPlanDirty}
              />
            </div>
          )}
        />

      </div>
    </div>
  )
}
