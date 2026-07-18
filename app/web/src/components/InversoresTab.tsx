import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchInvestors, createInvestor } from '../lib/api'
import type { Investor, InvestorTemperatura, InvestorCapacidad, InvestorFuente, InvestorConfianza } from '../lib/types'
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

type SortKey = 'name' | 'apellidos' | 'email' | 'phone' | 'temperatura' | 'capacidad' | 'fuente' | 'confianza' | 'totalInterested' | 'totalCommitted' | 'totalFunded'

export function InversoresTab() {
  const [investors, setInvestors] = useState<Investor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', apellidos: '', email: '', phone: '', notes: '', temperatura: '' as InvestorTemperatura | '', capacidad: '' as InvestorCapacidad | '', fuente: '' as InvestorFuente | '', confianza: '' as InvestorConfianza | '' })
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const navigate = useNavigate()

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedInvestors = [...investors].sort((a, b) => {
    const aVal = a[sortKey]
    const bVal = b[sortKey]
    const cmp = typeof aVal === 'number'
      ? (aVal as number) - (bVal as number)
      : String(aVal ?? '').localeCompare(String(bVal ?? ''), 'es', { sensitivity: 'base' })
    return sortDir === 'asc' ? cmp : -cmp
  })

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
      const created = await createInvestor({
        name: form.name.trim(), apellidos: form.apellidos.trim(),
        email: form.email.trim(), phone: form.phone.trim(), notes: form.notes.trim(),
        temperatura: form.temperatura || null, capacidad: form.capacidad || null,
        fuente: form.fuente || null, confianza: form.confianza || null,
      })
      setInvestors(prev => [...prev, created])
      setForm({ name: '', apellidos: '', email: '', phone: '', notes: '', temperatura: '', capacidad: '', fuente: '', confianza: '' })
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
          <select style={{ ...inputStyle, width: 'auto' }} value={form.temperatura} onChange={e => setForm(f => ({ ...f, temperatura: e.target.value as InvestorTemperatura | '' }))}>
            <option value="">TEMPERATURA</option>
            <option value="caliente">Caliente</option>
            <option value="tibio">Tibio</option>
            <option value="frio">Frío</option>
          </select>
          <select style={{ ...inputStyle, width: 'auto' }} value={form.capacidad} onChange={e => setForm(f => ({ ...f, capacidad: e.target.value as InvestorCapacidad | '' }))}>
            <option value="">CAPACIDAD</option>
            <option value="<500k">&lt;500k</option>
            <option value="500k-2M">500k–2M</option>
            <option value="2M-5M">2M–5M</option>
            <option value="5M+">5M+</option>
          </select>
          <select style={{ ...inputStyle, width: 'auto' }} value={form.fuente} onChange={e => setForm(f => ({ ...f, fuente: e.target.value as InvestorFuente | '' }))}>
            <option value="">FUENTE</option>
            <option value="red_personal">Red personal</option>
            <option value="referido">Referido</option>
            <option value="red_negocios">Red negocios</option>
            <option value="linkedin">LinkedIn</option>
            <option value="otro">Otro</option>
          </select>
          <select style={{ ...inputStyle, width: 'auto' }} value={form.confianza} onChange={e => setForm(f => ({ ...f, confianza: e.target.value as InvestorConfianza | '' }))}>
            <option value="">CONFIANZA</option>
            <option value="bajo">Bajo</option>
            <option value="medio">Medio</option>
            <option value="alto">Alto</option>
          </select>
          <button style={btnStyle('primary')} onClick={handleCreate} disabled={saving || !form.name.trim()}>
            {saving ? '…' : 'GUARDAR'}
          </button>
          <button style={btnStyle('ghost')} onClick={() => { setShowCreate(false); setForm({ name: '', apellidos: '', email: '', phone: '', notes: '', temperatura: '', capacidad: '', fuente: '', confianza: '' }) }}>
            CANCELAR
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {([
                { key: 'name', label: 'NOMBRE', align: 'left' },
                { key: 'apellidos', label: 'APELLIDOS', align: 'left' },
                { key: 'email', label: 'EMAIL', align: 'left' },
                { key: 'phone', label: 'TELÉFONO', align: 'left' },
                { key: 'temperatura', label: 'TEMP.', align: 'left' },
                { key: 'capacidad', label: 'CAPACIDAD', align: 'left' },
                { key: 'fuente', label: 'FUENTE', align: 'left' },
                { key: 'confianza', label: 'CONFIANZA', align: 'left' },
                { key: 'totalInterested', label: 'INTERESADO', align: 'right' },
                { key: 'totalCommitted', label: 'COMPROMETIDO', align: 'right' },
                { key: 'totalFunded', label: 'FONDEADO', align: 'right' },
              ] as { key: SortKey; label: string; align: 'left' | 'right' }[]).map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    padding: '6px 10px',
                    fontFamily: fonts.label,
                    fontSize: '9px',
                    color: sortKey === col.key ? colors.neutral : colors.secondary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                    textAlign: col.align,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedInvestors.map(inv => (
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
                <td style={{ padding: '5px 10px', fontFamily: fonts.label, fontSize: '10px', whiteSpace: 'nowrap', color: inv.temperatura === 'caliente' ? '#e06c3a' : inv.temperatura === 'tibio' ? '#c8a000' : inv.temperatura === 'frio' ? '#5b9bd5' : colors.secondary }}>{inv.temperatura ?? '—'}</td>
                <td style={{ padding: '5px 10px', color: colors.secondary, fontFamily: fonts.label, fontSize: '10px', whiteSpace: 'nowrap' }}>{inv.capacidad ?? '—'}</td>
                <td style={{ padding: '5px 10px', color: colors.secondary, fontFamily: fonts.label, fontSize: '10px', whiteSpace: 'nowrap' }}>{inv.fuente ? inv.fuente.replace('_', ' ') : '—'}</td>
                <td style={{ padding: '5px 10px', fontFamily: fonts.label, fontSize: '10px', whiteSpace: 'nowrap', color: inv.confianza === 'alto' ? colors.primary : inv.confianza === 'medio' ? colors.tertiary : colors.secondary }}>{inv.confianza ?? '—'}</td>
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
