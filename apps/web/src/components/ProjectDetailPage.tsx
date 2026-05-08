import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import { fetchProject, updateProject, fetchInstances, fetchTeam, fetchProjectInvestors, fetchInvestors, upsertProjectInvestor, deleteProjectInvestor, fetchProjectProfit } from '../lib/api'
import type { Project, ProcessInstance, TeamMember, ProjectInvestor, Investor, ProfitWaterfall } from '../lib/types'
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
  const [addingInvestor, setAddingInvestor] = useState(false)
  const [editingInvestorId, setEditingInvestorId] = useState<number | null>(null)
  const [editInterested, setEditInterested] = useState<string>('')
  const [editCommitted, setEditCommitted] = useState<string>('')
  const [editFunded, setEditFunded] = useState<string>('')
  const [editRate, setEditRate] = useState<string>('12')
  const [savingInvestorId, setSavingInvestorId] = useState<number | null>(null)
  const [rightTab, setRightTab] = useState<'proyecto' | 'finanzas'>('proyecto')
  const [waterfall, setWaterfall] = useState<ProfitWaterfall | null>(null)

  useEffect(() => {
    fetchProject(projectId).then(p => {
      setProject(p)
      setTimeout(() => setMounted(true), 40)
      setTimeout(() => setBarsReady(true), 420)
    })
    fetchInstances(projectId).then(setInstances)
    fetchTeam().then(setTeam)
    fetchProjectInvestors(projectId).then(setProjectInvestors)
    fetchInvestors().then(setAllInvestors)
    fetchProjectProfit(projectId).then(({ waterfall }) => { setWaterfall(waterfall) })
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
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
      const data = {
        investorId: Number(addInvestorId),
        status,
        interestedAmount: interested,
        committedAmount: committed,
        fundedAmount: funded,
        interestRateAnnual: Number(addRate) / 100,
        notes: '',
      }
      const pi = await upsertProjectInvestor(projectId, data)
      setProjectInvestors(prev => {
        const idx = prev.findIndex(x => x.investorId === pi.investorId)
        return idx >= 0 ? prev.map((x, i) => i === idx ? pi : x) : [...prev, pi]
      })
      setShowAddInvestor(false)
      setAddInvestorId('')
      setAddInterested('')
      setAddCommitted('')
      setAddFunded('')
      setAddRate('12')
    } finally {
      setAddingInvestor(false)
    }
  }

  function startEditInvestor(pi: ProjectInvestor) {
    setEditingInvestorId(pi.investorId)
    setEditInterested(pi.interestedAmount ? String(pi.interestedAmount) : '')
    setEditCommitted(pi.committedAmount ? String(pi.committedAmount) : '')
    setEditFunded(pi.fundedAmount ? String(pi.fundedAmount) : '')
    setEditRate(String(Math.round(pi.interestRateAnnual * 100)))
  }

  async function handleSaveEditInvestor(investorId: number) {
    setSavingInvestorId(investorId)
    try {
      const interested = Number(editInterested) || 0
      const committed = Number(editCommitted) || 0
      const funded = Number(editFunded) || 0
      const status: 'interesado' | 'comprometido' | 'fondeado' =
        funded > 0 ? 'fondeado' : committed > 0 ? 'comprometido' : 'interesado'
      const pi = await upsertProjectInvestor(projectId, {
        investorId,
        status,
        interestedAmount: interested,
        committedAmount: committed,
        fundedAmount: funded,
        interestRateAnnual: Number(editRate) / 100,
        notes: '',
      })
      setProjectInvestors(prev => prev.map(x => x.investorId === investorId ? pi : x))
      setEditingInvestorId(null)
    } finally {
      setSavingInvestorId(null)
    }
  }

  async function handleRemoveInvestor(investorId: number) {
    if (!window.confirm('¿Quitar inversionista del proyecto?')) return
    await deleteProjectInvestor(projectId, investorId)
    setProjectInvestors(prev => prev.filter(x => x.investorId !== investorId))
    if (editingInvestorId === investorId) setEditingInvestorId(null)
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
  const gainPct = (project.unrealizedGainPct ?? 0) * 100
  const gainPositive = gain >= 0
  const gainColor = gainPositive ? colors.primary : colors.tertiary
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

          {/* Hero gain */}
          <div style={{ paddingBottom: '16px', borderBottom: `1px solid ${colors.border}`, marginBottom: '4px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '10px' }}>
              GANANCIA NO REALIZADA
            </div>
            <div style={{ fontFamily: fonts.serif, fontSize: '42px', color: gainColor, lineHeight: 1 }}>
              {gainPositive ? '+' : ''}{fmt(gain)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
              <div style={{ flex: 1, height: '3px', background: colors.border, borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: barsReady ? `${Math.min(100, Math.abs(gainPct))}%` : '0%',
                  background: gainColor,
                  transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
                }} />
              </div>
              <span style={{ fontFamily: fonts.label, fontSize: '13px', color: gainColor, fontWeight: 700, flexShrink: 0 }}>
                {gainPositive ? '+' : ''}{gainPct.toFixed(1)}%
              </span>
            </div>
          </div>

          {stat('INVERSIÓN', fmt((field('totalInvestment') as number) ?? 0))}
          {stat('VALORACIÓN', fmt((field('currentValuation') as number) ?? 0))}
          {stat('UNIDADES', field('totalUnits') as React.ReactNode)}
          {stat('TIPO', field('type') as React.ReactNode)}
          {project.holdMonthsActual ? stat('HOLD', `${project.holdMonthsActual} meses`) : null}

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
            { key: 'type', label: 'Tipo', type: 'text' },
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
              <button
                onClick={() => navigate(`/procesos/tareas?proyecto=${project.id}&tipo=proyecto`)}
                style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '3px 10px' }}
              >
                + NUEVA TAREA
              </button>
            </div>
            {instances.length === 0 ? (
              <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Sin tareas ligadas a este proyecto.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    {['NOMBRE', 'TIPO', 'ESTADO', 'INICIO'].map(h => (
                      <th key={h} style={{ padding: '5px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'left', letterSpacing: '0.1em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {instances.map(inst => (
                    <tr
                      key={inst.id}
                      onClick={() => navigate(`/procesos/tareas/${inst.id}`)}
                      style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceAlt)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '6px 10px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{inst.name}</td>
                      <td style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.06em' }}>{inst.taskType.toUpperCase().replace('_', ' ')}</td>
                      <td style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.06em', color: PROCESS_INSTANCE_STATUS_COLOR[inst.status] ?? colors.secondary }}>{inst.status.toUpperCase()}</td>
                      <td style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary }}>{inst.startDate}</td>
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
                onClick={() => { setShowAddInvestor(v => !v); setEditingInvestorId(null) }}
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
                    {allInvestors.map(inv => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
                  </select>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 60px', gap: '6px' }}>
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

            {/* Investors table: NOMBRE | FONDEADO | TASA | CUOTA | TOTAL | actions */}
            {projectInvestors.length === 0 && !showAddInvestor ? (
              <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Sin inversionistas registrados.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    {(['NOMBRE', 'FONDEADO', 'TASA', 'CUOTA', 'TOTAL', ''] as string[]).map(h => (
                      <th key={h} style={{ padding: '4px 5px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, textAlign: h === 'NOMBRE' ? 'left' : 'right', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projectInvestors.map(pi => {
                    const isEditing = editingInvestorId === pi.investorId
                    const isSaving = savingInvestorId === pi.investorId
                    const months = waterfall?.months ?? project.holdMonthsActual ?? 12
                    const cuota = pi.fundedAmount * pi.interestRateAnnual * (months / 12)
                    const total = pi.fundedAmount + cuota
                    const eStyle: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '3px 5px', outline: 'none', width: '60px', textAlign: 'right' }
                    return (
                      <tr key={pi.investorId} style={{ borderBottom: `1px solid ${colors.border}` }}>
                        <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, whiteSpace: 'nowrap' }}>{pi.investorName}</td>
                        {isEditing ? (
                          <>
                            <td style={{ padding: '4px 5px', textAlign: 'right' }}><input type="number" value={editFunded} onChange={e => setEditFunded(e.target.value)} style={eStyle} /></td>
                            <td style={{ padding: '4px 5px', textAlign: 'right' }}><input type="number" value={editRate} onChange={e => setEditRate(e.target.value)} style={{ ...eStyle, width: '44px' }} /></td>
                            <td style={{ padding: '4px 5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>—</td>
                            <td style={{ padding: '4px 5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>—</td>
                            <td style={{ padding: '4px 5px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button onClick={() => handleSaveEditInvestor(pi.investorId)} disabled={isSaving} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 7px', marginRight: '3px', opacity: isSaving ? 0.6 : 1 }}>{isSaving ? '…' : 'OK'}</button>
                              <button onClick={() => setEditingInvestorId(null)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '2px 5px' }}>✕</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: pi.fundedAmount ? colors.primary : colors.secondary, textAlign: 'right' }}>{pi.fundedAmount ? fmt(pi.fundedAmount) : '—'}</td>
                            <td style={{ padding: '5px 5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>{Math.round(pi.interestRateAnnual * 100)}%</td>
                            <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, textAlign: 'right' }}>{pi.fundedAmount ? fmt(cuota) : '—'}</td>
                            <td style={{ padding: '5px 5px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, textAlign: 'right' }}>{pi.fundedAmount ? fmt(total) : '—'}</td>
                            <td style={{ padding: '5px 5px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button onClick={() => startEditInvestor(pi)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.05em', padding: '2px 6px', marginRight: '3px' }}>EDITAR</button>
                              <button onClick={() => handleRemoveInvestor(pi.investorId)} style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '0 2px' }}>✕</button>
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
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
