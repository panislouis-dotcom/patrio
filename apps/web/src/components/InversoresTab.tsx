import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchInvestors, createInvestor } from '../lib/api'
import type { Investor } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fmtM } from '../lib/fmt'

const inputStyle: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${colors.border}`,
  borderRadius: '2px',
  color: colors.neutral,
  fontFamily: fonts.label,
  fontSize: '11px',
  padding: '4px 8px',
  outline: 'none',
  width: '160px',
}

const btnStyle = (variant: 'primary' | 'ghost'): React.CSSProperties => ({
  fontFamily: fonts.label,
  fontSize: '10px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '4px 10px',
  borderRadius: '2px',
  border: variant === 'primary' ? 'none' : `1px solid ${colors.border}`,
  background: variant === 'primary' ? colors.primary : 'transparent',
  color: colors.neutral,
  cursor: 'pointer',
})

export function InversoresTab() {
  const [investors, setInvestors] = useState<Investor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', apellidos: '', email: '', phone: '', notes: '' })
  const navigate = useNavigate()

  useEffect(() => {
    fetchInvestors()
      .then(setInvestors)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const totalInterested = investors.reduce((s, i) => s + i.totalInterested, 0)
  const totalCommitted = investors.reduce((s, i) => s + i.totalCommitted, 0)
  const totalFunded = investors.reduce((s, i) => s + i.totalFunded, 0)

  const handleCreate = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const created = await createInvestor({ name: form.name.trim(), apellidos: form.apellidos.trim(), email: form.email.trim(), phone: form.phone.trim(), notes: form.notes.trim() })
      setInvestors(prev => [...prev, created])
      setForm({ name: '', apellidos: '', email: '', phone: '', notes: '' })
      setShowCreate(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>
  if (error) return <div style={{ padding: '32px', color: 'tomato' }}>Error: {error}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 49px)' }}>
      {/* Summary strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.label, fontSize: '11px', color: colors.secondary, flexWrap: 'wrap' }}>
        <span>Total interesado:</span>
        <span style={{ color: colors.secondary }}>{fmtM(totalInterested)}</span>
        <span style={{ margin: '0 4px' }}>·</span>
        <span>Comprometido:</span>
        <span style={{ color: colors.tertiary }}>{fmtM(totalCommitted)}</span>
        <span style={{ margin: '0 4px' }}>·</span>
        <span>Fondeado:</span>
        <span style={{ color: colors.primary }}>{fmtM(totalFunded)}</span>
        <span style={{ margin: '0 4px' }}>·</span>
        <span style={{ color: colors.neutral }}>{investors.length}</span>
        <span>inversionistas</span>
        <span style={{ marginLeft: 'auto' }}>
          <button style={btnStyle('primary')} onClick={() => setShowCreate(v => !v)}>
            {showCreate ? '✕ CANCELAR' : '+ NUEVO'}
          </button>
        </span>
      </div>

      {/* Inline create form */}
      {showCreate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap', background: colors.surfaceAlt }}>
          <input
            style={{ ...inputStyle, width: '160px' }}
            placeholder="NOMBRE *"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            autoFocus
          />
          <input
            style={{ ...inputStyle, width: '160px' }}
            placeholder="APELLIDOS"
            value={form.apellidos}
            onChange={e => setForm(f => ({ ...f, apellidos: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
          />
          <input
            style={inputStyle}
            placeholder="EMAIL"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
          />
          <input
            style={inputStyle}
            placeholder="TELÉFONO"
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
          />
          <button style={btnStyle('primary')} onClick={handleCreate} disabled={saving || !form.name.trim()}>
            {saving ? '…' : 'GUARDAR'}
          </button>
          <button style={btnStyle('ghost')} onClick={() => { setShowCreate(false); setForm({ name: '', apellidos: '', email: '', phone: '', notes: '' }) }}>
            CANCELAR
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'left', whiteSpace: 'nowrap' }}>NOMBRE</th>
              <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'left', whiteSpace: 'nowrap' }}>APELLIDOS</th>
              <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'left', whiteSpace: 'nowrap' }}>EMAIL</th>
              <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'left', whiteSpace: 'nowrap' }}>TELÉFONO</th>
              <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'right', whiteSpace: 'nowrap' }}>INTERESADO</th>
              <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'right', whiteSpace: 'nowrap' }}>COMPROMETIDO</th>
              <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'right', whiteSpace: 'nowrap' }}>FONDEADO</th>
            </tr>
          </thead>
          <tbody>
            {investors.map(inv => (
              <tr
                key={inv.id}
                onClick={() => navigate(`/inversionistas/${inv.id}`)}
                style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', background: 'transparent' }}
                onMouseEnter={e => (e.currentTarget.style.background = `${colors.border}55`)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '5px 10px', color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', whiteSpace: 'nowrap' }}>{inv.name}</td>
                <td style={{ padding: '5px 10px', color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', whiteSpace: 'nowrap' }}>{inv.apellidos || '—'}</td>
                <td style={{ padding: '5px 10px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px', whiteSpace: 'nowrap' }}>{inv.email || '—'}</td>
                <td style={{ padding: '5px 10px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px', whiteSpace: 'nowrap' }}>{inv.phone || '—'}</td>
                <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(inv.totalInterested)}</td>
                <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.tertiary, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(inv.totalCommitted)}</td>
                <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.primary, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(inv.totalFunded)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
