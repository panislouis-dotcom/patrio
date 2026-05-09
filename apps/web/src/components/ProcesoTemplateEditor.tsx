import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BASE, fetchTemplatePreview, fetchTemplates, createNode, updateNode, deleteNode, fetchNodeFiles, uploadNodeFile, deleteNodeFile } from '../lib/api'
import type { ProcessTemplate, TemplateNode, GanttNode, NodeFile } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { GanttChart } from './GanttChart'
import { getSubtree } from '../lib/treeUtils'

function wouldCreateCycle(candidateId: number, currentId: number, allNodes: TemplateNode[]): boolean {
  const visited = new Set<number>()
  let cursor: number | null = candidateId
  while (cursor !== null) {
    if (cursor === currentId) return true
    if (visited.has(cursor)) break
    visited.add(cursor)
    cursor = allNodes.find(n => n.id === cursor)?.dependsOnId ?? null
  }
  return false
}

function AddNodeForm({
  templateId, parentId, sortOrder, siblingNodes, onDone, onCancel,
}: {
  templateId: number
  parentId: number | null
  sortOrder: number
  siblingNodes: TemplateNode[]
  onDone: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [durationDays, setDurationDays] = useState<string>('')
  const [dependsOnId, setDependsOnId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'node' | 'template'>('node')
  const [sourceTemplateId, setSourceTemplateId] = useState<number | null>(null)
  const [availableTemplates, setAvailableTemplates] = useState<ProcessTemplate[]>([])

  useEffect(() => {
    if (mode === 'template') {
      fetchTemplates().then(setAvailableTemplates)
    }
  }, [mode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      if (mode === 'template' && sourceTemplateId) {
        const tpl = availableTemplates.find(t => t.id === sourceTemplateId)
        await createNode(templateId, {
          name: tpl?.name ?? 'Plantilla',
          parentId,
          sortOrder,
          sourceTemplateId,
        })
      } else {
        if (!name.trim()) return
        await createNode(templateId, {
          name: name.trim(),
          parentId,
          sortOrder,
          durationDays: durationDays !== '' ? Number(durationDays) : null,
          dependsOnId,
        })
      }
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    color: colors.neutral,
    fontFamily: fonts.sans,
    fontSize: '11px',
    padding: '4px 8px',
    outline: 'none',
  }

  const isSubmitDisabled = saving || (mode === 'node' ? !name.trim() : !sourceTemplateId)

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px', minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setMode(m => m === 'node' ? 'template' : 'node')}
        style={{ background: mode === 'template' ? colors.tertiary : 'transparent', border: `1px solid ${colors.border}`, color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '3px 6px', flexShrink: 0 }}
      >
        {mode === 'node' ? 'NODO' : 'PLANTILLA'}
      </button>
      {mode === 'template' ? (
        <select
          value={sourceTemplateId ?? ''}
          onChange={e => setSourceTemplateId(e.target.value ? Number(e.target.value) : null)}
          style={{ ...inputStyle, flex: 1, minWidth: '80px' }}
        >
          <option value="">— Selecciona plantilla</option>
          {availableTemplates
            .filter(t => t.id !== templateId)
            .map(t => <option key={t.id} value={t.id}>{t.name}</option>)
          }
        </select>
      ) : (
        <>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nombre"
            autoFocus
            style={{ ...inputStyle, flex: 1, minWidth: '60px' }}
          />
          <input
            value={durationDays}
            onChange={e => setDurationDays(e.target.value)}
            placeholder="Días"
            type="number"
            min="1"
            style={{ ...inputStyle, width: '60px', flexShrink: 0 }}
          />
          {siblingNodes.length > 0 && (
            <select
              value={dependsOnId ?? ''}
              onChange={e => setDependsOnId(e.target.value ? Number(e.target.value) : null)}
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '4px 4px', outline: 'none', maxWidth: '100px', flexShrink: 1 }}
            >
              <option value="">‖ Par.</option>
              {siblingNodes.map(s => (
                <option key={s.id} value={s.id}>→ {s.name}</option>
              ))}
            </select>
          )}
        </>
      )}
      <button
        type="submit"
        disabled={isSubmitDisabled}
        style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '4px 8px', flexShrink: 0 }}
      >
        {saving ? '…' : 'OK'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', padding: '4px 6px', flexShrink: 0 }}
      >
        ✕
      </button>
    </form>
  )
}

