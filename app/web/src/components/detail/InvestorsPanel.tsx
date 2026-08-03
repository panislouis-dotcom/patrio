import { useState } from 'react'
import { addPropertyInvestor, updatePropertyInvestment, deletePropertyInvestment } from '../../lib/api'
import type { Investor, PropertyInvestor, ProfitWaterfall } from '../../lib/types'
import { colors, fonts } from '../../lib/theme'
import { fmtMXN } from '../../lib/fmt'
import { WaterfallTable } from '../finance/WaterfallTable'

interface Props {
  propertyId: number
  investors: PropertyInvestor[]
  allInvestors: Investor[]
  /** Ausente antes de desarrollo: no hay reparto que mostrar todavía. */
  waterfall: ProfitWaterfall | null
  onChange: (next: PropertyInvestor[]) => void
}

/** El embudo, en palabras. El servidor lo deriva de los montos en cada guardado. */
const ETAPA_LABEL: Record<PropertyInvestor['status'], string> = {
  interesado: 'INTERESADO',
  comprometido: 'COMPROMETIDO',
  fondeado: 'FONDEADO',
}

const ETAPA_COLOR: Record<PropertyInvestor['status'], string> = {
  interesado: colors.secondary,
  comprometido: colors.tertiary,
  fondeado: colors.primary,
}

const COLUMNS = ['NOMBRE', 'FECHA', 'ETAPA', 'INTERESADO', 'COMPROMETIDO', 'FONDEADO',
  'TASA', 'CUOTA', 'TOTAL', 'RET %', 'PAGADO', 'LIQUIDACIÓN', ''] as const

/**
 * El embudo de capital de una propiedad: quién puso cuánto, cuánto se le debe y
 * qué queda por liquidar. Abre en oferta — se levanta dinero para un trato que
 * ya se está peleando, no para uno que apenas se mira.
 *
 * Los tres montos del embudo son tres columnas capturables. Cuando el
 * comprometido no se podía teclear, "comprometido" era un estado al que ninguna
 * posición podía llegar.
 */
