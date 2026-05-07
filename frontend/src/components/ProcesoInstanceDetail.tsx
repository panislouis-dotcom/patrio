import { useEffect, useState, useCallback, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchInstanceDetail, updateNodeState, fetchTeam, createNode } from '../lib/api'
import type { InstanceDetail, GanttNode, NodeState, TeamMember } from '../lib/types'
import { GanttChart } from './GanttChart'
import { colors, fonts } from '../lib/theme'

const STATUS_OPTIONS = ['pending', 'in_progress', 'done', 'skipped'] as const
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente', in_progress: 'En progreso', done: 'Completado', skipped: 'Omitido'
}
const STATUS_COLOR: Record<string, string> = {
  pending: colors.secondary, in_progress: colors.tertiary, done: colors.primary, skipped: colors.border
}

export function ProcesoInstanceDetail() {
  const { iid } = useParams<{ iid: string }>()
  const navigate = useNavigate()
  const instanceId = Number(iid)

  const [detail, setDetail] = useState<InstanceDetail | null>(null)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [states, setStates] = useState<NodeState[]>([])
  const [loading, setLoading] = useState(true)
  const [definingNodeId, setDefiningNodeId] = useState<number | null>(null)
  const [defName, setDefName] = useState('')
  const [defDays, setDefDays] = useState('')
  const [defDepOn, setDefDepOn] = useState<string>('')
  const [defSaving, setDefSaving] = useState(false)

  useEffect(() => {
    Promise.all([fetchInstanceDetail(instanceId), fetchTeam()]).then(([d, t]) => {
      setDetail(d)
      setStates(d.states)
      setTeam(t)
      setLoading(false)
    })
  }, [instanceId])

  const getState = useCallback((nodeId: number): NodeState | undefined => {
    return states.find(s => s.templateNodeId === nodeId)
  }, [states])

  function getDescendants(nodeId: number, allNodes: GanttNode[]): number[] {
    const children = allNodes.filter(n => n.parentId === nodeId)
    return children.flatMap(c => [c.id, ...getDescendants(c.id, allNodes)])
  }

  async function handleStateChange(nodeId: number, field: string, value: string | number | null) {
    const allNodes = detail?.nodes ?? []
    const targets = field === 'status' || field === 'assigneeId'
      ? [nodeId, ...getDescendants(nodeId, allNodes)]
      : [nodeId]

    const results = await Promise.all(
      targets.map(id => updateNodeState(instanceId, id, { [field]: value }))
    )

    setStates(prev => {
      let next = [...prev]
      for (const updated of results) {
        const exists = next.find(s => s.templateNodeId === updated.templateNodeId)
        if (exists) {
          next = next.map(s => s.templateNodeId === updated.templateNodeId ? updated : s)
        } else {
          next = [...next, updated]
        }
      }
      return next
    })
  }

  async function handleDefine(nodeId: number, templateId: number, siblings: GanttNode[]) {
    if (!defName.trim()) return
    setDefSaving(true)
    try {
      await createNode(templateId, {
        name: defName.trim(),
        durationDays: defDays !== '' ? Number(defDays) : null,
        parentId: nodeId,
        sortOrder: siblings.length,
        dependsOnId: defDepOn ? Number(defDepOn) : null,
      })
      const refreshed = await fetchInstanceDetail(instanceId)
      setDetail(refreshed)
      setStates(refreshed.states)
      setDefiningNodeId(null)
      setDefName('')
      setDefDays('')
      setDefDepOn('')
    } finally {
      setDefSaving(false)
    }
  }

  if (loading || !detail) {
    return <div style={{ padding: '24px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Cargando…</div>
  }

  const { instance, nodes } = detail
  const totalDays = Math.max(1, ...nodes.map(n => n.ganttStart + n.ganttDuration))

  const inputStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    color: colors.neutral,
    fontFamily: fonts.sans,
    fontSize: '11px',
    padding: '3px 6px',
    outline: 'none',
  }

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div>
        <button onClick={() => navigate('/procesos/tareas')} style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', marginBottom: '8px', padding: 0 }}>
          ← TAREAS
        </button>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ fontFamily: fonts.sans, fontSize: '18px', color: colors.neutral }}>{instance.name}</span>
          <span style={{
            fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em',
            padding: '2px 8px',
            background: instance.status === 'active' ? colors.primary : instance.status === 'completed' ? colors.surfaceAlt : colors.border,
            color: colors.neutral,
          }}>
            {instance.status.toUpperCase()}
          </span>
        </div>
        <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, marginTop: '4px' }}>
          Inicio: {instance.startDate}
          {instance.projectId && ` · Proyecto #${instance.projectId}`}
        </div>
      </div>

      {/* Gantt */}
      <div>
        <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '12px' }}>
          CRONOGRAMA
        </div>
        <GanttChart nodes={nodes} totalDays={totalDays} states={states} />
      </div>

      {/* Estado table */}
      <div>
        <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '12px' }}>
          ESTADO DE TAREAS
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['TAREA', 'ESTADO', 'RESPONSABLE', 'INICIO REAL', 'FIN REAL'].map(h => (
                <th key={h} style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'left', letterSpacing: '0.1em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nodes.map(n => {
              const s = getState(n.id)
              const currentStatus = s?.status ?? 'pending'
              const isRoot = n.parentId === null
              const existingChildren = nodes.filter(c => c.parentId === n.id)
              return (
                <Fragment key={n.id}>
                  <tr style={{
                    borderBottom: `1px solid ${colors.border}`,
                    background: isRoot ? colors.surfaceAlt : 'transparent',
                    borderLeft: isRoot ? `2px solid ${colors.primary}` : '2px solid transparent',
                  }}>
                    <td style={{ padding: '6px 10px' }}>
                      <div style={{ fontFamily: fonts.sans, fontSize: isRoot ? '12px' : '11px', color: n.isDefinir ? colors.tertiary : (isRoot ? colors.neutral : colors.secondary), paddingLeft: isRoot ? '0' : '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {n.name}
                        {n.isDefinir && (
                          <button
                            onClick={() => { setDefiningNodeId(n.id); setDefName(''); setDefDays(''); setDefDepOn('') }}
                            style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.tertiary, letterSpacing: '0.08em', border: `1px dashed ${colors.tertiary}`, padding: '1px 6px', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                          >
                            DEFINIR ▸
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <select
                        value={currentStatus}
                        onChange={e => handleStateChange(n.id, 'status', e.target.value)}
                        style={{ ...inputStyle, color: STATUS_COLOR[currentStatus] ?? colors.neutral }}
                      >
                        {STATUS_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{STATUS_LABEL[opt]}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <select
                        value={s?.assigneeId ?? ''}
                        onChange={e => handleStateChange(n.id, 'assigneeId', e.target.value ? Number(e.target.value) : null)}
                        style={inputStyle}
                      >
                        <option value="">— Sin asignar</option>
                        {team.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input
                        type="date"
                        value={s?.actualStart ?? ''}
                        onChange={e => handleStateChange(n.id, 'actualStart', e.target.value || null)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input
                        type="date"
                        value={s?.actualEnd ?? ''}
                        onChange={e => handleStateChange(n.id, 'actualEnd', e.target.value || null)}
                        style={inputStyle}
                      />
                    </td>
                  </tr>
                  {definingNodeId === n.id && (
                    <tr>
                      <td colSpan={5} style={{ padding: '8px 16px', background: colors.surfaceAlt, borderBottom: `1px solid ${colors.border}` }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            placeholder="Nombre de la sub-tarea"
                            value={defName}
                            onChange={e => setDefName(e.target.value)}
                            autoFocus
                            style={{ ...inputStyle, minWidth: '160px' }}
                          />
                          <input
                            placeholder="Días"
                            type="number"
                            min="1"
                            value={defDays}
                            onChange={e => setDefDays(e.target.value)}
                            style={{ ...inputStyle, width: '70px' }}
                          />
                          {existingChildren.length > 0 && (
                            <select value={defDepOn} onChange={e => setDefDepOn(e.target.value)} style={inputStyle}>
                              <option value="">Sin dependencia</option>
                              {existingChildren.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          )}
                          <button
                            onClick={() => handleDefine(n.id, n.templateId, existingChildren)}
                            disabled={defSaving || !defName.trim()}
                            style={{ background: defSaving || !defName.trim() ? colors.border : colors.primary, border: 'none', color: colors.neutral, cursor: defSaving ? 'not-allowed' : 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '4px 10px', opacity: defSaving ? 0.6 : 1 }}
                          >
                            {defSaving ? '…' : 'AGREGAR'}
                          </button>
                          <button
                            onClick={() => setDefiningNodeId(null)}
                            style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '4px 8px' }}
                          >
                            CANCELAR
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
