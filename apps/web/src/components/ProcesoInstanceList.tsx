import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchInstances, createInstance, fetchTemplates, fetchProjects } from '../lib/api'
import type { ProcessInstance, ProcessTemplate, Project } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { PROCESS_INSTANCE_STATUS_COLOR } from '../lib/status'

export function ProcesoInstanceList() {
  const navigate = useNavigate()
  const [instances, setInstances] = useState<ProcessInstance[]>([])
  const [templates, setTemplates] = useState<ProcessTemplate[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTemplateId, setNewTemplateId] = useState<string>('')
  const [newProjectId, setNewProjectId] = useState<string>('')
  const [newStartDate, setNewStartDate] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => {
    Promise.all([fetchInstances(), fetchTemplates(), fetchProjects()]).then(([insts, tmps, projs]) => {
      setInstances(insts)
      setTemplates(tmps)
      setProjects(projs)
      if (tmps.length > 0) setNewTemplateId(String(tmps[0].id))
      setLoading(false)
    })
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim() || !newTemplateId) return
    setCreating(true)
    try {
      const inst = await createInstance({
        name: newName.trim(),
        templateId: Number(newTemplateId),
        startDate: newStartDate,
        projectId: newProjectId ? Number(newProjectId) : null,
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
    background: colors.surface, border: `1px solid ${colors.border}`,
    color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px',
    padding: '5px 8px', outline: 'none',
  }

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: fonts.label, fontSize: '11px', color: colors.neutral, letterSpacing: '0.1em' }}>TAREAS</span>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{ background: showForm ? colors.border : colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.08em', padding: '6px 14px' }}
        >
          {showForm ? 'CANCELAR' : '+ NUEVA TAREA'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} style={{ background: colors.surfaceAlt, border: `1px solid ${colors.border}`, padding: '16px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre de la tarea" autoFocus style={{ ...inputStyle, minWidth: '200px' }} />
          <select value={newTemplateId} onChange={e => setNewTemplateId(e.target.value)} style={inputStyle}>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={newProjectId} onChange={e => setNewProjectId(e.target.value)} style={inputStyle}>
            <option value="">— Sin proyecto</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={newStartDate} onChange={e => setNewStartDate(e.target.value)} style={inputStyle} />
          <button
            type="submit"
            disabled={creating || !newName.trim() || !newTemplateId}
            style={{ background: creating || !newName.trim() ? colors.border : colors.primary, border: 'none', color: colors.neutral, cursor: creating ? 'not-allowed' : 'pointer', fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.08em', padding: '6px 14px', opacity: creating ? 0.6 : 1 }}
          >
            {creating ? 'CREANDO…' : 'CREAR'}
          </button>
        </form>
      )}

      {loading ? (
        <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Cargando…</div>
      ) : instances.length === 0 ? (
        <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Sin tareas. Crea una desde una plantilla.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['NOMBRE', 'PLANTILLA', 'PROYECTO', 'ESTADO', 'INICIO'].map(h => (
                <th key={h} style={{ padding: '6px 12px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'left', letterSpacing: '0.12em' }}>{h}</th>
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
                <td style={{ padding: '8px 12px', fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>{inst.name}</td>
                <td style={{ padding: '8px 12px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.06em' }}>{inst.templateName}</td>
                <td style={{ padding: '8px 12px', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em' }}>
                  {inst.projectName ? (
                    <span
                      onClick={e => { e.stopPropagation(); navigate(`/proyectos/${inst.projectId}`) }}
                      style={{ color: colors.tertiary, cursor: 'pointer', textDecoration: 'underline dotted' }}
                    >
                      {inst.projectName}
                    </span>
                  ) : (
                    <span style={{ color: colors.border }}>—</span>
                  )}
                </td>
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