export function InvestorsPanel({ propertyId, investors, allInvestors, waterfall, onChange }: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [addInvestorId, setAddInvestorId] = useState('')
  const [addInterested, setAddInterested] = useState('')
  const [addCommitted, setAddCommitted] = useState('')
  const [addFunded, setAddFunded] = useState('')
  const [addRate, setAddRate] = useState('12')
  const [addDate, setAddDate] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editInterested, setEditInterested] = useState('')
  const [editCommitted, setEditCommitted] = useState('')
  const [editFunded, setEditFunded] = useState('')
  const [editRate, setEditRate] = useState('12')
  const [editDate, setEditDate] = useState('')
  const [editReturnAmount, setEditReturnAmount] = useState('')
  const [editReturnDate, setEditReturnDate] = useState('')
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd() {
    if (!addInvestorId) return
    setAdding(true)
    setError(null)
    try {
      const pi = await addPropertyInvestor(propertyId, {
        investorId: Number(addInvestorId),
        interestedAmount: Number(addInterested) || 0,
        committedAmount: Number(addCommitted) || 0,
        fundedAmount: Number(addFunded) || 0,
        interestRateAnnual: Number(addRate) / 100,
        investmentDate: addDate || null,
        notes: '',
      })
      onChange([...investors, pi])
      setShowAdd(false)
      setAddInvestorId(''); setAddInterested(''); setAddCommitted(''); setAddFunded('')
      setAddRate('12'); setAddDate('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al agregar')
    } finally {
      setAdding(false)
    }
  }

  function startEdit(pi: PropertyInvestor) {
    setEditingId(pi.id)
    setEditInterested(pi.interestedAmount ? String(pi.interestedAmount) : '')
    setEditCommitted(pi.committedAmount ? String(pi.committedAmount) : '')
    setEditFunded(pi.fundedAmount ? String(pi.fundedAmount) : '')
    setEditRate(String(Math.round(pi.interestRateAnnual * 100)))
    setEditDate(pi.investmentDate ?? '')
    setEditReturnAmount(pi.returnAmount != null ? String(pi.returnAmount) : '')
    setEditReturnDate(pi.returnDate ?? '')
  }

  async function saveEdit(investmentId: number) {
    setSavingId(investmentId)
    setError(null)
    try {
      const pi = await updatePropertyInvestment(propertyId, investmentId, {
        interestedAmount: Number(editInterested) || 0,
        committedAmount: Number(editCommitted) || 0,
        fundedAmount: Number(editFunded) || 0,
        interestRateAnnual: Number(editRate) / 100,
        investmentDate: editDate || null,
        returnAmount: editReturnAmount ? Number(editReturnAmount) : null,
        returnDate: editReturnDate || null,
      })
      onChange(investors.map(x => x.id === investmentId ? pi : x))
      setEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSavingId(null)
    }
  }

  async function remove(investmentId: number) {
    if (!window.confirm('¿Quitar esta inversión de la propiedad?')) return
    await deletePropertyInvestment(propertyId, investmentId)
    onChange(investors.filter(x => x.id !== investmentId))
    if (editingId === investmentId) setEditingId(null)
  }

  async function liquidar(pi: PropertyInvestor) {
    setSavingId(pi.id)
    try {
      const updated = await updatePropertyInvestment(propertyId, pi.id, {
        returnAmount: pi.expectedReturn,
        returnDate: new Date().toISOString().slice(0, 10),
      })
      onChange(investors.map(x => x.id === pi.id ? updated : x))
    } finally {
      setSavingId(null)
    }
  }

  const iStyle: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, color: colors.neutral, fontFamily: fonts.sans, fontSize: '11px', padding: '4px 6px', outline: 'none' }
  const eStyle: React.CSSProperties = { ...iStyle, padding: '3px 5px', width: '70px', textAlign: 'right' }
  const cellS: React.CSSProperties = { padding: '5px', fontFamily: fonts.sans, fontSize: '11px', textAlign: 'right', whiteSpace: 'nowrap' }
  const microS: React.CSSProperties = { padding: '5px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }

  const totals = investors.reduce(
    (acc, pi) => ({
      interested: acc.interested + pi.interestedAmount,
      committed: acc.committed + pi.committedAmount,
      funded: acc.funded + pi.fundedAmount,
      cuota: acc.cuota + pi.interestAmount,
      total: acc.total + pi.expectedReturn,
    }),
    { interested: 0, committed: 0, funded: 0, cuota: 0, total: 0 },
  )

  const amountField = (label: string, value: string, setter: (v: string) => void) => (
    <div key={label}>
      <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '2px' }}>{label}</div>
      <input type="number" value={value} onChange={e => setter(e.target.value)} aria-label={label} placeholder="0" style={{ ...iStyle, width: '100%', textAlign: 'right', boxSizing: 'border-box' }} />
    </div>
  )

  return (
    <div>
      {waterfall && (
        <div style={{ marginBottom: '20px' }}>
          <WaterfallTable waterfall={waterfall} />
        </div>
      )}

      <div style={{ borderTop: waterfall ? `1px solid ${colors.border}` : 'none', paddingTop: waterfall ? '20px' : 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em' }}>
            INVERSIONISTAS{waterfall ? ` (${waterfall.months} meses)` : ''}
          </span>
          <button
            onClick={() => { setShowAdd(v => !v); setEditingId(null) }}
            style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em', padding: '2px 8px' }}
          >
            {showAdd ? '✕' : '+ AGREGAR'}
          </button>
        </div>

        {error && <div style={{ color: '#c0392b', fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>{error}</div>}

        {showAdd && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px', padding: '10px', background: colors.surface, border: `1px solid ${colors.border}` }}>
            <select value={addInvestorId} onChange={e => setAddInvestorId(e.target.value)} aria-label="Inversionista" style={iStyle}>
              <option value="">— seleccionar inversionista —</option>
              {allInvestors.map(inv => <option key={inv.id} value={inv.id}>{[inv.name, inv.apellidos].filter(Boolean).join(' ')}</option>)}
            </select>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 60px 120px', gap: '6px' }}>
              {amountField('INTERESADO', addInterested, setAddInterested)}
              {amountField('COMPROMETIDO', addCommitted, setAddCommitted)}
              {amountField('FONDEADO', addFunded, setAddFunded)}
              <div>
                <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '2px' }}>TASA %</div>
                <input type="number" value={addRate} onChange={e => setAddRate(e.target.value)} aria-label="TASA %" style={{ ...iStyle, width: '100%', textAlign: 'right', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '2px' }}>FECHA INVERSIÓN</div>
                <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} aria-label="FECHA INVERSIÓN" style={{ ...iStyle, width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ fontFamily: fonts.sans, fontSize: '9px', color: colors.secondary }}>
              La etapa se deduce del monto: comprometido mueve a COMPROMETIDO, fondeado a FONDEADO.
            </div>
            <button
              onClick={handleAdd}
              disabled={!addInvestorId || adding}
              style={{ background: !addInvestorId ? colors.border : colors.primary, border: 'none', color: colors.neutral, cursor: !addInvestorId ? 'not-allowed' : 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '5px 12px', opacity: adding ? 0.6 : 1 }}
            >
              {adding ? 'GUARDANDO…' : 'AGREGAR'}
            </button>
          </div>
        )}

        {investors.length === 0 && !showAdd ? (
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Sin inversionistas registrados.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                {COLUMNS.map(h => (
                  <th key={h} style={{ padding: '4px 5px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, textAlign: h === 'NOMBRE' || h === 'FECHA' || h === 'ETAPA' ? 'left' : 'right', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {investors.map(pi => {
                const isEditing = editingId === pi.id
                const isSaving = savingId === pi.id
                const paid = pi.returnAmount ?? 0
                const estado = paid <= 0 ? 'PENDIENTE' : paid >= pi.expectedReturn ? 'LIQUIDADO' : 'PARCIAL'
                const estadoColor = paid <= 0 ? colors.secondary : paid >= pi.expectedReturn ? colors.primary : '#8A6D00'
                return (
                  <tr key={pi.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ padding: '5px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, whiteSpace: 'nowrap' }}>{pi.investorName}</td>
                    {isEditing ? (
                      <>
                        <td style={{ padding: '4px 5px' }}><input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} aria-label="FECHA" style={{ ...eStyle, width: '110px', textAlign: 'left' }} /></td>
                        <td style={microS}>—</td>
                        <td style={{ padding: '4px 5px', textAlign: 'right' }}><input type="number" value={editInterested} onChange={e => setEditInterested(e.target.value)} aria-label="INTERESADO" style={eStyle} /></td>
                        <td style={{ padding: '4px 5px', textAlign: 'right' }}><input type="number" value={editCommitted} onChange={e => setEditCommitted(e.target.value)} aria-label="COMPROMETIDO" style={eStyle} /></td>
                        <td style={{ padding: '4px 5px', textAlign: 'right' }}><input type="number" value={editFunded} onChange={e => setEditFunded(e.target.value)} aria-label="FONDEADO" style={eStyle} /></td>
                        <td style={{ padding: '4px 5px', textAlign: 'right' }}><input type="number" value={editRate} onChange={e => setEditRate(e.target.value)} aria-label="TASA" style={{ ...eStyle, width: '44px' }} /></td>
                        <td colSpan={3} style={microS}>—</td>
                        <td style={{ padding: '4px 5px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <input type="number" value={editReturnAmount} onChange={e => setEditReturnAmount(e.target.value)} aria-label="PAGADO" placeholder="Monto" style={{ ...eStyle, width: '70px' }} />
                            <input type="date" value={editReturnDate} onChange={e => setEditReturnDate(e.target.value)} aria-label="FECHA PAGO" style={{ ...eStyle, width: '110px', textAlign: 'left' }} />
                          </div>
                        </td>
                        <td style={microS}>—</td>
                        <td style={{ padding: '4px 5px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button onClick={() => saveEdit(pi.id)} disabled={isSaving} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 7px', marginRight: '3px', opacity: isSaving ? 0.6 : 1 }}>{isSaving ? '…' : 'OK'}</button>
                          <button onClick={() => setEditingId(null)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '2px 5px' }}>✕</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '5px', fontFamily: fonts.sans, fontSize: '10px', color: colors.secondary }}>{pi.investmentDate ?? '—'}</td>
                        <td style={{ padding: '5px', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.08em', color: ETAPA_COLOR[pi.status], whiteSpace: 'nowrap' }}>{ETAPA_LABEL[pi.status]}</td>
                        <td style={{ ...cellS, color: pi.interestedAmount ? colors.neutral : colors.secondary }}>{pi.interestedAmount ? fmtMXN(pi.interestedAmount) : '—'}</td>
                        <td style={{ ...cellS, color: pi.committedAmount ? colors.tertiary : colors.secondary }}>{pi.committedAmount ? fmtMXN(pi.committedAmount) : '—'}</td>
                        <td style={{ ...cellS, color: pi.fundedAmount ? colors.primary : colors.secondary }}>{pi.fundedAmount ? fmtMXN(pi.fundedAmount) : '—'}</td>
                        <td style={microS}>{Math.round(pi.interestRateAnnual * 100)}%</td>
                        <td style={{ ...cellS, color: colors.neutral }}>{pi.fundedAmount ? fmtMXN(pi.interestAmount) : '—'}</td>
                        <td style={{ ...cellS, color: colors.neutral }}>{pi.fundedAmount ? fmtMXN(pi.expectedReturn) : '—'}</td>
                        <td style={microS}>{pi.fundedAmount ? `${pi.returnPct.toFixed(1)}%` : '—'}</td>
                        <td style={{ ...cellS, color: pi.returnAmount ? colors.primary : colors.secondary }}>
                          {pi.returnAmount ? fmtMXN(pi.returnAmount) : '—'}
                          {pi.returnDate && <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary }}>{pi.returnDate}</div>}
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right' }}>
                          <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.08em', color: estadoColor }}>{estado}</span>
                        </td>
                        <td style={{ padding: '5px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {estado !== 'LIQUIDADO' && pi.fundedAmount > 0 && (
                            <button onClick={() => liquidar(pi)} disabled={isSaving} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.05em', padding: '2px 6px', marginRight: '3px', opacity: isSaving ? 0.6 : 1 }}>LIQUIDAR</button>
                          )}
                          <button onClick={() => startEdit(pi)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.05em', padding: '2px 6px', marginRight: '3px' }}>EDITAR</button>
                          <button onClick={() => remove(pi.id)} style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '0 2px' }}>✕</button>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
              {investors.length > 1 && (
                <tr style={{ borderTop: `1px solid ${colors.border}`, background: colors.surface }}>
                  <td colSpan={3} style={{ padding: '5px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>TOTAL ACUMULADO</td>
                  <td style={{ ...cellS, fontFamily: fonts.label, fontSize: '10px', color: colors.neutral }}>{fmtMXN(totals.interested)}</td>
                  <td style={{ ...cellS, fontFamily: fonts.label, fontSize: '10px', color: colors.tertiary }}>{fmtMXN(totals.committed)}</td>
                  <td style={{ ...cellS, fontFamily: fonts.label, fontSize: '10px', color: colors.primary }}>{fmtMXN(totals.funded)}</td>
                  <td />
                  <td style={{ ...cellS, fontFamily: fonts.label, fontSize: '10px', color: colors.neutral }}>{fmtMXN(totals.cuota)}</td>
                  <td style={{ ...cellS, fontFamily: fonts.label, fontSize: '10px', color: colors.neutral }}>{fmtMXN(totals.total)}</td>
                  <td /><td /><td /><td />
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}
