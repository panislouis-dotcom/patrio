import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchInvestor, updateInvestor, deleteInvestor, fetchProjects, upsertProjectInvestor, deleteProjectInvestor } from '../lib/api'
import type { Investor, ProjectInvestor, Project } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import { fmtM } from '../lib/fmt'

function fmt(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export function InversorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const investorId = Number(id)

  const [investor, setInvestor] = useState<Investor | null>(null)
  const [positions, setPositions] = useState<ProjectInvestor[]>([])
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Add form
  const [showAdd, setShowAdd] = useState(false)
  const [addProjectId, setAddProjectId] = useState<string>('')
  const [addInterested, setAddInterested] = useState<string>('')
  const [addCommitted, setAddCommitted] = useState<string>('')
  const [addFunded, setAddFunded] = useState<string>('')
  const [addRate, setAddRate] = useState<string>('12')
  const [adding, setAdding] = useState(false)

  // Edit row
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null)
  const [editInterested, setEditInterested] = useState<string>('')
  const [editCommitted, setEditCommitted] = useState<string>('')
  const [editFunded, setEditFunded] = useState<string>('')
  const [editRate, setEditRate] = useState<string>('12')
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    fetchInvestor(investorId).then(data => {
      setInvestor(data)
      setPositions(data.positions)
      setName(data.name)
      setEmail(data.email)
      setPhone(data.phone)
      setNotes(data.notes ?? '')
    })
    fetchProjects().then(setAllProjects)
  }, [investorId])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateInvestor(investorId, { name, email, phone, notes })
      setInvestor(updated)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('¿Eliminar inversionista?')) return
    try {
      await deleteInvestor(investorId)
      navigate('/inversionistas')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al eliminar')
    }
  }

  async function handleAddPosition() {
    if (!addProjectId) return
    setAdding(true)
    const projectId = Number(addProjectId)
    const interested = parseFloat(addInterested) || 0
    const committed = parseFloat(addCommitted) || 0
    const funded = parseFloat(addFunded) || 0
    const rate = parseFloat(addRate) / 100 || 0.12
    const status: ProjectInvestor['status'] =
      funded > 0 ? 'fondeado' : committed > 0 ? 'comprometido' : 'interesado'
    try {
      const pos = await upsertProjectInvestor(projectId, {
        investorId,
        status,
        interestedAmount: interested,
        committedAmount: committed,
        fundedAmount: funded,
        interestRateAnnual: rate,
        notes: '',
      })
      setPositions(prev => {
        const idx = prev.findIndex(p => p.projectId === projectId)
        if (idx >= 0) { const next = [...prev]; next[idx] = pos; return next }
        return [...prev, pos]
      })
      setShowAdd(false)
      setAddProjectId('')
      setAddInterested('')
      setAddCommitted('')
      setAddFunded('')
      setAddRate('12')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al agregar')
    } finally {
      setAdding(false)
    }
  }

  function startEdit(pos: ProjectInvestor) {
    setEditingProjectId(pos.projectId)
    setEditInterested(pos.interestedAmount ? String(pos.interestedAmount) : '')
    setEditCommitted(pos.committedAmount ? String(pos.committedAmount) : '')
    setEditFunded(pos.fundedAmount ? String(pos.fundedAmount) : '')
    setEditRate(String(Math.round(pos.interestRateAnnual * 100)))
  }

  async function handleSaveEdit(pos: ProjectInvestor) {
    setSavingEdit(true)
    const interested = parseFloat(editInterested) || 0
    const committed = parseFloat(editCommitted) || 0
    const funded = parseFloat(editFunded) || 0
    const rate = parseFloat(editRate) / 100 || 0.12
    const status: ProjectInvestor['status'] =
      funded > 0 ? 'fondeado' : committed > 0 ? 'comprometido' : 'interesado'
    try {
      const updated = await upsertProjectInvestor(pos.projectId, {
        investorId,
        status,
        interestedAmount: interested,
        committedAmount: committed,
        fundedAmount: funded,
        interestRateAnnual: rate,
        notes: pos.notes,
      })
      setPositions(prev => prev.map(p => p.projectId === pos.projectId ? updated : p))
      setEditingProjectId(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleRemovePosition(pos: ProjectInvestor) {
    if (!window.confirm(`¿Quitar a este inversionista de "${pos.projectName || `Proyecto ${pos.projectId}`}"?`)) return
    try {
      await deleteProjectInvestor(pos.projectId, investorId)
      setPositions(prev => prev.filter(p => p.projectId !== pos.projectId))
      if (editingProjectId === pos.projectId) setEditingProjectId(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al eliminar')
    }
  }

  if (!investor) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 49px)', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
        CARGANDO…
      </div>
    )
  }

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

  const iStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    color: colors.neutral,
    fontFamily: fonts.sans,
    fontSize: '11px',
    padding: '3px 5px',
    outline: 'none',
    width: '72px',
    textAlign: 'right',
  }

  // Projects not yet linked
  const linkedProjectIds = new Set(positions.map(p => p.projectId))
  const availableProjects = allProjects.filter(p => !linkedProjectIds.has(p.id))

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: colors.dark }}>

      {/* ── HEADER ── */}
      <div style={{
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
          onClick={() => navigate('/inversionistas')}
          style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: 0, flexShrink: 0 }}
        >
          ← VOLVER
        </button>
        <span style={{ color: colors.border }}>·</span>
        <span style={{ fontFamily: fonts.serif, fontSize: '20px', color: colors.neutral, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {investor.name}
        </span>
        <button
          onClick={handleDelete}
          style={{
            background: 'transparent',
            border: `1px solid tomato`,
            color: 'tomato',
            cursor: 'pointer',
            fontFamily: fonts.label,
            fontSize: '9px',
            letterSpacing: '0.1em',
            padding: '5px 14px',
            flexShrink: 0,
          }}
        >
          ELIMINAR
        </button>
      </div>

      {/* ── MAIN 2-COLUMN GRID ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '300px 1fr', overflow: 'hidden' }}>

        {/* ── LEFT: Datos editables ── */}
        <div style={{
          borderRight: `1px solid ${colors.border}`,
          overflowY: 'auto',
          padding: '20px',
          scrollbarWidth: 'none',
        }}>
          {divider('DATOS')}

          {stat('TOTAL INTERESADO', fmtM(investor.totalInterested))}
          {stat('TOTAL COMPROMETIDO', fmtM(investor.totalCommitted))}
          {stat('TOTAL FONDEADO', fmtM(investor.totalFunded))}

          {divider('EDITAR')}

          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '4px' }}>NOMBRE</div>
            <input value={name} onChange={e => setName(e.target.value)} type="text" style={fieldInput} />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '4px' }}>EMAIL</div>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" style={fieldInput} />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '4px' }}>TELÉFONO</div>
            <input value={phone} onChange={e => setPhone(e.target.value)} type="tel" style={fieldInput} />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '4px' }}>NOTAS</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} style={{ ...fieldInput, resize: 'vertical' }} />
          </div>

          {error && (
            <div style={{ color: colors.tertiary, fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>{error}</div>
          )}

          <button
            onClick={save}
            disabled={saving}
            style={{
              background: colors.primary,
              border: 'none',
              color: colors.neutral,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: fonts.label,
              fontSize: '9px',
              letterSpacing: '0.1em',
              padding: '8px 20px',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'GUARDANDO…' : 'GUARDAR'}
          </button>
        </div>

        {/* ── RIGHT: Proyectos ── */}
        <div style={{ overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 6px', borderBottom: `1px solid ${colors.border}`, marginBottom: '8px', marginTop: '4px' }}>
            <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary }}>PROYECTOS</span>
            <button
              onClick={() => { setShowAdd(v => !v); setEditingProjectId(null) }}
              style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em', padding: '2px 8px' }}
            >
              {showAdd ? '✕' : '+ AGREGAR'}
            </button>
          </div>

          {/* Add form */}
          {showAdd && (() => {
            const fStyle: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '4px 6px', outline: 'none' }
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', padding: '10px', background: colors.surface, border: `1px solid ${colors.border}` }}>
                <select value={addProjectId} onChange={e => setAddProjectId(e.target.value)} style={fStyle}>
                  <option value="">— seleccionar proyecto —</option>
                  {availableProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 60px', gap: '6px' }}>
                  {([['INTERESADO', addInterested, setAddInterested], ['COMPROMETIDO', addCommitted, setAddCommitted], ['FONDEADO', addFunded, setAddFunded]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
                    <div key={label}>
                      <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '2px' }}>{label}</div>
                      <input type="number" value={val} onChange={e => setter(e.target.value)} placeholder="0" style={{ ...fStyle, width: '100%', textAlign: 'right', boxSizing: 'border-box' }} />
                    </div>
                  ))}
                  <div>
                    <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '2px' }}>TASA %</div>
                    <input type="number" value={addRate} onChange={e => setAddRate(e.target.value)} style={{ ...fStyle, width: '100%', textAlign: 'right', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <button
                  onClick={handleAddPosition}
                  disabled={!addProjectId || adding}
                  style={{ background: !addProjectId ? colors.border : colors.primary, border: 'none', color: colors.neutral, cursor: !addProjectId ? 'not-allowed' : 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '5px 12px', opacity: adding ? 0.6 : 1 }}
                >
                  {adding ? 'GUARDANDO…' : 'AGREGAR'}
                </button>
              </div>
            )
          })()}

          {positions.length === 0 && !showAdd ? (
            <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, marginTop: '8px' }}>
              Sin proyectos asociados
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  {['PROYECTO', 'INTERESADO', 'COMPROMETIDO', 'FONDEADO', 'TASA', ''].map(h => (
                    <th key={h} style={{ padding: '5px 8px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, textAlign: h === 'PROYECTO' ? 'left' : 'right', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => {
                  const isEditing = editingProjectId === pos.projectId
                  return (
                    <tr key={pos.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td
                        style={{ padding: '5px 8px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, cursor: 'pointer' }}
                        onClick={() => navigate(`/proyectos/${pos.projectId}`)}
                      >
                        {pos.projectName || `Proyecto ${pos.projectId}`}
                      </td>
                      {isEditing ? (
                        <>
                          <td style={{ padding: '4px 8px', textAlign: 'right' }}><input type="number" value={editInterested} onChange={e => setEditInterested(e.target.value)} style={iStyle} /></td>
                          <td style={{ padding: '4px 8px', textAlign: 'right' }}><input type="number" value={editCommitted} onChange={e => setEditCommitted(e.target.value)} style={iStyle} /></td>
                          <td style={{ padding: '4px 8px', textAlign: 'right' }}><input type="number" value={editFunded} onChange={e => setEditFunded(e.target.value)} style={iStyle} /></td>
                          <td style={{ padding: '4px 8px', textAlign: 'right' }}><input type="number" value={editRate} onChange={e => setEditRate(e.target.value)} style={{ ...iStyle, width: '44px' }} /></td>
                          <td style={{ padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button onClick={() => handleSaveEdit(pos)} disabled={savingEdit} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 7px', marginRight: '3px', opacity: savingEdit ? 0.6 : 1 }}>{savingEdit ? '…' : 'OK'}</button>
                            <button onClick={() => setEditingProjectId(null)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '2px 5px' }}>✕</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '5px 8px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, textAlign: 'right' }}>{pos.interestedAmount ? fmt(pos.interestedAmount) : '—'}</td>
                          <td style={{ padding: '5px 8px', fontFamily: fonts.sans, fontSize: '11px', color: pos.committedAmount ? colors.tertiary : colors.secondary, textAlign: 'right' }}>{pos.committedAmount ? fmt(pos.committedAmount) : '—'}</td>
                          <td style={{ padding: '5px 8px', fontFamily: fonts.sans, fontSize: '11px', color: pos.fundedAmount ? colors.primary : colors.secondary, textAlign: 'right' }}>{pos.fundedAmount ? fmt(pos.fundedAmount) : '—'}</td>
                          <td style={{ padding: '5px 8px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>{Math.round(pos.interestRateAnnual * 100)}%</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button onClick={() => startEdit(pos)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.05em', padding: '2px 7px', marginRight: '3px' }}>EDITAR</button>
                            <button onClick={() => handleRemovePosition(pos)} style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '0 2px' }}>✕</button>
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
      </div>
    </div>
  )
}