function TreeNode({
  node, nodes, templateId, depth, onRefresh, onFocus,
}: {
  node: GanttNode
  nodes: GanttNode[]
  templateId: number
  depth: number
  onRefresh: () => void
  onFocus: (id: number) => void
}) {
  const children = nodes.filter(n => n.parentId === node.id).sort((a, b) => a.sortOrder - b.sortOrder)
  const isLeaf = children.length === 0
  const isDefinir = isLeaf && node.durationDays === null
  const isSubTemplateNode = node.templateId !== templateId

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(node.name)
  const [editDur, setEditDur] = useState<string>(node.durationDays !== null ? String(node.durationDays) : '')
  const [editDepOn, setEditDepOn] = useState<number | null>(node.dependsOnId)
  const [saving, setSaving] = useState(false)
  const [addingChild, setAddingChild] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Re-sync edit fields when server data changes after a refresh.
  useEffect(() => {
    if (!editing) {
      setEditName(node.name)
      setEditDur(node.durationDays !== null ? String(node.durationDays) : '')
      setEditDepOn(node.dependsOnId)
    }
  }, [node.name, node.durationDays, node.dependsOnId, editing])

  const validDeps = nodes.filter(n => n.parentId === node.parentId && n.id !== node.id && !wouldCreateCycle(n.id, node.id, nodes))

  async function saveEdit() {
    setSaving(true)
    try {
      await updateNode(node.id, {
        name: editName.trim(),
        durationDays: isLeaf ? (editDur !== '' ? Number(editDur) : null) : node.durationDays,
        dependsOnId: editDepOn,
      })
      setEditing(false)
      onRefresh()
    } catch {
      // leave form open so user can retry
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteNode(node.id)
      onRefresh()
    } finally {
      setDeleting(false)
    }
  }

  const indent = depth * 20

  return (
    <div>
      <div
        style={{
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          padding: `6px 12px 6px ${indent + 12}px`,
        }}
      >
        {editing ? (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', minWidth: 0 }}>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '3px 7px', outline: 'none', flex: 1, minWidth: '60px' }}
            />
            {isLeaf && (
              <input
                value={editDur}
                onChange={e => setEditDur(e.target.value)}
                placeholder="Días"
                type="number"
                min="1"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '3px 7px', outline: 'none', width: '60px', flexShrink: 0 }}
              />
            )}
            {validDeps.length > 0 && (
              <select
                value={editDepOn ?? ''}
                onChange={e => setEditDepOn(e.target.value ? Number(e.target.value) : null)}
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '3px 4px', outline: 'none', maxWidth: '90px', flexShrink: 1 }}
              >
                <option value="">‖ Par.</option>
                {validDeps.map(s => <option key={s.id} value={s.id}>→ {s.name}</option>)}
              </select>
            )}
            <button onClick={e => { e.stopPropagation(); saveEdit() }} disabled={saving} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '3px 8px', flexShrink: 0 }}>
              {saving ? '…' : 'OK'}
            </button>
            <button onClick={e => { e.stopPropagation(); setEditing(false) }} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', padding: '3px 6px', flexShrink: 0 }}>
              ✕
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {depth > 0 && <span style={{ color: colors.border, fontSize: '10px' }}>└</span>}
            {node.sourceTemplateId != null && (
              <span style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.tertiary, letterSpacing: '0.08em', marginRight: 4 }}>
                [T]
              </span>
            )}
            <span
              onClick={() => onFocus(node.id)}
              style={{ fontFamily: fonts.sans, fontSize: '12px', color: isSubTemplateNode ? colors.tertiary : colors.neutral, flex: 1, cursor: 'pointer' }}
            >
              {node.name}
            </span>
            <span style={{
              fontFamily: fonts.label,
              fontSize: '8px',
              letterSpacing: '0.06em',
              color: node.dependsOnId != null ? colors.tertiary : colors.border,
              marginLeft: 4,
            }}>
              {node.dependsOnId != null
                ? `→ ${nodes.find(n => n.id === node.dependsOnId)?.name ?? '?'}`
                : '‖'}
            </span>
            <span style={{ fontFamily: fonts.label, fontSize: '9px', color: isDefinir ? colors.tertiary : colors.secondary }}>
              {isDefinir ? '?' : `${node.ganttDuration}d`}
            </span>
            {!isSubTemplateNode && (
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={e => { e.stopPropagation(); setAddingChild(true) }} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 6px' }}>
                  + HIJO
                </button>
                <button onClick={e => { e.stopPropagation(); setEditing(true) }} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 6px' }}>
                  EDITAR
                </button>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete() }}
                  disabled={deleting}
                  style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: 'tomato', cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 6px', opacity: deleting ? 0.5 : 1 }}
                >
                  BORRAR
                </button>
              </div>
            )}
          </div>
        )}
        {addingChild && (
          <div style={{ paddingLeft: '20px', marginTop: '6px' }}>
            <AddNodeForm
              templateId={templateId}
              parentId={node.id}
              sortOrder={children.length}
              siblingNodes={children}
              onDone={() => { setAddingChild(false); onRefresh() }}
              onCancel={() => setAddingChild(false)}
            />
          </div>
        )}
      </div>
      {children.map(child => (
        <TreeNode
          key={child.id}
          node={child}
          nodes={nodes}
          templateId={templateId}
          depth={depth + 1}
          onRefresh={onRefresh}
          onFocus={onFocus}
        />
      ))}
    </div>
  )
}

