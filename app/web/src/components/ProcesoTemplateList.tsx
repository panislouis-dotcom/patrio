import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchTemplates, createTemplate, fetchTemplateNodes } from '../lib/api'
import type { ProcessTemplate } from '../lib/types'
import { colors, fonts } from '../lib/theme'

export function ProcesoTemplateList() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<ProcessTemplate[]>([])
  const [nodeCounts, setNodeCounts] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')

  useEffect(() => {
    fetchTemplates().then(async data => {
      setTemplates(data)
      // Fetch node counts for each template
      const counts: Record<number, number> = {}
      await Promise.all(data.map(async t => {
        const nodes = await fetchTemplateNodes(t.id)
        counts[t.id] = nodes.length
      }))
      setNodeCounts(counts)
      setLoading(false)
    })
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const t = await createTemplate({ name: newName.trim(), description: newDesc.trim() })
      setTemplates(prev => [...prev, t])
      setNodeCounts(prev => ({ ...prev, [t.id]: 0 }))
      setNewName('')
      setNewDesc('')
      setShowForm(false)
      navigate(`/procesos/plantillas/${t.id}`)
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

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: fonts.label, fontSize: '11px', color: colors.neutral, letterSpacing: '0.1em' }}>
          PLANTILLAS DE PROCESO
        </span>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{
            background: showForm ? colors.border : colors.primary,
            border: 'none',
            color: colors.neutral,
            cursor: 'pointer',
            fontFamily: fonts.label,
            fontSize: '10px',
            letterSpacing: '0.08em',
            padding: '6px 14px',
          }}
        >
          {showForm ? 'CANCELAR' : '+ NUEVA PLANTILLA'}
        </button>
      </div>

      {/* Inline create form */}
      {showForm && (
        <form onSubmit={handleCreate} style={{
          background: colors.surfaceAlt,
          border: `1px solid ${colors.border}`,
          padding: '16px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nombre de la plantilla"
            autoFocus
            style={{ ...inputStyle, minWidth: '200px' }}
          />
          <input
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Descripción (opcional)"
            style={{ ...inputStyle, minWidth: '260px' }}
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            style={{
              background: creating || !newName.trim() ? colors.border : colors.primary,
              border: 'none',
              color: colors.neutral,
              cursor: creating || !newName.trim() ? 'not-allowed' : 'pointer',
              fontFamily: fonts.label,
              fontSize: '10px',
              letterSpacing: '0.08em',
              padding: '6px 14px',
              opacity: creating ? 0.6 : 1,
            }}
          >
            {creating ? 'CREANDO…' : 'CREAR'}
          </button>
        </form>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Cargando…</div>
      ) : templates.length === 0 ? (
        <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
          Sin plantillas. Crea una para comenzar.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['NOMBRE', 'DESCRIPCIÓN', 'NODOS', 'CREADA'].map(h => (
                <th key={h} style={{
                  padding: '6px 12px',
                  fontFamily: fonts.label,
                  fontSize: '9px',
                  color: colors.secondary,
                  textAlign: 'left',
                  letterSpacing: '0.12em',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {templates.map(t => (
              <tr
                key={t.id}
                onClick={() => navigate(`/procesos/plantillas/${t.id}`)}
                style={{
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceAlt)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '8px 12px', fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>
                  {t.name}
                </td>
                <td style={{ padding: '8px 12px', fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>
                  {t.description || '—'}
                </td>
                <td style={{ padding: '8px 12px', fontFamily: fonts.label, fontSize: '11px', color: colors.secondary }}>
                  {nodeCounts[t.id] ?? '…'}
                </td>
                <td style={{ padding: '8px 12px', fontFamily: fonts.label, fontSize: '10px', color: colors.secondary }}>
                  {t.createdAt?.slice(0, 10) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
