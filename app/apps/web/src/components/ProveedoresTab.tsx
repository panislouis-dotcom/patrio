import { useEffect, useState } from 'react'
import { colors, fonts } from '../lib/theme'
import type { Proveedor, ProveedorCategory } from '../lib/types'
import { getProveedores, getCategories, createProveedor, BASE } from '../lib/api'
import { RatingDisplay } from './RatingDisplay'
import { ProveedorDetailPage } from './ProveedorDetailPage'

const STATUS_COLOR: Record<string, string> = {
  activo: colors.primary,
  inactivo: colors.secondary,
  vetado: '#d44',
}

export function ProveedoresTab() {
  const [allCategories, setAllCategories] = useState<ProveedorCategory[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [selected, setSelected] = useState<Proveedor | null>(null)
  const [listKey, setListKey] = useState(0)
  const [newProvName, setNewProvName] = useState('')
  const [addingProv, setAddingProv] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchAll = () => {
    getCategories().then(setAllCategories).catch(console.error)
    getProveedores().then(setProveedores).catch(console.error)
  }

  useEffect(() => { fetchAll() }, [listKey])

  const handleAddProveedor = async () => {
    if (!newProvName.trim() || saving) return
    setSaving(true)
    try {
      const p = await createProveedor({ name: newProvName.trim(), status: 'activo' })
      setNewProvName('')
      setAddingProv(false)
      setSelected(p)
    } finally { setSaving(false) }
  }

  if (selected !== null) {
    return (
      <ProveedorDetailPage
        key={selected.id}
        proveedor={selected}
        allCategories={allCategories}
        base={BASE}
        onBack={() => { setSelected(null); setListKey(k => k + 1) }}
        onUpdate={p => { setSelected(p); setListKey(k => k + 1) }}
        onDelete={() => { setSelected(null); setListKey(k => k + 1) }}
      />
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.secondary }}>
          {proveedores.length} PROVEEDORES
        </span>
        {addingProv ? (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              autoFocus
              value={newProvName}
              onChange={e => setNewProvName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddProveedor()
                if (e.key === 'Escape') { setAddingProv(false); setNewProvName('') }
              }}
              placeholder="Nombre del proveedor..."
              style={{ fontSize: '12px', background: colors.surfaceAlt, border: `1px solid ${colors.border}`, borderRadius: '2px', color: colors.neutral, padding: '4px 8px', fontFamily: fonts.sans, outline: 'none', width: '220px' }}
            />
            <button onClick={handleAddProveedor} disabled={saving} style={{ background: colors.primary, border: 'none', borderRadius: '2px', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '6px 12px' }}>
              CREAR
            </button>
          </div>
        ) : (
          <button onClick={() => setAddingProv(true)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: '2px', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '6px 12px' }}>
            + PROVEEDOR
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: fonts.sans }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {['NOMBRE', 'ZONA', 'TIPO', 'CALIDAD', 'PUNTUALIDAD', 'PRECIO', 'STATUS'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', color: colors.secondary, fontWeight: 400 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {proveedores.map(p => (
              <tr
                key={p.id}
                onClick={() => setSelected(p)}
                style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceAlt)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '10px 12px', color: colors.neutral, fontWeight: 500 }}>{p.name}</td>
                <td style={{ padding: '10px 12px', color: colors.secondary }}>{p.zona || '—'}</td>
                <td style={{ padding: '10px 12px', color: colors.secondary }}>
                  {p.categories.length > 0 ? p.categories[0].name : '—'}
                </td>
                <td style={{ padding: '10px 12px' }}><RatingDisplay value={p.ratingCalidad} size={7} /></td>
                <td style={{ padding: '10px 12px' }}><RatingDisplay value={p.ratingPuntualidad} size={7} /></td>
                <td style={{ padding: '10px 12px' }}><RatingDisplay value={p.ratingPrecio} size={7} /></td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{ color: STATUS_COLOR[p.status] ?? colors.secondary, fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em' }}>
                    {p.status.toUpperCase()}
                  </span>
                </td>
              </tr>
            ))}
            {proveedores.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '32px 12px', textAlign: 'center', color: colors.secondary, fontSize: '12px' }}>
                  Sin proveedores
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
