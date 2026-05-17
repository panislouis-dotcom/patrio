import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import { fetchProject, updateProject, deleteProject, fetchInstances, updateInstance, fetchTeam, fetchProjectInvestors, fetchInvestors, addProjectInvestor, updateProjectInvestment, deleteProjectInvestment, fetchProjectProfit } from '../lib/api'
import type { Project, ProcessInstance, TeamMember, ProjectInvestor, Investor, ProfitWaterfall } from '../lib/types'
import { PROPERTY_TYPES } from '../lib/types'
import { ProjectProfitSection } from './ProjectProfitSection'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import { PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL, PROCESS_INSTANCE_STATUS_COLOR } from '../lib/status'

function fmt(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const projectId = Number(id)

  const [project, setProject] = useState<Project | null>(null)
  const [edits, setEdits] = useState<Partial<Project>>({})
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
  const [rightTab, setRightTab] = useState<'proyecto' | 'finanzas'>('proyecto')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
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
    ]).then(([p, inst, t, pis, allInv, { waterfall: wf }]) => {
      setProject(p)
      setInstances(inst)
      setTeam(t)
      setProjectInvestors(pis)
      setAllInvestors(allInv)
      setWaterfall(wf)
      setTimeout(() => setMounted(true), 40)
      setTimeout(() => setBarsReady(true), 420)
    }).catch(e => setError(e instanceof Error ? e.message : 'Error al cargar el proyecto'))
  }, [projectId])

  const field = (key: keyof Project) => (edits as Record<string, unknown>)[key] ?? (project ? (project as unknown as Record<string, unknown>)[key] : undefined)
  const setField = (key: keyof Project, value: unknown) => setEdits(prev => ({ ...prev, [key]: value }))
  const hasEdits = Object.keys(edits).length > 0

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateProject(projectId, edits)
      setProject(updated)
      setEdits({})
      // Dates affect hold_months in the view — refresh dependent data
      const [pis, { waterfall: wf }] = await Promise.all([
        fetchProjectInvestors(projectId),
        fetchProjectProfit(projectId),
      ])
      setProjectInvestors(pis)
      setWaterfall(wf)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteProject(Number(id))
      navigate('/proyectos')
    } catch {
      setDeleting(false)
      setConfirmDelete(false)
    }
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

  if (!project) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 49px)', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
        Cargando…
      </div>
    )
  }

  const budget = (project.budget ?? {}) as Record<string, number>
  const budgetTotal = Object.values(budget).reduce((a, b) => a + b, 0)
  const milestones = (project.milestones ?? {}) as Record<string, string>
  const milestoneEntries = Object.entries(milestones).sort(([a], [b]) => a.localeCompare(b))
  const gain = project.unrealizedGain ?? 0
  const gainPositive = gain >= 0
  const roi = project.roi ?? null
  const roiColor = roi != null && roi > 0.5 ? colors.primary : roi != null && roi > 0.25 ? colors.tertiary : '#c0392b'
  const lat = project.latitude as number | null
  const lng = project.longitude as number | null
  const hasMap = lat && lng

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
          onClick={() => navigate('/proyectos')}
          style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: 0, flexShrink: 0 }}
        >
          ← PROYECTOS
        </button>
        <span style={{ color: colors.border }}>·</span>
        <span style={{ fontFamily: fonts.serif, fontSize: '20px', color: colors.neutral, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {field('name') as string}
        </span>
        <span style={{
          fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.12em',
          padding: '3px 10px', flexShrink: 0,
          background: PROJECT_STATUS_COLOR[field('status') as string] ?? colors.border,
          color: colors.neutral,
        }}>
          {PROJECT_STATUS_LABEL[field('status') as string] ?? String(field('status') ?? '').toUpperCase()}
        </span>
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
            onClick={save}
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
                  background: roi != null ? roiColor : colors.border,
                  transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
                }} />
              </div>
              <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, flexShrink: 0 }}>
                {gainPositive ? '+' : ''}{fmt(gain)}
              </span>
            </div>
          </div>

          {stat('INVERSIÓN', fmt((field('totalInvestment') as number) ?? 0))}
          {stat('VALORACIÓN', fmt((field('currentValuation') as number) ?? 0))}
          {stat('PLAZO', project.holdMonthsActual ? `${project.holdMonthsActual} meses` : '—')}
          {stat('UNIDADES', field('totalUnits') as React.ReactNode)}
          {stat('TIPO', field('type') as React.ReactNode)}

          {divider('FECHAS')}
          {stat('ADQUISICIÓN', field('acquisitionDate') as React.ReactNode)}
          {project.conclusionDate ? stat(
            ['flip', 'land'].includes(project.type) ? 'FECHA DE VENTA' : 'PRIMERA RENTA',
            field('conclusionDate') as React.ReactNode
          ) : null}
          {project.valuationDate ? stat('VALUACIÓN', field('valuationDate') as React.ReactNode) : null}

          {divider('UBICACIÓN')}
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginBottom: '2px' }}>{field('address') as string}</div>
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>{field('city') as string}</div>

          {divider('EDITAR')}
          {([
            { key: 'name', label: 'Nombre', type: 'text' },
            { key: 'address', label: 'Dirección', type: 'text' },
            { key: 'city', label: 'Ciudad', type: 'text' },
          ] as const).map(({ key, label, type }) => (
            <div key={key} style={{ marginBottom: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>{label.toUpperCase()}</div>
              <input
                value={(field(key as keyof Project) as string) ?? ''}
                onChange={e => setField(key as keyof Project, e.target.value)}
                type={type}
                style={fieldInput}
              />
            </div>
          ))}

          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>TIPO</div>
            <select
              value={(edits.type as string) ?? (project.type ?? '')}
              onChange={e => setField('type', e.target.value)}
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
              value={(field('status') as string) ?? ''}
              onChange={e => setField('status', e.target.value)}
              style={{ ...fieldInput, cursor: 'pointer' }}
            >
              {Object.entries(PROJECT_STATUS_LABEL).map(([val, lbl]) => (
                <option key={val} value={val}>{lbl}</option>
              ))}
            </select>
          </div>

          {([
            { key: 'totalInvestment', label: 'Inversión ($)' },
            { key: 'currentValuation', label: 'Valoración ($)' },
            { key: 'totalUnits', label: 'Unidades' },
          ] as const).map(({ key, label }) => (
            <div key={key} style={{ marginBottom: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>{label.toUpperCase()}</div>
              <input
                value={(field(key as keyof Project) as number) ?? ''}
                onChange={e => setField(key as keyof Project, Number(e.target.value))}
                type="number"
                style={fieldInput}
              />
            </div>
          ))}

          {([
            { key: 'acquisitionDate' as keyof Project, label: 'Adquisición (YYYY-MM)' },
            { key: 'conclusionDate' as keyof Project, label: (['flip', 'land'].includes(field('type') as string) ? 'Fecha de venta (YYYY-MM)' : 'Primera renta (YYYY-MM)') },
            { key: 'valuationDate' as keyof Project, label: 'Valuación (YYYY-MM)' },
          ]).map(({ key, label }) => (
            <div key={key} style={{ marginBottom: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>{label.toUpperCase()}</div>
              <input
                value={(field(key) as string) ?? ''}
                onChange={e => setField(key, e.target.value)}
                type="text"
                placeholder="YYYY-MM"
                style={fieldInput}
              />
            </div>
          ))}

          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>NOTAS</div>
            <textarea
              value={(field('notes') as string) ?? ''}
              onChange={e => setField('notes', e.target.value)}
              rows={3}
              style={{ ...fieldInput, resize: 'vertical' }}
            />
          </div>

          {error && (
            <div style={{ color: colors.tertiary, fontFamily: fonts.sans, fontSize: '11px', marginTop: '8px' }}>{error}</div>
          )}
        </div>

        {/* ── CENTER: Mapa ── */}
        <div style={{ ...fade(160), position: 'relative', overflow: 'hidden' }}>
          {hasMap ? (
            <MapContainer
              center={[lat, lng]}
              zoom={15}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={false}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              />
              <CircleMarker
                center={[lat, lng]}
                radius={12}
                pathOptions={{ color: colors.primary, fillColor: colors.primary, fillOpacity: 0.7, weight: 2 }}
              />
            </MapContainer>
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.border }}>SIN COORDENADAS</div>
              <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Agrega lat/lng en el panel izquierdo</div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Tabbed (PROYECTO / FINANZAS) ── */}
        <div style={{
          ...fade(240),
          borderLeft: `1px solid ${colors.border}`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>

          {/* Tab bar */}
          <div style={{ flexShrink: 0, display: 'flex', borderBottom: `1px solid ${colors.border}`, padding: '0 20px', background: colors.dark }}>
            {(['proyecto', 'finanzas'] as const).map(tab => (
              <button key={tab} onClick={() => setRightTab(tab)} style={{
                background: 'transparent', border: 'none',
                borderBottom: rightTab === tab ? `2px solid ${colors.primary}` : '2px solid transparent',
                color: rightTab === tab ? colors.neutral : colors.secondary,
                cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px',
                letterSpacing: '0.12em', padding: '10px 16px 8px', marginBottom: '-1px',
              }}>
                {tab.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>

          {/* ── PROYECTO tab ── */}
          {rightTab === 'proyecto' && (<>

          {/* Presupuesto */}
          {Object.keys(budget).length > 0 && (
            <>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '6px' }}>PRESUPUESTO</div>
              <div style={{ fontFamily: fonts.serif, fontSize: '28px', color: colors.neutral, marginBottom: '20px' }}>
                {fmt(budgetTotal)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {Object.entries(budget).sort(([, a], [, b]) => b - a).map(([cat, amount], i) => {
                  const pct = budgetTotal > 0 ? (amount / budgetTotal) * 100 : 0
                  return (
                    <div key={cat}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>
                          {cat.toUpperCase()}
                        </span>
                        <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{fmt(amount)}</span>
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

          {/* Hitos */}
          {milestoneEntries.length > 0 && (
            <div style={{ marginTop: Object.keys(budget).length > 0 ? '28px' : '0', paddingTop: Object.keys(budget).length > 0 ? '20px' : '0', borderTop: Object.keys(budget).length > 0 ? `1px solid ${colors.border}` : 'none' }}>
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
          {project.notes && (
            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${colors.border}` }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '8px' }}>NOTAS</div>
              <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
                {project.notes}
              </div>
            </div>
          )}

          {/* URL */}
          {project.url && (
            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${colors.border}` }}>
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary, textDecoration: 'none' }}
              >
                VER FUENTE ↗
              </a>
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

          </>)}

          {/* ── FINANZAS tab ── */}
          {rightTab === 'finanzas' && (<>

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
                <div style={rowS}><span style={lblS}>PRECIO DE SALIDA</span><span style={valS}>{fmt(waterfall.exitPrice)}</span></div>
                <div style={rowS}><span style={lblS}>− INVERSIÓN TOTAL</span><span style={valS}>{fmt(waterfall.investment)}</span></div>
                <div style={{ ...rowS, borderTop: `1px solid ${colors.border}`, marginTop: '2px', paddingTop: '7px' }}><span style={totLblS}>GANANCIA BRUTA</span><span style={valS}>{fmt(waterfall.grossProfit)}</span></div>
                <div style={rowS}><span style={lblS}>− CUOTA INVERSORES</span><span style={valS}>{fmt(waterfall.investorCuota)}</span></div>
                <div style={{ ...rowS, borderTop: `1px solid ${colors.border}`, marginTop: '2px', paddingTop: '7px' }}><span style={totLblS}>GANANCIA OPERADOR</span><span style={valS}>{fmt(waterfall.operatorGross)}</span></div>
                <div style={rowS}><span style={lblS}>− ISR ({isrPct}%)</span><span style={valS}>{fmt(waterfall.isr)}</span></div>
                <div style={{ ...rowS, borderTop: `1px solid ${colors.border}`, marginTop: '2px', paddingTop: '7px', borderBottom: 'none' }}><span style={totLblS}>DISTRIBUIBLE</span><span style={totValS}>{fmt(waterfall.distributable)}</span></div>
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

            {/* Investments table: NOMBRE | FECHA | FONDEADO | TASA | CUOTA | TOTAL | RET % | PAGADO | ESTADO | actions */}
            {projectInvestors.length === 0 && !showAddInvestor ? (
              <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Sin inversionistas registrados.</div>
            ) : (() => {
              const eStyle: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '3px 5px', outline: 'none', width: '60px', textAlign: 'right' }

              // Accumulated totals per investor for the summary row
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
                                const estadoColor = paid <= 0 ? colors.secondary : paid >= pi.expectedReturn ? colors.primary : '#c8a000'
                                return (
                                  <>
                                    <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '10px', color: colors.secondary }}>{pi.investmentDate ?? '—'}</td>
                                    <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: pi.fundedAmount ? colors.primary : colors.secondary, textAlign: 'right' }}>{pi.fundedAmount ? fmt(pi.fundedAmount) : '—'}</td>
                                    <td style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>{Math.round(pi.interestRateAnnual * 100)}%</td>
                                    <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, textAlign: 'right' }}>{pi.fundedAmount ? fmt(pi.interestAmount) : '—'}</td>
                                    <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, textAlign: 'right' }}>{pi.fundedAmount ? fmt(pi.expectedReturn) : '—'}</td>
                                    <td style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>{pi.fundedAmount ? `${pi.returnPct.toFixed(1)}%` : '—'}</td>
                                    <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: pi.returnAmount ? colors.primary : colors.secondary, textAlign: 'right' }}>
                                      {pi.returnAmount ? fmt(pi.returnAmount) : '—'}
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
                    {/* Accumulated totals row — shown when there are multiple investment rows */}
                    {multipleInvestors && (
                      <tr style={{ borderTop: `1px solid ${colors.border}`, background: colors.surface }}>
                        <td colSpan={2} style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>TOTAL ACUMULADO</td>
                        <td style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '10px', color: colors.primary, textAlign: 'right' }}>
                          {fmt(Object.values(totalsById).reduce((s, t) => s + t.funded, 0))}
                        </td>
                        <td />
                        <td style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '10px', color: colors.neutral, textAlign: 'right' }}>
                          {fmt(Object.values(totalsById).reduce((s, t) => s + t.cuota, 0))}
                        </td>
                        <td style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '10px', color: colors.neutral, textAlign: 'right' }}>
                          {fmt(Object.values(totalsById).reduce((s, t) => s + t.total, 0))}
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

          </>)}

          </div>
      </div>
    </div>
  </div>
  )
}
