import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  fetchNodeDetail,
  uploadNodeFile,
  createNodeComment,
  deleteNodeComment,
  deleteNodeFile,
  updateNodeState,
  fetchTeam,
} from '../lib/api'
import type { NodeDetail, NodeFile, NodeComment, NodeState, TeamMember } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { computeDepths, getSubtree } from '../lib/treeUtils'
import { PROCESS_STATUS_COLOR, PROCESS_STATUS_LABEL } from '../lib/status'
import { GanttChart } from './GanttChart'

const STATUS_OPTIONS = ['pending', 'in_progress', 'done', 'skipped'] as const

// ─── FileThumb ────────────────────────────────────────────────────────────────

function FileThumb({ f, onDelete }: { f: NodeFile; onDelete: () => void }) {
  const isImage = f.contentType.startsWith('image/')
  const src = `http://localhost:8000/files/${f.filePath}`
  return (
    <div style={{ position: 'relative', width: 80, height: 80 }}>
      {isImage ? (
        <img
          src={src}
          alt={f.fileName}
          style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 2 }}
        />
      ) : (
        <div
          style={{
            width: 80,
            height: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: colors.border,
            borderRadius: 2,
            fontSize: '10px',
            color: colors.secondary,
            fontFamily: fonts.label,
            padding: 4,
            textAlign: 'center',
          }}
        >
          {f.fileName}
        </div>
      )}
      <button
        onClick={onDelete}
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          background: 'rgba(0,0,0,0.6)',
          border: 'none',
          color: '#fff',
          borderRadius: '50%',
          width: 18,
          height: 18,
          cursor: 'pointer',
          fontSize: '10px',
          lineHeight: '18px',
          textAlign: 'center',
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}

// ─── Section label style ──────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontFamily: fonts.label,
  fontSize: '10px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: colors.secondary,
  marginBottom: 8,
  marginTop: 24,
}

// ─── ProcesoNodeDetail ────────────────────────────────────────────────────────

