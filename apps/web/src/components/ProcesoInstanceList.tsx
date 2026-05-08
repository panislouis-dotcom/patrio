import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchInstances, createInstance, fetchTemplates, fetchProjects, fetchTeam } from '../lib/api'
import type { ProcessInstance, ProcessTemplate, Project, TeamMember } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { PROCESS_INSTANCE_STATUS_COLOR } from '../lib/status'

const TIPO_COLOR: Record<string, string> = {
  proyecto: colors.primary,
  periodica: colors.tertiary,
  one_time: colors.secondary,
}

const TIPO_LABEL: Record<string, string> = {
  proyecto: 'PROYECTO',
  periodica: 'PERIÓDICA',
  one_time: 'UNA VEZ',
}

const PERSON_FILTER_KEY = 'procesoCurrentUserId'

function getReportIds(managerId: number, team: TeamMember[]): number[] {
  const result: number[] = []
  const queue = team.filter(m => m.managerId === managerId).map(m => m.id)
  while (queue.length) {
    const id = queue.shift()!
    result.push(id)
    team.filter(m => m.managerId === id).forEach(m => queue.push(m.id))
  }
  return result
}

export function ProcesoInstanceList() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [instances, setInstances] = useState<ProcessInstance[]>([])
  const [templates, setTemplates] = useState<ProcessTemplate[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [personFilter, setPersonFilter] = useState<'mine' | 'team' | null>(null)
  const [currentUserId, setCurrentUserId] = useState<number | null>(() => {
    const stored = localStorage.getItem(PERSON_FILTER_KEY)
    return stored ? Number(stored) : null
  })
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)

  // Form fields
  const [newName, setNewName] = useState('')
  const [newTemplateId, setNewTemplateId] = useState<string>('')
  const [newProjectId, setNewProjectId] = useState<string>('')
  const [newOwnerId, setNewOwnerId] = useState<string>('')
  const [newStartDate, setNewStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [newFrequencyDays, setNewFrequencyDays] = useState<string>('')
  const [newDueDate, setNewDueDate] = useState<string>('')

  useEffect(() => {
    Promise.all([fetchInstances(), fetchTemplates(), fetchProjects(), fetchTeam()]).then(
      ([insts, tmps, projs, members]) => {
        setInstances(insts)
        setTemplates(tmps)
        setProjects(projs)
        setTeam(members)
        setLoading(false)
      }
    )
  }, [])

  // Pre-fill form from URL params (e.g. from ProjectDetailPage "+ NUEVA TAREA")
  useEffect(() => {
    const pId = searchParams.get('proyecto')
    if (pId) { setNewProjectId(pId); setShowForm(true) }
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const inst = await createInstance({
        name: newName.trim(),
        templateId: newTemplateId ? Number(newTemplateId) : null,
        projectId: newProjectId ? Number(newProjectId) : null,
        ownerId: newOwnerId ? Number(newOwnerId) : null,
        startDate: newStartDate,
        frequencyDays: newFrequencyDays ? Number(newFrequencyDays) : null,
        dueDate: newDueDate || null,
      })
      setInstances(prev => [inst, ...prev])
      setNewName('')
      setShowForm(false)
      navigate(`/procesos/tareas/${inst.id}`)
    } finally {
      setCreating(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    color: colors.neutral,
    fontFamily: fonts.sans,
    fontSize: '12px',
    padding: '5px 8px',
    outline: 'none',
  }

  function handleUserChange(id: number | null) {
    setCurrentUserId(id)
    if (id === null) {
      localStorage.removeItem(PERSON_FILTER_KEY)
      setPersonFilter(null)
    } else {
      localStorage.setItem(PERSON_FILTER_KEY, String(id))
    }
  }

  const reportIds = currentUserId !== null ? getReportIds(currentUserId, team) : []

  const filtered = instances.filter(i => {
    if (typeFilter !== 'all' && i.taskType !== typeFilter) return false
    if (personFilter === 'mine') return i.ownerId === currentUserId
    if (personFilter === 'team') return i.ownerId !== null && reportIds.includes(i.ownerId)
    return true
  })

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: fonts.label, fontSize: '11px', color: colors.neutral, letterSpacing: '0.1em' }}>TAREAS</span>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{ background: showForm ? colors.border : colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.08em', padding: '6px 14px' }}
        >
          {showForm ? 'CANCELAR' : '+ NUEVA TAREA'}
        </button>
      </div>

      {/* Type filter bar */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {[
          { key: 'all', label: 'TODAS' },
          { key: 'proyecto', label: 'PROYECTO' },
          { key: 'periodica', label: 'PERIÓDICA' },
          { key: 'one_time', label: 'UNA VEZ' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setTypeFilter(f.key)}
            style={{
              background: typeFilter === f.key ? colors.primary : 'transparent',
              border: `1px solid ${typeFilter === f.key ? colors.primary : colors.border}`,
              color: typeFilter === f.key ? colors.neutral : colors.secondary,
              cursor: 'pointer',
              fontFamily: fonts.label,
              fontSize: '9px',
              letterSpacing: '0.08em',
              padding: '3px 10px',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Person filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.08em' }}>SOY:</span>
        <select
          value={currentUserId ?? ''}
          onChange={e => handleUserChange(e.target.value ? Number(e.target.value) : null)}
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '3px 6px', outline: 'none' }}
        >
          <option value="">— Seleccionar</option>
          {team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {currentUserId !== null && (
          <>
            {[
              { key: 'mine' as const, label: 'MIS TAREAS' },
              { key: 'team' as const, label: 'MI EQUIPO' },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setPersonFilter(prev => prev === f.key ? null : f.key)}
                style={{
                  background: personFilter === f.key ? colors.tertiary : 'transparent',
                  border: `1px solid ${personFilter === f.key ? colors.tertiary : colors.border}`,
                  color: personFilter === f.key ? colors.neutral : colors.secondary,
                  cursor: 'pointer',
                  fontFamily: fonts.label,
                  fontSize: '9px',
                  letterSpacing: '0.08em',
                  padding: '3px 10px',
                }}
              >
                {f.label}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          style={{ background: colors.surfaceAlt, border: `1px solid ${colors.border}`, padding: '16px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nombre"
            autoFocus
            style={{ ...inputStyle, minWidth: '180px' }}
          />
          <select value={newTemplateId} onChange={e => setNewTemplateId(e.target.value)} style={inputStyle}>
            <option value="">Sin proceso</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={newProjectId} onChange={e => setNewProjectId(e.target.value)} style={inputStyle}>
            <option value="">— Sin proyecto</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            type="number"
            min="1"
            placeholder="Cada X días"
            value={newFrequencyDays}
            onChange={e => setNewFrequencyDays(e.target.value)}
            style={{ ...inputStyle, width: '110px' }}
          />
          <input
            type="date"
            value={newDueDate}
            onChange={e => setNewDueDate(e.target.value)}
            style={inputStyle}
          />
          <select value={newOwnerId} onChange={e => setNewOwnerId(e.target.value)} style={inputStyle}>
            <option value="">— Sin dueño</option>
            {team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input
            type="date"
            value={newStartDate}
            onChange={e => setNewStartDate(e.target.value)}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            style={{
              background: (creating || !newName.trim()) ? colors.border : colors.primary,
              border: 'none',
              color: colors.neutral,
              cursor: creating ? 'not-allowed' : 'pointer',
              fontFamily: fonts.label,
              fontSize: '10px',
              letterSpacing: '0.08em',
              padding: '6px 14px',
              opacity: creating ? 0.6 : 1,
            }}
          >
            {creating ? 'CREANDO…' : 'CREAR'}
          </button>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', padding: '6px 10px' }}
          >
            CANCELAR
          </button>
        </form>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Cargando…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Sin tareas. Crea una desde una plantilla.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['NOMBRE', 'TIPO', 'DUEÑO', 'PLANTILLA', 'ESTADO', 'INICIO'].map(h => (
                <th key={h} style={{ padding: '6px 12px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'left', letterSpacing: '0.12em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(inst => (
              <tr
                key={inst.id}
                onClick={() => navigate(`/procesos/tareas/${inst.id}`)}
                style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceAlt)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '8px 12px', fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>{inst.name}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.08em', color: TIPO_COLOR[inst.taskType] ?? colors.secondary }}>
                    {TIPO_LABEL[inst.taskType] ?? inst.taskType}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary }}>{inst.ownerName ?? '—'}</td>
                <td style={{ padding: '8px 12px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary }}>{inst.templateName ?? '—'}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: PROCESS_INSTANCE_STATUS_COLOR[inst.status] ?? colors.secondary, textTransform: 'uppercase' }}>
                    {inst.status}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', fontFamily: fonts.label, fontSize: '10px', color: colors.secondary }}>{inst.startDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
