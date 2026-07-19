import type { ProjectInvestor } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fmtMXN } from '../lib/fmt'

interface Props {
  pos: ProjectInvestor
  isEditing: boolean
  onNavigate: (projectId: number) => void
  editDate: string
  setEditDate: (v: string) => void
  editInterested: string
  setEditInterested: (v: string) => void
  editCommitted: string
  setEditCommitted: (v: string) => void
  editFunded: string
  setEditFunded: (v: string) => void
  editRate: string
  setEditRate: (v: string) => void
  editReturnAmount: string
  setEditReturnAmount: (v: string) => void
  editReturnDate: string
  setEditReturnDate: (v: string) => void
  savingEdit: boolean
  onSave: (pos: ProjectInvestor) => void
  onCancel: () => void
  onLiquidar: (pos: ProjectInvestor) => void
  onRemove: (pos: ProjectInvestor) => void
  onStartEdit: (pos: ProjectInvestor) => void
}

const iStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '11px',
  padding: '3px 5px',
  outline: 'none',
  width: '72px',
  textAlign: 'right',
}

export function InversorPositionRow({
  pos, isEditing, onNavigate,
  editDate, setEditDate,
  editInterested, setEditInterested,
  editCommitted, setEditCommitted,
  editFunded, setEditFunded,
  editRate, setEditRate,
  editReturnAmount, setEditReturnAmount,
  editReturnDate, setEditReturnDate,
  savingEdit, onSave, onCancel, onLiquidar, onRemove, onStartEdit,
}: Props) {
  const paid = pos.returnAmount ?? 0
  const estado = paid <= 0 ? 'PENDIENTE' : paid >= pos.expectedReturn ? 'LIQUIDADO' : 'PARCIAL'
  const estadoColor = paid <= 0 ? colors.secondary : paid >= pos.expectedReturn ? colors.primary : '#907300'

  return (
    <tr key={pos.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
      <td
        style={{ padding: '5px 8px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, cursor: 'pointer' }}
        onClick={() => onNavigate(pos.projectId)}
      >
        {pos.projectName || `Proyecto ${pos.projectId}`}
      </td>
      {isEditing ? (
        <>
          <td style={{ padding: '4px 8px' }}><input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} style={{ ...iStyle, width: '110px', textAlign: 'left' }} /></td>
          <td style={{ padding: '4px 8px', textAlign: 'right' }}><input type="number" value={editInterested} onChange={e => setEditInterested(e.target.value)} style={iStyle} /></td>
          <td style={{ padding: '4px 8px', textAlign: 'right' }}><input type="number" value={editCommitted} onChange={e => setEditCommitted(e.target.value)} style={iStyle} /></td>
          <td style={{ padding: '4px 8px', textAlign: 'right' }}><input type="number" value={editFunded} onChange={e => setEditFunded(e.target.value)} style={iStyle} /></td>
          <td style={{ padding: '4px 8px', textAlign: 'right' }}><input type="number" value={editRate} onChange={e => setEditRate(e.target.value)} style={{ ...iStyle, width: '44px' }} /></td>
          <td style={{ padding: '4px 8px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>—</td>
          <td style={{ padding: '4px 8px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>—</td>
          <td style={{ padding: '4px 8px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>—</td>
          <td style={{ padding: '4px 8px', textAlign: 'right' }}><input type="number" value={editReturnAmount} onChange={e => setEditReturnAmount(e.target.value)} placeholder="0" style={iStyle} /></td>
          <td style={{ padding: '4px 8px' }}><input type="date" value={editReturnDate} onChange={e => setEditReturnDate(e.target.value)} style={{ ...iStyle, width: '110px', textAlign: 'left' }} /></td>
          <td style={{ padding: '4px 8px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>—</td>
          <td style={{ padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
            <button onClick={() => onSave(pos)} disabled={savingEdit} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', padding: '2px 7px', marginRight: '3px', opacity: savingEdit ? 0.6 : 1 }}>{savingEdit ? '…' : 'OK'}</button>
            <button onClick={onCancel} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '2px 5px' }}>✕</button>
          </td>
        </>
      ) : (
        <>
          <td style={{ padding: '5px 8px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary }}>{pos.investmentDate ?? '—'}</td>
          <td style={{ padding: '5px 8px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, textAlign: 'right' }}>{pos.interestedAmount ? fmtMXN(pos.interestedAmount) : '—'}</td>
          <td style={{ padding: '5px 8px', fontFamily: fonts.sans, fontSize: '11px', color: pos.committedAmount ? colors.tertiary : colors.secondary, textAlign: 'right' }}>{pos.committedAmount ? fmtMXN(pos.committedAmount) : '—'}</td>
          <td style={{ padding: '5px 8px', fontFamily: fonts.sans, fontSize: '11px', color: pos.fundedAmount ? colors.primary : colors.secondary, textAlign: 'right' }}>{pos.fundedAmount ? fmtMXN(pos.fundedAmount) : '—'}</td>
          <td style={{ padding: '5px 8px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>{Math.round(pos.interestRateAnnual * 100)}%</td>
          <td style={{ padding: '5px 8px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, textAlign: 'right' }}>{pos.fundedAmount ? fmtMXN(pos.interestAmount) : '—'}</td>
          <td style={{ padding: '5px 8px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'right' }}>{pos.fundedAmount ? `${pos.returnPct.toFixed(1)}%` : '—'}</td>
          <td style={{ padding: '5px 8px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, textAlign: 'right' }}>{pos.fundedAmount ? fmtMXN(pos.expectedReturn) : '—'}</td>
          <td style={{ padding: '5px 8px', fontFamily: fonts.sans, fontSize: '11px', color: pos.returnAmount ? colors.primary : colors.secondary, textAlign: 'right' }}>{pos.returnAmount ? fmtMXN(pos.returnAmount) : '—'}</td>
          <td style={{ padding: '5px 8px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary }}>{pos.returnDate ?? '—'}</td>
          <td style={{ padding: '5px 8px', textAlign: 'right' }}>
            <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.08em', color: estadoColor }}>{estado}</span>
          </td>
          <td style={{ padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
            {estado !== 'LIQUIDADO' && pos.fundedAmount > 0 && (
              <button onClick={() => onLiquidar(pos)} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.05em', padding: '2px 7px', marginRight: '3px' }}>LIQUIDAR</button>
            )}
            <button onClick={() => onStartEdit(pos)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.05em', padding: '2px 7px', marginRight: '3px' }}>EDITAR</button>
            <button onClick={() => onRemove(pos)} style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', padding: '0 2px' }}>✕</button>
          </td>
        </>
      )}
    </tr>
  )
}
