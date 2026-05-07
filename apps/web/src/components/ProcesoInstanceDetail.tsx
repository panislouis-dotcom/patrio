import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchInstanceDetail, updateNodeState, fetchTeam } from '../lib/api'
import type { InstanceDetail, GanttNode, NodeState, TeamMember } from '../lib/types'
import { GanttChart } from './GanttChart'
import { colors, fonts } from '../lib/theme'
import { PROCESS_STATUS_COLOR, PROCESS_STATUS_LABEL } from '../lib/status'
import { computeDepths, getDescendantIds } from '../lib/treeUtils'

const STATUS_OPTIONS = ['pending', 'in_progress', 'done', 'skipped'] as const

export function ProcesoInstanceDetail() {
  const { iid } = useParams<{ iid: string }>()
  const navigate = useNavigate()
  const instanceId = Number(iid)

  const [detail, setDetail] = useState<InstanceDetail | null>(null)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [states, setStates] = useState<NodeState[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const toggleCollapse = (id: number) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

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

  const childMap = useMemo(() => {
    const m = new Map<number | null, number[]>()
    detail?.nodes.forEach(n => {
      const arr = m.get(n.parentId) ?? []
      arr.push(n.id)
      m.set(n.parentId, arr)
    })
    return m
  }, [detail?.nodes])

  const hasChildren = (id: number) => (childMap.get(id)?.length ?? 0) > 0

  function isAncestorCollapsed(node: GanttNode, nodes: GanttNode[]): boolean {
    let pid = node.parentId
    while (pid !== null) {
      if (collapsed.has(pid)) return true
      const parent = nodes.find(n => n.id === pid)
      pid = parent?.parentId ?? null
    }
    return false
  }

  function getProgress(nodeId: number, nodes: GanttNode[]): number {
    const descIds = getDescendantIds(nodeId, nodes)
    const leaves = descIds.filter(id => !hasChildren(id))
    if (leaves.length === 0) return 0
    const done = leaves.filter(id => getState(id)?.status === 'done').length
    return Math.round(done / leaves.length * 100)
  }

  const depths = useMemo(() =>
    detail ? computeDepths(detail.nodes) : new Map<number, number>(),
    [detail?.nodes]
  )

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
        <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span>Inicio: {instance.startDate}</span>
          <span style={{ color: colors.border }}>·</span>
          <span style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em', color: colors.secondary }}>{instance.templateName}</span>
          {instance.projectName && (
            <>
              <span style={{ color: colors.border }}>·</span>
              <span
                onClick={() => navigate(`/proyectos/${instance.projectId}`)}
                style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em', color: colors.tertiary, cursor: 'pointer', textDecoration: 'underline dotted' }}
              >
                {instance.projectName}
              </span>
            </>
          )}
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
              <th style={{ padding: '5px 10px', textAlign: 'right', fontFamily: fonts.label, fontSize: '10px', color: colors.secondary }}>DÍ/INST</th>
            </tr>
          </thead>
          <tbody>
            {nodes.filter(n => !isAncestorCollapsed(n, nodes)).map(n => {
              const s = getState(n.id)
              const currentStatus = s?.status ?? 'pending'
              const isRoot = n.parentId === null
              const depth = depths.get(n.id) ?? 0
              const indent = depth * 16
              return (
                <tr key={n.id} style={{
                  borderBottom: `1px solid ${colors.border}`,
                  background: isRoot ? colors.surfaceAlt : 'transparent',
                  borderLeft: isRoot ? `2px solid ${colors.primary}` : '2px solid transparent',
                }}>
                    <td style={{ padding: '5px 10px', paddingLeft: `${10 + indent}px` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {hasChildren(n.id) && (
                          <button
                            onClick={() => toggleCollapse(n.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: colors.secondary,
                              cursor: 'pointer',
                              padding: '0 2px',
                              fontSize: '10px',
                              fontFamily: fonts.label,
                            }}
                          >
                            {collapsed.has(n.id) ? '▶' : '▼'}
                          </button>
                        )}
                        {!hasChildren(n.id) && <span style={{ width: 16 }} />}
                        <span
                          onClick={() => navigate(`/procesos/tareas/${detail.instance.id}/nodos/${n.id}`)}
                          style={{ cursor: 'pointer', color: colors.neutral, textDecoration: 'underline dotted' }}
                        >
                          {n.name}
                        </span>
                        {hasChildren(n.id) && (
                          <span style={{ fontSize: '10px', color: colors.secondary, marginLeft: 4 }}>
                            {getProgress(n.id, nodes)}%
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <select
                        value={currentStatus}
                        onChange={e => handleStateChange(n.id, 'status', e.target.value)}
                        style={{ ...inputStyle, color: PROCESS_STATUS_COLOR[currentStatus] ?? colors.neutral }}
                      >
                        {STATUS_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{PROCESS_STATUS_LABEL[opt]}</option>
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
                    <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                      {!hasChildren(n.id) && (
                        <input
                          type="number"
                          min={1}
                          placeholder={n.durationDays != null ? String(n.durationDays) : '?'}
                          value={s?.durationOverrideDays ?? ''}
                          onChange={e => {
                            const val = e.target.value === '' ? null : Number(e.target.value)
                            handleStateChange(n.id, 'durationOverrideDays', val)
                          }}
                          style={{
                            width: 48,
                            background: 'transparent',
                            border: `1px solid ${colors.border}`,
                            color: colors.neutral,
                            fontFamily: fonts.label,
                            fontSize: '11px',
                            padding: '2px 4px',
                            textAlign: 'right',
                          }}
                        />
                      )}
                    </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
