import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchInstanceDetail, updateNodeState, fetchTeam, updateInstance, uploadInstanceFile, deleteInstanceFile } from '../lib/api'
import type { InstanceDetail, GanttNode, NodeState, TeamMember, InstanceFile } from '../lib/types'
import { GanttChart } from './GanttChart'
import { colors, fonts } from '../lib/theme'
import { PROCESS_STATUS_COLOR, PROCESS_STATUS_LABEL } from '../lib/status'
import { computeDepths, getDescendantIds, getSubtree } from '../lib/treeUtils'

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
  const [localOwnerId, setLocalOwnerId] = useState<number | null>(null)
  const [focusNodeId, setFocusNodeId] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<InstanceFile[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

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
      setLocalOwnerId(d.instance.ownerId ?? null)
      setLoading(false)
    })
  }, [instanceId, refreshKey])

  useEffect(() => {
    if (!detail) return
    setNotes(detail.instance.notes ?? '')
    setFiles((detail as InstanceDetail & { files: InstanceFile[] }).files ?? [])
  }, [detail?.instance.id])

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

  function isAncestorCollapsed(node: GanttNode, list: GanttNode[]): boolean {
    let pid = node.parentId
    while (pid !== null) {
      if (collapsed.has(pid)) return true
      const parent = list.find(n => n.id === pid)
      if (!parent) break  // stop at boundary (don't walk above subtree root when focused)
      pid = parent.parentId ?? null
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

  const focusPath = useMemo(() => {
    if (!focusNodeId || !detail) return []
    const path: GanttNode[] = []
    let cursor: GanttNode | undefined = detail.nodes.find(n => n.id === focusNodeId)
    while (cursor) {
      path.unshift(cursor)
      cursor = cursor.parentId != null ? detail.nodes.find(n => n.id === cursor!.parentId) : undefined
    }
    return path
  }, [focusNodeId, detail])

  async function handleOwnerChange(ownerId: number | null) {
    setLocalOwnerId(ownerId)
    await updateInstance(instanceId, { ownerId })
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

    // Duration overrides change Gantt bar positions — refetch to get recomputed layout.
    if (field === 'durationOverrideDays') {
      const refreshed = await fetchInstanceDetail(instanceId)
      setDetail(prev => prev ? { ...prev, nodes: refreshed.nodes } : prev)
      setStates(refreshed.states)
    }
  }

  if (loading || !detail) {
    return <div style={{ padding: '24px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Cargando…</div>
  }

  const { instance, nodes } = detail
  const instanceAnchorMs = new Date(instance.startDate).getTime()
  const actualMaxDays = (detail.states ?? [])
    .filter(s => s.actualEnd)
    .map(s => Math.ceil((new Date(s.actualEnd!).getTime() - instanceAnchorMs) / 86400000))
  const totalDays = Math.max(1, ...nodes.map(n => n.ganttStart + n.ganttDuration), ...actualMaxDays)

  const inputStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    color: colors.neutral,
    fontFamily: fonts.sans,
    fontSize: '11px',
    padding: '3px 6px',
    outline: 'none',
  }

  const notesAndFilesSection = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Notes */}
      <div>
        <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '8px' }}>NOTAS</div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={async () => {
            if (!detail || notes === detail.instance.notes) return
            await updateInstance(detail.instance.id, { notes })
          }}
          placeholder="Notas, contexto, decisiones…"
          rows={4}
          style={{
            width: '100%',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            color: colors.neutral,
            fontFamily: fonts.sans,
            fontSize: '12px',
            padding: '8px',
            outline: 'none',
            resize: 'vertical',
            lineHeight: 1.5,
            boxSizing: 'border-box' as const,
          }}
        />
      </div>
      {/* Files */}
      <div>
        <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '8px' }}>ARCHIVOS</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {files.map(f => (
            <div key={f.id} style={{ position: 'relative', width: 80, height: 80 }}>
              {f.contentType.startsWith('image/') ? (
                <img
                  src={`http://localhost:8000/files/${f.filePath}`}
                  alt={f.fileName}
                  style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 2 }}
                />
              ) : (
                <div style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.border, borderRadius: 2, fontSize: '9px', color: colors.secondary, fontFamily: fonts.label, padding: 4, textAlign: 'center' }}>
                  {f.fileName}
                </div>
              )}
              <button
                onClick={async () => {
                  await deleteInstanceFile(f.id)
                  setFiles(prev => prev.filter(x => x.id !== f.id))
                }}
                style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: '10px', lineHeight: '18px', textAlign: 'center', padding: 0 }}
              >×</button>
            </div>
          ))}
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: colors.surfaceAlt, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.08em', padding: '6px 12px', cursor: 'pointer' }}>
          + SUBIR ARCHIVO
          <input
            type="file"
            style={{ display: 'none' }}
            onChange={async e => {
              const file = e.target.files?.[0]
              if (!file || !detail) return
              const created = await uploadInstanceFile(detail.instance.id, file)
              setFiles(prev => [...prev, created])
              e.target.value = ''
            }}
          />
        </label>
      </div>
    </div>
  )

  const hasTemplate = instance.templateId !== null && nodes.length > 0

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
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            Inicio:
            <input
              type="date"
              value={detail.instance.startDate}
              onChange={async e => {
                if (!e.target.value) return
                await updateInstance(detail.instance.id, { startDate: e.target.value })
                setRefreshKey(k => k + 1)
              }}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${colors.border}`,
                color: colors.secondary,
                fontFamily: fonts.label,
                fontSize: '10px',
                outline: 'none',
                cursor: 'pointer',
              }}
            />
          </span>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
          <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.08em' }}>DUEÑO</span>
          <select
            value={localOwnerId ?? ''}
            onChange={e => handleOwnerChange(e.target.value ? Number(e.target.value) : null)}
            style={{ background: 'transparent', border: 'none', color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', outline: 'none', cursor: 'pointer' }}
          >
            <option value="">— Sin asignar</option>
            {team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      {/* Notes + Files — always visible */}
      {notesAndFilesSection}

      {/* Template path: Gantt + task table */}
      {hasTemplate && (
        <>
          {/* Gantt */}
          <div>
            <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '12px' }}>
              CRONOGRAMA
            </div>
            <GanttChart nodes={nodes} totalDays={totalDays} states={states} instanceStartDate={detail.instance.startDate} />
          </div>

          {/* Focus breadcrumb */}
          {focusNodeId && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', paddingBottom: '8px', borderBottom: `1px solid ${colors.border}` }}>
              <button
                onClick={() => setFocusNodeId(null)}
                style={{ background: 'none', border: 'none', color: colors.tertiary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em', padding: 0 }}
              >
                ← TODAS LAS TAREAS
              </button>
              {focusPath.map((n, i) => (
                <span key={n.id} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ color: colors.border, fontSize: '9px' }}>›</span>
                  {i < focusPath.length - 1 ? (
                    <button
                      onClick={() => setFocusNodeId(n.id)}
                      style={{ background: 'none', border: 'none', color: colors.tertiary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: 0 }}
                    >
                      {n.name}
                    </button>
                  ) : (
                    <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.neutral }}>{n.name}</span>
                  )}
                </span>
              ))}
            </div>
          )}

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
                {(() => {
                  const base = focusNodeId ? getSubtree(focusNodeId, detail.nodes) : detail.nodes
                  return base.filter(n => !isAncestorCollapsed(n, base))
                })().map(n => {
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
                          {hasChildren(n.id) && (
                            <button
                              onClick={e => { e.stopPropagation(); setFocusNodeId(n.id) }}
                              title="Enfocar subtareas"
                              style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '13px', padding: '0 2px', lineHeight: 1, marginLeft: 2 }}
                            >
                              ›
                            </button>
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
        </>
      )}
    </div>
  )
}
