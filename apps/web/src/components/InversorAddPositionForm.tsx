import type { Project } from '../lib/types'
import { colors, fonts } from '../lib/theme'

interface Props {
  allProjects: Project[]
  projectId: string
  setProjectId: (v: string) => void
  interested: string
  setInterested: (v: string) => void
  committed: string
  setCommitted: (v: string) => void
  funded: string
  setFunded: (v: string) => void
  rate: string
  setRate: (v: string) => void
  date: string
  setDate: (v: string) => void
  adding: boolean
  onAdd: () => void
}

const fStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '11px',
  padding: '4px 6px',
  outline: 'none',
}

export function InversorAddPositionForm({
  allProjects, projectId, setProjectId,
  interested, setInterested, committed, setCommitted, funded, setFunded,
  rate, setRate, date, setDate, adding, onAdd,
}: Props) {
  const amountFields: [string, string, (v: string) => void][] = [
    ['INTERESADO', interested, setInterested],
    ['COMPROMETIDO', committed, setCommitted],
    ['FONDEADO', funded, setFunded],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', padding: '10px', background: colors.surface, border: `1px solid ${colors.border}` }}>
      <select value={projectId} onChange={e => setProjectId(e.target.value)} style={fStyle}>
        <option value="">— seleccionar proyecto —</option>
        {allProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 60px 120px', gap: '6px' }}>
        {amountFields.map(([label, val, setter]) => (
          <div key={label}>
            <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '2px' }}>{label}</div>
            <input type="number" value={val} onChange={e => setter(e.target.value)} placeholder="0" style={{ ...fStyle, width: '100%', textAlign: 'right', boxSizing: 'border-box' }} />
          </div>
        ))}
        <div>
          <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '2px' }}>TASA %</div>
          <input type="number" value={rate} onChange={e => setRate(e.target.value)} style={{ ...fStyle, width: '100%', textAlign: 'right', boxSizing: 'border-box' }} />
        </div>
        <div>
          <div style={{ fontFamily: fonts.label, fontSize: '7px', color: colors.secondary, letterSpacing: '0.1em', marginBottom: '2px' }}>FECHA</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...fStyle, width: '100%', boxSizing: 'border-box' }} />
        </div>
      </div>
      <button
        onClick={onAdd}
        disabled={!projectId || adding}
        style={{
          background: !projectId ? colors.border : colors.primary,
          border: 'none',
          color: colors.neutral,
          cursor: !projectId ? 'not-allowed' : 'pointer',
          fontFamily: fonts.label,
          fontSize: '9px',
          letterSpacing: '0.08em',
          padding: '5px 12px',
          opacity: adding ? 0.6 : 1,
        }}
      >
        {adding ? 'GUARDANDO…' : 'AGREGAR'}
      </button>
    </div>
  )
}
