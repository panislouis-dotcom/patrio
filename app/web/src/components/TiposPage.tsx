import { useEffect, useState } from 'react'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import type { ProveedorCategory } from '../lib/types'
import { getCategories, createCategory, updateCategory, deleteCategory } from '../lib/api'

export function TiposPage() {
  const [tipos, setTipos] = useState<ProveedorCategory[]>([])
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getCategories().then(setTipos).catch(console.error)
  }, [])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name || saving) return
    setSaving(true)
    try {
      const created = await createCategory({ name })
      setTipos(prev => [...prev, created])
      setNewName('')
      setAdding(false)
    } finally { setSaving(false) }
  }

  const handleUpdate = async (id: number) => {
    const name = editName.trim()
    if (!name || saving) return
    setSaving(true)
    try {
      const updated = await updateCategory(id, { name })
      setTipos(prev => prev.map(t => t.id === id ? updated : t))
      setEditingId(null)
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar este tipo? Los proveedores que lo tengan quedarán sin tipo.')) return
    await deleteCategory(id)
    setTipos(prev => prev.filter(t => t.id !== id))
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: fonts.label,
    fontSize: '9px',
    letterSpacing: '0.12em',
    color: colors.secondary,
  }

  return (
    <div style={{ padding: '24px', maxWidth: '560px' }}>
      <div style={{ ...labelStyle, marginBottom: '16px' }}>TIPOS DE PROVEEDOR</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
        {tipos.map(t => (
          <div
            key={t.id}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: colors.surfaceAlt, border: `1px solid ${colors.border}`, borderRadius: '2px' }}
          >
            {editingId === t.id ? (
              <>
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleUpdate(t.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  style={{ ...fieldInput, flex: 1, fontSize: '12px' }}
                />
                <button
                  onClick={() => handleUpdate(t.id)}
                  disabled={saving}
                  style={{ background: colors.primary, border: 'none', borderRadius: '2px', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '4px 10px' }}
                >
                  GUARDAR
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontSize: '14px' }}
                >
                  ×
                </button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>{t.name}</span>
                <button
                  onClick={() => { setEditingId(t.id); setEditName(t.name) }}
                  style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em', padding: '2px 6px' }}
                >
                  EDITAR
                </button>
                <button
                  onClick={() => handleDelete(t.id)}
                  style={{ background: 'transparent', border: 'none', color: '#d44', cursor: 'pointer', fontSize: '14px', lineHeight: 1 }}
                >
                  ×
                </button>
              </>
            )}
          </div>
        ))}

        {tipos.length === 0 && !adding && (
          <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.secondary }}>
            Sin tipos registrados.
          </div>
        )}
      </div>

      {adding ? (
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') { setAdding(false); setNewName('') }
            }}
            placeholder="Nombre del tipo..."
            style={{ ...fieldInput, flex: 1, fontSize: '12px' }}
          />
          <button
            onClick={handleCreate}
            disabled={saving}
            style={{ background: colors.primary, border: 'none', borderRadius: '2px', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '6px 16px' }}
          >
            CREAR
          </button>
          <button
            onClick={() => { setAdding(false); setNewName('') }}
            style={{ background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: '2px', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '6px 10px' }}
          >
            ×
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{ background: 'transparent', border: `1px dashed ${colors.border}`, borderRadius: '2px', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '8px 16px' }}
        >
          + AGREGAR TIPO
        </button>
      )}
    </div>
  )
}