export function ProcesoTemplateEditor() {
  const { tid } = useParams<{ tid: string }>()
  const navigate = useNavigate()
  const templateId = Number(tid)

  const [template, setTemplate] = useState<ProcessTemplate | null>(null)
  const [nodes, setNodes] = useState<GanttNode[]>([])
  const [loading, setLoading] = useState(true)
  const [addingRoot, setAddingRoot] = useState(false)
  const [focusNodeId, setFocusNodeId] = useState<number | null>(null)
  const [focusDescription, setFocusDescription] = useState('')
  const [focusFiles, setFocusFiles] = useState<NodeFile[]>([])

  const refresh = useCallback(() => {
    fetchTemplatePreview(templateId).then(({ template: t, nodes: n }) => {
      setTemplate(t)
      setNodes(n)
    })
  }, [templateId])

  useEffect(() => {
    if (!focusNodeId) { setFocusFiles([]); return }
    const n = nodes.find(n => n.id === focusNodeId)
    setFocusDescription(n?.description ?? '')
    fetchNodeFiles(focusNodeId).then(setFocusFiles)
  }, [focusNodeId])

  useEffect(() => {
    fetchTemplatePreview(templateId).then(({ template: t, nodes: n }) => {
      setTemplate(t)
      setNodes(n)
      setLoading(false)
    })
  }, [templateId])

  const totalDays = Math.max(1, ...nodes.map(n => n.ganttStart + n.ganttDuration))
  const roots = nodes.filter(n => n.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder)

  // Breadcrumb path from root to focused node
  const focusPath = useMemo(() => {
    if (!focusNodeId) return []
    const path: GanttNode[] = []
    let cursor: GanttNode | undefined = nodes.find(n => n.id === focusNodeId)
    while (cursor) {
      path.unshift(cursor)
      cursor = cursor.parentId != null ? nodes.find(n => n.id === cursor!.parentId) : undefined
    }
    return path
  }, [focusNodeId, nodes])

  // What to show as roots in the left tree panel
  const displayRoots = focusNodeId
    ? nodes.filter(n => n.id === focusNodeId)
    : roots

  if (loading) {
    return (
      <div style={{ padding: '24px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
        Cargando…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Left: tree editor */}
      <div style={{ width: '420px', flexShrink: 0, borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '8px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => navigate('/procesos/plantillas')}
            style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: 0 }}
          >
            ← PLANTILLAS
          </button>
        </div>
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${colors.border}`, borderLeft: `3px solid ${colors.primary}`, background: colors.surfaceAlt }}>
          <span style={{ fontFamily: fonts.sans, fontSize: '13px', color: colors.neutral }}>{template?.name ?? '…'}</span>
        </div>
        {focusNodeId && (
          <div style={{ padding: '6px 12px', borderBottom: `1px solid ${colors.border}`, display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setFocusNodeId(null)} style={{ background: 'none', border: 'none', color: colors.tertiary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: 0 }}>
              ← {template?.name ?? 'PLANTILLA'}
            </button>
            {focusPath.map((n, i) => (
              <span key={n.id} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ color: colors.border, fontSize: '9px' }}>›</span>
                {i < focusPath.length - 1 ? (
                  <button onClick={() => setFocusNodeId(n.id)} style={{ background: 'none', border: 'none', color: colors.tertiary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: 0 }}>
                    {n.name}
                  </button>
                ) : (
                  <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.neutral }}>{n.name}</span>
                )}
              </span>
            ))}
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {displayRoots.map(root => (
            <TreeNode
              key={root.id}
              node={root}
              nodes={nodes}
              templateId={templateId}
              depth={focusNodeId ? 0 : 1}
              onRefresh={refresh}
              onFocus={setFocusNodeId}
            />
          ))}
          {addingRoot && (
            <div style={{ padding: '12px 16px' }}>
              <AddNodeForm
                templateId={templateId}
                parentId={null}
                sortOrder={roots.length}
                siblingNodes={roots}
                onDone={() => { setAddingRoot(false); refresh() }}
                onCancel={() => setAddingRoot(false)}
              />
            </div>
          )}
        </div>
        <div style={{ padding: '10px 16px', borderTop: `1px solid ${colors.border}` }}>
          <button
            onClick={() => setAddingRoot(true)}
            style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.08em', padding: '6px 14px' }}
          >
            + AGREGAR SECCIÓN
          </button>
        </div>
      </div>

      {/* Right: Gantt preview */}
      <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
        <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '16px' }}>
          VISTA PREVIA DEL PROCESO (HIPOTÉTICA)
        </div>
        {focusNodeId ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Description */}
            <div>
              <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '8px' }}>DESCRIPCIÓN</div>
              <textarea
                value={focusDescription}
                onChange={e => setFocusDescription(e.target.value)}
                onBlur={async () => {
                  const n = nodes.find(n => n.id === focusNodeId)
                  if (n && focusDescription !== n.description) {
                    await updateNode(focusNodeId, { description: focusDescription })
                  }
                }}
                placeholder="Instrucciones, contexto, criterios de éxito…"
                rows={5}
                style={{ width: '100%', background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', padding: '8px', outline: 'none', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box' as const }}
              />
            </div>
            {/* Reference photos */}
            <div>
              <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '8px' }}>FOTOS DE REFERENCIA</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {focusFiles.map(f => (
                  <div key={f.id} style={{ position: 'relative', width: 80, height: 80 }}>
                    {f.contentType.startsWith('image/') ? (
                      <img src={`${BASE}/files/${f.filePath}`} alt={f.fileName} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 2 }} />
                    ) : (
                      <div style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.border, borderRadius: 2, fontSize: '10px', color: colors.secondary, fontFamily: fonts.label, padding: 4, textAlign: 'center' }}>{f.fileName}</div>
                    )}
                    <button
                      onClick={async () => {
                        await deleteNodeFile(f.id)
                        fetchNodeFiles(focusNodeId).then(setFocusFiles)
                      }}
                      style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: '10px', lineHeight: '18px', textAlign: 'center', padding: 0 }}
                    >×</button>
                  </div>
                ))}
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: colors.surfaceAlt, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.08em', padding: '8px 14px', cursor: 'pointer' }}>
                + SUBIR REFERENCIA
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  await uploadNodeFile(focusNodeId, file)
                  fetchNodeFiles(focusNodeId).then(setFocusFiles)
                  e.target.value = ''
                }} />
              </label>
            </div>
            {/* Subtree Gantt */}
            {(() => {
              const sub = getSubtree(focusNodeId, nodes)
              const rootStart = sub.find(n => n.id === focusNodeId)?.ganttStart ?? 0
              const normalized = sub.map(n => ({ ...n, ganttStart: n.ganttStart - rootStart }))
              const total = Math.max(...normalized.map(n => n.ganttStart + n.ganttDuration), 1)
              return normalized.length > 0 ? (
                <div>
                  <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '8px' }}>CRONOGRAMA DEL NODO</div>
                  <GanttChart nodes={normalized} totalDays={total} />
                </div>
              ) : null
            })()}
          </div>
        ) : nodes.length === 0 ? (
          <div style={{ color: colors.secondary, fontFamily: fonts.sans, fontSize: '11px' }}>
            Agrega nodos para ver la vista previa.
          </div>
        ) : (
          <GanttChart nodes={nodes} totalDays={totalDays} />
        )}
      </div>
    </div>
  )
}