export function ProcesoNodeDetail() {
  const { iid, nid: nidStr } = useParams<{ iid: string; nid: string }>()
  const navigate = useNavigate()
  const iidNum = Number(iid)
  const nidNum = Number(nidStr)

  const [detail, setDetail] = useState<NodeDetail | null>(null)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)

  // Notes state
  const nodeState = detail?.states.find(s => s.templateNodeId === nidNum)
  const [notesValue, setNotesValue] = useState('')

  useEffect(() => {
    setNotesValue(nodeState?.notes ?? '')
  }, [nodeState?.notes])

  // Comments state
  const [author, setAuthor] = useState(() => localStorage.getItem('comentarioAutor') ?? '')
  const [commentBody, setCommentBody] = useState('')

  // Load data on mount
  useEffect(() => {
    Promise.all([fetchNodeDetail(iidNum, nidNum), fetchTeam()]).then(([d, t]) => {
      setDetail(d)
      setTeam(t)
      setLoading(false)
    })
  }, [iidNum, nidNum])

  // ─── Subtree + Gantt ──────────────────────────────────────────────────────

  const subtreeNodes = useMemo(() => {
    if (!detail) return []
    return getSubtree(nidNum, detail.allNodes)
  }, [detail, nidNum])

  const rootStart = useMemo(
    () => subtreeNodes.find(n => n.id === nidNum)?.ganttStart ?? 0,
    [subtreeNodes, nidNum],
  )

  const normalizedNodes = useMemo(() => {
    if (!subtreeNodes.length) return []
    return subtreeNodes.map(n => ({ ...n, ganttStart: n.ganttStart - rootStart }))
  }, [subtreeNodes, rootStart])

  // Shift the instance anchor by rootStart so actual bar positions align with normalized planned bars
  const normalizedInstanceStartDate = useMemo(() => {
    if (!detail?.instance.startDate) return undefined
    const d = new Date(detail.instance.startDate)
    d.setDate(d.getDate() + rootStart)
    return d.toISOString().slice(0, 10)
  }, [detail?.instance.startDate, rootStart])

  const totalDays = useMemo(() => {
    const planMax = Math.max(...normalizedNodes.map(n => n.ganttStart + n.ganttDuration), 1)
    if (!normalizedInstanceStartDate) return planMax
    const anchorMs = new Date(normalizedInstanceStartDate).getTime()
    const actualMax = (detail?.states ?? [])
      .filter(s => s.actualEnd)
      .map(s => Math.max(0, Math.ceil((new Date(s.actualEnd!).getTime() - anchorMs) / 86400000)))
    return Math.max(planMax, ...actualMax, 1)
  }, [normalizedNodes, normalizedInstanceStartDate, detail?.states])

  const depths = useMemo(
    () => (detail ? computeDepths(detail.allNodes) : new Map<number, number>()),
    [detail],
  )

  // ─── Estado table: state changes ─────────────────────────────────────────

  const getState = useCallback(
    (nodeId: number): NodeState | undefined =>
      detail?.states.find(s => s.templateNodeId === nodeId),
    [detail],
  )

  async function handleStateChange(
    nodeId: number,
    field: string,
    value: string | number | null,
  ) {
    const updated = await updateNodeState(iidNum, nodeId, { [field]: value })
    setDetail(prev => {
      if (!prev) return prev
      const exists = prev.states.find(s => s.templateNodeId === updated.templateNodeId)
      const newStates = exists
        ? prev.states.map(s => (s.templateNodeId === updated.templateNodeId ? updated : s))
        : [...prev.states, updated]
      return { ...prev, states: newStates }
    })
  }

  // ─── Notes ───────────────────────────────────────────────────────────────

  const handleNotesBlur = async () => {
    if (!detail) return
    await updateNodeState(detail.instance.id, nidNum, { notes: notesValue })
  }

  // ─── File upload ──────────────────────────────────────────────────────────

  const handleUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'reference' | 'evidence',
  ) => {
    const file = e.target.files?.[0]
    if (!file || !detail) return
    await uploadNodeFile(nidNum, file, type === 'evidence' ? detail.instance.id : undefined)
    const refreshed = await fetchNodeDetail(detail.instance.id, nidNum)
    setDetail(refreshed)
    e.target.value = ''
  }

  const handleDeleteFile = async (fid: number) => {
    if (!detail) return
    await deleteNodeFile(fid)
    const refreshed = await fetchNodeDetail(detail.instance.id, nidNum)
    setDetail(refreshed)
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  const handleAuthorChange = (v: string) => {
    setAuthor(v)
    localStorage.setItem('comentarioAutor', v)
  }

  const handleSubmitComment = async () => {
    if (!commentBody.trim() || !detail) return
    await createNodeComment(detail.instance.id, nidNum, commentBody, author)
    const refreshed = await fetchNodeDetail(detail.instance.id, nidNum)
    setDetail(refreshed)
    setCommentBody('')
  }

  const handleDeleteComment = async (cid: number) => {
    if (!detail) return
    await deleteNodeComment(cid)
    const refreshed = await fetchNodeDetail(detail.instance.id, nidNum)
    setDetail(refreshed)
  }

  // ─── Derived data ─────────────────────────────────────────────────────────

  const referenceFiles = detail?.files.filter(f => f.type === 'reference') ?? []
  const evidenceFiles = detail?.files.filter(f => f.type === 'evidence') ?? []

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading || !detail) {
    return (
      <div
        style={{
          padding: '24px',
          color: colors.secondary,
          fontFamily: fonts.label,
          fontSize: '11px',
        }}
      >
        Cargando…
      </div>
    )
  }

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
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => navigate(`/procesos/tareas/${detail.instance.id}`)}
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.secondary,
            cursor: 'pointer',
            fontFamily: fonts.label,
            fontSize: '9px',
            marginBottom: '8px',
            padding: 0,
          }}
        >
          ← {detail.instance.name.toUpperCase()}
        </button>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ fontFamily: fonts.sans, fontSize: '18px', color: colors.neutral }}>
            {detail.node.name}
          </span>
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: '11px',
            color: colors.secondary,
            marginTop: '4px',
          }}
        >
          {detail.instance.name}
        </div>
      </div>

      {/* ── Descripción ───────────────────────────────────────────────────── */}
      {detail.node.description && (
        <div>
          <div style={sectionLabel}>DESCRIPCIÓN</div>
          <p style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
            {detail.node.description}
          </p>
        </div>
      )}

      {/* ── Subtree Gantt ──────────────────────────────────────────────────── */}
      {normalizedNodes.length > 0 && (
        <div>
          <div style={sectionLabel}>CRONOGRAMA</div>
          <GanttChart
            nodes={normalizedNodes}
            totalDays={totalDays}
            states={detail.states}
            instanceStartDate={normalizedInstanceStartDate}
          />
        </div>
      )}

      {/* ── Estado table ───────────────────────────────────────────────────── */}
      <div>
        <div style={sectionLabel}>ESTADO DE TAREAS</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['TAREA', 'ESTADO', 'RESPONSABLE', 'INICIO REAL', 'FIN REAL'].map(h => (
                <th
                  key={h}
                  style={{
                    padding: '6px 10px',
                    fontFamily: fonts.label,
                    fontSize: '9px',
                    color: colors.secondary,
                    textAlign: 'left',
                    letterSpacing: '0.1em',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {subtreeNodes.map(n => {
              const s = getState(n.id)
              const currentStatus = s?.status ?? 'pending'
              const isRoot = n.id === nidNum
              const depth = (depths.get(n.id) ?? 0) - (depths.get(nidNum) ?? 0)
              const indent = Math.max(0, depth) * 16
              return (
                <tr
                  key={n.id}
                  style={{
                    borderBottom: `1px solid ${colors.border}`,
                    background: isRoot ? colors.surfaceAlt : 'transparent',
                    borderLeft: isRoot ? `2px solid ${colors.primary}` : '2px solid transparent',
                  }}
                >
                  <td style={{ padding: '5px 10px', paddingLeft: `${10 + indent}px` }}>
                    <span
                      style={{
                        fontFamily: fonts.sans,
                        fontSize: '12px',
                        color: colors.neutral,
                      }}
                    >
                      {n.name}
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <select
                      value={currentStatus}
                      onChange={e => handleStateChange(n.id, 'status', e.target.value)}
                      style={{
                        ...inputStyle,
                        color: PROCESS_STATUS_COLOR[currentStatus] ?? colors.neutral,
                      }}
                    >
                      {STATUS_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>
                          {PROCESS_STATUS_LABEL[opt]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <select
                      value={s?.assigneeId ?? ''}
                      onChange={e =>
                        handleStateChange(
                          n.id,
                          'assigneeId',
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      style={inputStyle}
                    >
                      <option value="">— Sin asignar</option>
                      {team.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="date"
                      value={s?.actualStart ?? ''}
                      onChange={e =>
                        handleStateChange(n.id, 'actualStart', e.target.value || null)
                      }
                      style={inputStyle}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="date"
                      value={s?.actualEnd ?? ''}
                      onChange={e =>
                        handleStateChange(n.id, 'actualEnd', e.target.value || null)
                      }
                      style={inputStyle}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Notas ──────────────────────────────────────────────────────────── */}
      <div>
        <div style={sectionLabel}>NOTAS</div>
        <textarea
          value={notesValue}
          onChange={e => setNotesValue(e.target.value)}
          onBlur={handleNotesBlur}
          rows={4}
          placeholder="Notas sobre esta tarea…"
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
          }}
        />
      </div>

      {/* ── Fotos de referencia (read-only) ─────────────────────────────────── */}
      {referenceFiles.length > 0 && (
        <div>
          <div style={sectionLabel}>FOTOS DE REFERENCIA</div>
          <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, marginBottom: 8 }}>
            Del proceso — solo lectura
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {referenceFiles.map(f => (
              <div key={f.id} style={{ width: 80, height: 80 }}>
                {f.contentType.startsWith('image/') ? (
                  <img
                    src={`http://localhost:8000/files/${f.filePath}`}
                    alt={f.fileName}
                    style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 2 }}
                  />
                ) : (
                  <div style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.border, borderRadius: 2, fontSize: '10px', color: colors.secondary, fontFamily: fonts.label, padding: 4, textAlign: 'center' }}>
                    {f.fileName}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Evidencias ─────────────────────────────────────────────────────── */}
      <div>
        <div style={sectionLabel}>EVIDENCIAS</div>
        <div
          style={{
            fontFamily: fonts.label,
            fontSize: '9px',
            color: colors.secondary,
            marginBottom: 8,
          }}
        >
          Fotos/videos de esta instancia como evidencia
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {evidenceFiles.map(f => (
            <FileThumb
              key={f.id}
              f={f}
              onDelete={() => handleDeleteFile(f.id)}
            />
          ))}
        </div>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: colors.surfaceAlt,
            border: `1px solid ${colors.border}`,
            color: colors.neutral,
            fontFamily: fonts.label,
            fontSize: '10px',
            letterSpacing: '0.08em',
            padding: '10px 16px',
            cursor: 'pointer',
            minHeight: 44,
            minWidth: 44,
          }}
        >
          + SUBIR EVIDENCIA
          <input
            type="file"
            accept="image/*,video/*"
            style={{ display: 'none' }}
            onChange={e => handleUpload(e, 'evidence')}
          />
        </label>
      </div>

      {/* ── Comentarios ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>COMENTARIOS</div>

        {/* Comment list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {detail.comments.length === 0 && (
            <div
              style={{
                fontFamily: fonts.sans,
                fontSize: '11px',
                color: colors.secondary,
                fontStyle: 'italic',
              }}
            >
              Sin comentarios todavía.
            </div>
          )}
          {detail.comments.map((c: NodeComment) => (
            <div
              key={c.id}
              style={{
                background: colors.surfaceAlt,
                border: `1px solid ${colors.border}`,
                padding: '10px 12px',
                position: 'relative',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontFamily: fonts.label,
                    fontSize: '10px',
                    color: colors.neutral,
                    letterSpacing: '0.05em',
                  }}
                >
                  {c.author || 'Anónimo'}
                </span>
                <span
                  style={{
                    fontFamily: fonts.label,
                    fontSize: '9px',
                    color: colors.secondary,
                  }}
                >
                  {new Date(c.createdAt).toLocaleString('es-MX', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
              <div
                style={{
                  fontFamily: fonts.sans,
                  fontSize: '12px',
                  color: colors.neutral,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {c.body}
              </div>
              <button
                onClick={() => handleDeleteComment(c.id)}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  background: 'transparent',
                  border: 'none',
                  color: colors.secondary,
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: '2px 4px',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* New comment form */}
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              fontFamily: fonts.label,
              fontSize: '9px',
              color: colors.secondary,
              letterSpacing: '0.1em',
            }}
          >
            NUEVO COMENTARIO
          </div>
          <input
            type="text"
            placeholder="Tu nombre"
            value={author}
            onChange={e => handleAuthorChange(e.target.value)}
            style={{
              background: colors.surfaceAlt,
              border: `1px solid ${colors.border}`,
              color: colors.neutral,
              fontFamily: fonts.sans,
              fontSize: '12px',
              padding: '8px',
              outline: 'none',
            }}
          />
          <textarea
            rows={3}
            placeholder="Escribe un comentario…"
            value={commentBody}
            onChange={e => setCommentBody(e.target.value)}
            style={{
              background: colors.surfaceAlt,
              border: `1px solid ${colors.border}`,
              color: colors.neutral,
              fontFamily: fonts.sans,
              fontSize: '12px',
              padding: '8px',
              outline: 'none',
              resize: 'vertical',
              lineHeight: 1.5,
            }}
          />
          <button
            onClick={handleSubmitComment}
            disabled={!commentBody.trim()}
            style={{
              background: commentBody.trim() ? colors.primary : colors.border,
              border: 'none',
              color: colors.neutral,
              fontFamily: fonts.label,
              fontSize: '10px',
              letterSpacing: '0.08em',
              padding: '10px 16px',
              cursor: commentBody.trim() ? 'pointer' : 'not-allowed',
              alignSelf: 'flex-start',
              minHeight: 44,
              opacity: commentBody.trim() ? 1 : 0.6,
            }}
          >
            PUBLICAR
          </button>
        </div>
      </div>
    </div>
  )
}
