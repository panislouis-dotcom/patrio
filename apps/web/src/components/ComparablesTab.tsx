import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'
import { fetchComparables, deleteComparable } from '../lib/api'
import { fmtMXN } from '../lib/fmt'
import type { Comparable } from '../lib/types'

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontFamily: fonts.label,
  fontSize: '9px',
  color: colors.secondary,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '5px 10px',
  fontFamily: fonts.sans,
  fontSize: '12px',
  whiteSpace: 'nowrap',
}

const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: colors.primary + '33', text: colors.primary },
  sold: { bg: colors.secondary + '33', text: colors.secondary },
  withdrawn: { bg: colors.secondary + '22', text: colors.secondary },
  expired: { bg: colors.border, text: colors.secondary },
}

const statusLabels: Record<string, string> = {
  active: 'Activo',
  sold: 'Vendido',
  withdrawn: 'Retirado',
  expired: 'Expirado',
}

export function ComparablesTab() {
  const [comps, setComps] = useState<Comparable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const navigate = useNavigate()

  async function handleDelete(id: number) {
    try {
      await deleteComparable(id)
      setComps(prev => prev.filter(c => c.id !== id))
      setConfirmDeleteId(null)
    } catch {
      setError('Error al borrar comparable')
    }
  }

  useEffect(() => {
    fetchComparables()
      .then(setComps)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: '32px', color: colors.secondary, fontFamily: fonts.sans }}>Cargando comparables...</div>
  if (error) return <div style={{ padding: '32px', color: 'tomato', fontFamily: fonts.sans }}>Error: {error}</div>

  const filtered = filterStatus ? comps.filter(c => c.status === filterStatus) : comps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 49px)' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 12px',
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <span style={{ fontFamily: fonts.label, fontSize: '11px', color: colors.secondary, letterSpacing: '0.1em' }}>
          {filtered.length} COMPARABLES
        </span>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            color: colors.neutral,
            fontFamily: fonts.label,
            fontSize: '10px',
            padding: '3px 8px',
            outline: 'none',
          }}
        >
          <option value="">Todos</option>
          <option value="active">Activos</option>
          <option value="sold">Vendidos</option>
          <option value="withdrawn">Retirados</option>
          <option value="expired">Expirados</option>
        </select>
        <button
          onClick={() => navigate('/prospectos/comparables/nuevo')}
          style={{
            marginLeft: 'auto',
            background: colors.primary,
            border: 'none',
            color: colors.neutral,
            fontFamily: fonts.label,
            fontSize: '10px',
            letterSpacing: '0.08em',
            padding: '6px 16px',
            cursor: 'pointer',
          }}
        >
          + NUEVO COMPARABLE
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <th style={thStyle}>DIRECCIÓN</th>
              <th style={thStyle}>ZONA/CIUDAD</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>M²</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>PRECIO</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>$/M²</th>
              <th style={thStyle}>STATUS</th>
              <th style={thStyle}>TIPO</th>
              <th style={thStyle}>CONDICIÓN</th>
              <th style={thStyle}>ÚLTIMA VERIF.</th>
              <th style={{ ...thStyle, width: '60px' }} />
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const sc = statusColors[c.status] ?? statusColors.active
              return (
                <tr
                  key={c.id}
                  style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = `${colors.border}55`)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={tdStyle}>
                    <a
                      href={c.listingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ color: colors.accent2, textDecoration: 'underline' }}
                    >
                      {c.address}
                    </a>
                  </td>
                  <td style={tdStyle}>{c.city}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{c.m2}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtMXN(c.price)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: colors.tertiary }}>${Math.round(c.pricePerM2).toLocaleString('es-MX')}</td>
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      fontSize: '9px',
                      fontFamily: fonts.label,
                      letterSpacing: '0.08em',
                      background: sc.bg,
                      color: sc.text,
                      borderRadius: '2px',
                    }}>
                      {statusLabels[c.status] ?? c.status}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, fontSize: '11px' }}>{c.propertyType}</td>
                  <td style={{ ...tdStyle, fontSize: '11px' }}>{c.condition}</td>
                  <td style={{ ...tdStyle, fontSize: '11px', color: colors.secondary }}>
                    {c.lastCheckedAt ? new Date(c.lastCheckedAt).toLocaleDateString('es-MX') : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {confirmDeleteId === c.id
                      ? <span style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          <button onClick={() => handleDelete(c.id)} style={{ background: 'tomato', border: 'none', color: '#fff', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em', padding: '2px 7px', cursor: 'pointer' }}>BORRAR</button>
                          <button onClick={() => setConfirmDeleteId(null)} style={{ background: 'none', border: `1px solid ${colors.border}`, color: colors.secondary, fontFamily: fonts.label, fontSize: '9px', padding: '2px 6px', cursor: 'pointer' }}>NO</button>
                        </span>
                      : <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(c.id) }} style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '13px', padding: '2px 4px', opacity: 0.4 }}
                          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                          onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
                          title="Borrar comparable">✕</button>
                    }
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
