import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchInvestor, updateInvestor, deleteInvestor } from '../lib/api'
import type { Investor, ProjectInvestor } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import { fmtM } from '../lib/fmt'

const STATUS_COLOR: Record<ProjectInvestor['status'], string> = {
  fondeado: colors.primary,
  comprometido: colors.tertiary,
  interesado: colors.secondary,
}

function relevantAmount(pos: ProjectInvestor): number {
  if (pos.status === 'fondeado') return pos.fundedAmount
  if (pos.status === 'comprometido') return pos.committedAmount
  return pos.interestedAmount
}

export function InversorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const investorId = Number(id)

  const [investor, setInvestor] = useState<Investor | null>(null)
  const [positions, setPositions] = useState<ProjectInvestor[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchInvestor(investorId).then(data => {
      setInvestor(data)
      setPositions(data.positions)
      setName(data.name)
      setEmail(data.email)
      setPhone(data.phone)
      setNotes(data.notes ?? '')
    })
  }, [investorId])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateInvestor(investorId, { name, email, phone, notes })
      setInvestor(updated)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('¿Eliminar inversionista?')) return
    try {
      await deleteInvestor(investorId)
      navigate('/inversionistas')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al eliminar')
    }
  }

  if (!investor) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 49px)', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
        CARGANDO…
      </div>
    )
  }

  const divider = (label: string) => (
    <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, padding: '12px 0 6px', borderBottom: `1px solid ${colors.border}`, marginBottom: '8px', marginTop: '4px' }}>
      {label}
    </div>
  )

  const stat = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary }}>{label}</span>
      <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{value}</span>
    </div>
  )

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: colors.dark }}>

      {/* ── HEADER ── */}
      <div style={{
        flexShrink: 0,
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '0 24px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.dark,
      }}>
        <button
          onClick={() => navigate('/inversionistas')}
          style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: 0, flexShrink: 0 }}
        >
          ← VOLVER
        </button>
        <span style={{ color: colors.border }}>·</span>
        <span style={{ fontFamily: fonts.serif, fontSize: '20px', color: colors.neutral, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {investor.name}
        </span>
        <button
          onClick={handleDelete}
          style={{
            background: 'transparent',
            border: `1px solid tomato`,
            color: 'tomato',
            cursor: 'pointer',
            fontFamily: fonts.label,
            fontSize: '9px',
            letterSpacing: '0.1em',
            padding: '5px 14px',
            flexShrink: 0,
          }}
        >
          ELIMINAR
        </button>
      </div>

      {/* ── MAIN 2-COLUMN GRID ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '300px 1fr', overflow: 'hidden' }}>

        {/* ── LEFT: Datos editables ── */}
        <div style={{
          borderRight: `1px solid ${colors.border}`,
          overflowY: 'auto',
          padding: '20px',
          scrollbarWidth: 'none',
        }}>
          {divider('DATOS')}

          {stat('TOTAL INTERESADO', fmtM(investor.totalInterested))}
          {stat('TOTAL COMPROMETIDO', fmtM(investor.totalCommitted))}
          {stat('TOTAL FONDEADO', fmtM(investor.totalFunded))}

          {divider('EDITAR')}

          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '4px' }}>NOMBRE</div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              type="text"
              style={fieldInput}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '4px' }}>EMAIL</div>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              style={fieldInput}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '4px' }}>TELÉFONO</div>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              type="tel"
              style={fieldInput}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '4px' }}>NOTAS</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              style={{ ...fieldInput, resize: 'vertical' }}
            />
          </div>

          {error && (
            <div style={{ color: colors.tertiary, fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>{error}</div>
          )}

          <button
            onClick={save}
            disabled={saving}
            style={{
              background: colors.primary,
              border: 'none',
              color: colors.neutral,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: fonts.label,
              fontSize: '9px',
              letterSpacing: '0.1em',
              padding: '8px 20px',
              opacity: saving ? 0.7 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            {saving ? 'GUARDANDO…' : 'GUARDAR'}
          </button>
        </div>

        {/* ── RIGHT: Proyectos ── */}
        <div style={{
          overflowY: 'auto',
          padding: '20px',
          scrollbarWidth: 'none',
        }}>
          {divider('PROYECTOS')}

          {positions.length === 0 ? (
            <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, marginTop: '8px' }}>
              Sin proyectos asociados
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  {['PROYECTO', 'ESTADO', 'MONTO RELEVANTE', 'TASA'].map(h => (
                    <th key={h} style={{ padding: '5px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textAlign: 'left', letterSpacing: '0.1em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => (
                  <tr
                    key={pos.id}
                    onClick={() => navigate(`/proyectos/${pos.projectId}`)}
                    style={{ borderBottom: `1px solid ${colors.border}`, cursor: 'pointer' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = colors.surfaceAlt }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}
                  >
                    <td style={{ padding: '8px 10px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>
                      {pos.investorName || `Proyecto ${pos.projectId}`}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{
                        fontFamily: fonts.label,
                        fontSize: '8px',
                        letterSpacing: '0.08em',
                        color: STATUS_COLOR[pos.status],
                        background: `${STATUS_COLOR[pos.status]}22`,
                        padding: '2px 8px',
                        display: 'inline-block',
                      }}>
                        {pos.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>
                      {fmtM(relevantAmount(pos))}
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: fonts.label, fontSize: '10px', color: colors.secondary }}>
                      {pos.interestRateAnnual ? `${pos.interestRateAnnual}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
