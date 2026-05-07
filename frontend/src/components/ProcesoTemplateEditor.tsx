import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchTemplatePreview, createNode, updateNode, deleteNode } from '../lib/api'
import type { ProcessTemplate, TemplateNode, GanttNode } from '../lib/types'
import { colors, fonts } from '../lib/theme'

// ─── Cycle detection helper ───────────────────────
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

// ─── Add node form ────────────────────────────────
function AddNodeForm({
  templateId, parentId, sortOrder, siblings, onCreated, onCancel,
}: {
  templateId: number
  parentId: number | null
  sortOrder: number
  siblings: TemplateNode[]
  onCreated: (n: TemplateNode) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [durationDays, setDurationDays] = useState<string>('')
  const [depId, setDepId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const n = await createNode(templateId, {
        name: name.trim(),
        parentId,
        sortOrder,
        durationDays: durationDays !== '' ? Number(durationDays) : null,
        dependsOnId: depId,
      })
      onCreated(n)
      setName('')
      setDurationDays('')
      setDepId(null)
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

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Nombre"
        autoFocus
        style={{ ...inputStyle, width: '160px' }}
      />
      <input
        value={durationDays}
        onChange={e => setDurationDays(e.target.value)}
        placeholder="Días (vacío=DEFINIR)"
        type="number"
        min="1"
        style={{ ...inputStyle, width: '140px' }}
      />
      {siblings.length > 0 && (
        <select
          value={depId ?? ''}
          onChange={e => setDepId(e.target.value ? Number(e.target.value) : null)}
          style={inputStyle}
        >
          <option value="">Sin dependencia</option>
          {siblings.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <button
        type="submit"
        disabled={saving || !name.trim()}
        style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '4px 10px' }}
      >
        {saving ? '…' : 'OK'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', padding: '4px 8px' }}
      >
        ✕
      </button>
    </form>
  )
}

// ─── Tree node renderer ───────────────────────────
function TreeNode({
  node, nodes, templateId, depth,
  onUpdated, onDeleted, onCreated,
}: {
  node: TemplateNode
  nodes: TemplateNode[]
  templateId: number
  depth: number
  onUpdated: (n: TemplateNode) => void
  onDeleted: (id: number) => void
  onCreated: (n: TemplateNode) => void
}) {
  const children = nodes.filter(n => n.parentId === node.id).sort((a, b) => a.sortOrder - b.sortOrder)
  const isLeaf = children.length === 0
  const isDefinir = isLeaf && node.durationDays === null

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(node.name)
  const [editDur, setEditDur] = useState<string>(node.durationDays !== null ? String(node.durationDays) : '')
  const [editDepOn, setEditDepOn] = useState<number | null>(node.dependsOnId)
  const [saving, setSaving] = useState(false)
  const [addingChild, setAddingChild] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const validDeps = nodes.filter(n => n.parentId === node.parentId && n.id !== node.id && !wouldCreateCycle(n.id, node.id, nodes))

  async function saveEdit() {
    setSaving(true)
    try {
      const updated = await updateNode(node.id, {
        name: editName.trim(),
        durationDays: isLeaf ? (editDur !== '' ? Number(editDur) : null) : node.durationDays,
        dependsOnId: editDepOn,
      })
      onUpdated(updated)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteNode(node.id)
      onDeleted(node.id)
    } finally {
      setDeleting(false)
    }
  }

  const indent = depth * 20

  return (
    <div>
      {/* Node row */}
      <div style={{
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        padding: `6px 12px 6px ${indent + 12}px`,
      }}>
        {editing ? (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '3px 7px', outline: 'none', width: '160px' }}
            />
            {isLeaf && (
              <input
                value={editDur}
                onChange={e => setEditDur(e.target.value)}
                placeholder="Días"
                type="number"
                min="1"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '3px 7px', outline: 'none', width: '80px' }}
              />
            )}
            {validDeps.length > 0 && (
              <select
                value={editDepOn ?? ''}
                onChange={e => setEditDepOn(e.target.value ? Number(e.target.value) : null)}
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '3px 6px', outline: 'none' }}
              >
                <option value="">Sin dependencia</option>
                {validDeps.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <button onClick={saveEdit} disabled={saving} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '3px 8px' }}>
              {saving ? '…' : 'OK'}
            </button>
            <button onClick={() => setEditing(false)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', padding: '3px 6px' }}>
              ✕
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {depth > 0 && <span style={{ color: colors.border, fontSize: '10px' }}>└</span>}
            <span style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, flex: 1 }}>
              {node.name}
            </span>
            {isDefinir ? (
              <span style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.tertiary, letterSpacing: '0.08em', border: `1px dashed ${colors.tertiary}`, padding: '1px 6px' }}>
                DEFINIR
              </span>
            ) : isLeaf ? (
              <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary }}>{node.durationDays}d</span>
            ) : null}
            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={() => setAddingChild(true)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 6px' }}>
                + HIJO
              </button>
              <button onClick={() => setEditing(true)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 6px' }}>
                EDITAR
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: 'tomato', cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 6px', opacity: deleting ? 0.5 : 1 }}
              >
                BORRAR
              </button>
            </div>
          </div>
        )}
        {addingChild && (
          <div style={{ paddingLeft: '20px', marginTop: '6px' }}>
            <AddNodeForm
              templateId={templateId}
              parentId={node.id}
              sortOrder={children.length}
              siblings={children}
              onCreated={n => { onCreated(n); setAddingChild(false) }}
              onCancel={() => setAddingChild(false)}
            />
          </div>
        )}
      </div>
      {/* Children */}
      {children.map(child => (
        <TreeNode
          key={child.id}
          node={child}
          nodes={nodes}
          templateId={templateId}
          depth={depth + 1}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
          onCreated={onCreated}
        />
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────
export function ProcesoTemplateEditor() {
  const { tid } = useParams<{ tid: string }>()
  const navigate = useNavigate()
  const templateId = Number(tid)

  const [template, setTemplate] = useState<ProcessTemplate | null>(null)
  const [nodes, setNodes] = useState<TemplateNode[]>([])
  const [ganttNodes, setGanttNodes] = useState<GanttNode[]>([])
  const [loading, setLoading] = useState(true)
  const [addingRoot, setAddingRoot] = useState(false)

  useEffect(() => {
    fetchTemplatePreview(templateId).then(({ template: t, nodes: n }) => {
      setTemplate(t)
      setNodes(n)
      setGanttNodes(n)
      setLoading(false)
    })
  }, [templateId])

  const refreshPreview = useCallback(() => {
    fetchTemplatePreview(templateId).then(({ nodes: n }) => setGanttNodes(n))
  }, [templateId])

  const totalDays = Math.max(1, ...ganttNodes.map(n => n.ganttStart + n.ganttDuration))

  const roots = nodes.filter(n => n.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder)

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
        {/* Header */}
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => navigate('/procesos/plantillas')}
            style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px' }}
          >
            ← PLANTILLAS
          </button>
          <span style={{ color: colors.border }}>·</span>
          <span style={{ fontFamily: fonts.sans, fontSize: '13px', color: colors.neutral }}>{template?.name ?? '…'}</span>
        </div>
        {/* Tree */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {roots.map(root => (
            <TreeNode
              key={root.id}
              node={root}
              nodes={nodes}
              templateId={templateId}
              depth={0}
              onUpdated={updated => { setNodes(prev => prev.map(n => n.id === updated.id ? updated : n)); refreshPreview() }}
              onDeleted={id => { setNodes(prev => prev.filter(n => n.id !== id)); refreshPreview() }}
              onCreated={n => { setNodes(prev => [...prev, n]); refreshPreview() }}
            />
          ))}
          {addingRoot && (
            <div style={{ padding: '12px 16px' }}>
              <AddNodeForm
                templateId={templateId}
                parentId={null}
                sortOrder={roots.length}
                siblings={roots}
                onCreated={n => { setNodes(prev => [...prev, n]); setAddingRoot(false); refreshPreview() }}
                onCancel={() => setAddingRoot(false)}
              />
            </div>
          )}
        </div>
        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: `1px solid ${colors.border}` }}>
          <button
            onClick={() => setAddingRoot(true)}
            style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.08em', padding: '6px 14px' }}
          >
            + AGREGAR NODO RAÍZ
          </button>
        </div>
      </div>

      {/* Right: Gantt preview */}
      <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
        <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '16px' }}>
          VISTA PREVIA DEL PROCESO (HIPOTÉTICA)
        </div>
        {ganttNodes.length === 0 ? (
          <div style={{ color: colors.secondary, fontFamily: fonts.sans, fontSize: '11px' }}>
            Agrega nodos para ver la vista previa.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {(() => {
              const depthMap: Record<number, number> = {}
              for (const n of ganttNodes) {
                depthMap[n.id] = n.parentId === null ? 0 : (depthMap[n.parentId] ?? 0) + 1
              }
              return ganttNodes.map(n => {
              const leftPct = totalDays > 0 ? (n.ganttStart / totalDays) * 100 : 0
              const widthPct = totalDays > 0 ? Math.max(0.5, (n.ganttDuration / totalDays) * 100) : 0.5
              const depth = depthMap[n.id] ?? 0
              return (
                <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: `${depth * 12}px`, flexShrink: 0 }} />
                  <div style={{ width: '140px', flexShrink: 0, fontFamily: fonts.sans, fontSize: '10px', color: n.isDefinir ? colors.tertiary : colors.neutral, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {n.name}
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: '16px', background: colors.surfaceAlt, border: `1px solid ${colors.border}` }}>
                    <div style={{
                      position: 'absolute',
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      height: '100%',
                      background: n.isDefinir ? 'transparent' : (n.parentId === null ? colors.primary : colors.secondary),
                      border: n.isDefinir ? `1px dashed ${colors.tertiary}` : 'none',
                      opacity: 0.7,
                    }} />
                  </div>
                  <div style={{ width: '40px', flexShrink: 0, fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>
                    {n.isDefinir ? '?' : `${n.ganttDuration}d`}
                  </div>
                </div>
              )
            })
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
