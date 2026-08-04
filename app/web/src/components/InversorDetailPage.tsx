import { useParams, useNavigate } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import { fmtM } from '../lib/fmt'
import { StatRow } from './StatRow'
import { useInversorDetail } from '../hooks/useInversorDetail'
import { InversorAddPositionForm } from './InversorAddPositionForm'
import { InversorPositionRow } from './InversorPositionRow'
import { pageFill } from '../lib/styles'

export function InversorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const investorId = Number(id)

  const {
    investor, positions, fundableProperties,
    name, setName, apellidos, setApellidos, email, setEmail, phone, setPhone,
    notes, setNotes, temperatura, setTemperatura, capacidad, setCapacidad,
    fuente, setFuente, confianza, setConfianza,
    saving, error, save, handleDelete,
    showAdd, setShowAdd,
    addPropertyId, setAddPropertyId,
    addInterested, setAddInterested, addCommitted, setAddCommitted,
    addFunded, setAddFunded, addRate, setAddRate, addDate, setAddDate,
    adding, handleAddPosition,
    editingId, setEditingId,
    editInterested, setEditInterested, editCommitted, setEditCommitted,
    editFunded, setEditFunded, editRate, setEditRate, editDate, setEditDate,
    editReturnAmount, setEditReturnAmount, editReturnDate, setEditReturnDate,
    savingEdit, startEdit, handleSaveEdit, handleRemovePosition, handleLiquidar,
  } = useInversorDetail(investorId)

  if (!investor) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', ...pageFill, color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
        CARGANDO…
      </div>
    )
  }

  const divider = (label: string) => (
    <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, padding: '12px 0 6px', borderBottom: `1px solid ${colors.border}`, marginBottom: '8px', marginTop: '4px' }}>
      {label}
    </div>
  )

  return (
    <div style={{ ...pageFill, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: colors.dark }}>

      {/* ── HEADER ── */}
      <div style={{
        flexShrink: 0, height: '52px', display: 'flex', alignItems: 'center', gap: '16px',
        padding: '0 24px', borderBottom: `1px solid ${colors.border}`, background: colors.dark,
      }}>
        <button
          onClick={() => navigate('/inversionistas')}
          style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: 0, flexShrink: 0 }}
        >
          ← VOLVER
        </button>
        <span style={{ color: colors.border }}>·</span>
        <span style={{ fontFamily: fonts.serif, fontSize: '20px', color: colors.neutral, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {[investor.name, investor.apellidos].filter(Boolean).join(' ')}
        </span>
        <button
          onClick={handleDelete}
          style={{ background: 'transparent', border: `1px solid #E62300`, color: '#E62300', cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '5px 14px', flexShrink: 0 }}
        >
          ELIMINAR
        </button>
      </div>

      {/* ── MAIN 2-COLUMN GRID ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '300px 1fr', overflow: 'hidden' }}>

        {/* ── LEFT: Stats + edit form ── */}
        <div style={{ borderRight: `1px solid ${colors.border}`, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>
          {divider('DATOS')}
          <StatRow label="TOTAL INTERESADO"   value={fmtM(positions.reduce((s, p) => s + p.interestedAmount, 0))} />
          <StatRow label="TOTAL COMPROMETIDO" value={fmtM(positions.reduce((s, p) => s + p.committedAmount, 0))} />
          <StatRow label="TOTAL FONDEADO"     value={fmtM(positions.reduce((s, p) => s + p.fundedAmount, 0))} />

          {divider('RETORNOS')}
          {(() => {
            const totalARecibir = positions.reduce((s, p) => s + p.expectedReturn, 0)
            const totalPagado   = positions.reduce((s, p) => s + (p.returnAmount ?? 0), 0)
            const pendiente     = Math.max(0, totalARecibir - totalPagado)
            return (
              <>
                <StatRow label="TOTAL A RECIBIR" value={fmtM(totalARecibir)} />
                <StatRow label="TOTAL PAGADO"    value={fmtM(totalPagado)} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                  <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary }}>PENDIENTE</span>
                  <span style={{ fontFamily: fonts.sans, fontSize: '13px', color: pendiente > 0 ? '#E62300' : colors.primary }}>{fmtM(pendiente)}</span>
                </div>
              </>
            )
          })()}

          {divider('EDITAR')}

          {([
            ['NOMBRE',    name,      setName,      'text' ],
            ['APELLIDOS', apellidos, setApellidos, 'text' ],
            ['EMAIL',     email,     setEmail,     'email'],
            ['TELÉFONO',  phone,     setPhone,     'tel'  ],
          ] as [string, string, (v: string) => void, string][]).map(([label, val, setter, type]) => (
            <div key={label} style={{ marginBottom: '14px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
              <input value={val} onChange={e => setter(e.target.value)} type={type} style={fieldInput} />
            </div>
          ))}

          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '4px' }}>NOTAS</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} style={{ ...fieldInput, resize: 'vertical' }} />
          </div>

          {([
            ['TEMPERATURA', temperatura, setTemperatura, [['caliente','Caliente'],['tibio','Tibio'],['frio','Frío']]],
            ['CAPACIDAD',   capacidad,   setCapacidad,   [['<500k','<500k'],['500k-2M','500k–2M'],['2M-5M','2M–5M'],['5M+','5M+']]],
            ['FUENTE',      fuente,      setFuente,      [['red_personal','Red personal'],['referido','Referido'],['red_negocios','Red negocios'],['linkedin','LinkedIn'],['otro','Otro']]],
            ['CONFIANZA',   confianza,   setConfianza,   [['bajo','Bajo'],['medio','Medio'],['alto','Alto']]],
          ] as [string, string, (v: string) => void, [string, string][]][]).map(([label, val, setter, opts]) => (
            <div key={label} style={{ marginBottom: '14px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
              <select value={val} onChange={e => setter(e.target.value)} style={fieldInput}>
                <option value="">—</option>
                {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          ))}

          {error && (
            <div style={{ color: colors.tertiary, fontFamily: fonts.sans, fontSize: '11px', marginBottom: '8px' }}>{error}</div>
          )}

          <button
            onClick={save}
            disabled={saving}
            style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: '8px 20px', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'GUARDANDO…' : 'GUARDAR'}
          </button>
        </div>

        {/* ── RIGHT: Positions table ── */}
        <div style={{ overflowY: 'auto', padding: '20px', scrollbarWidth: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 6px', borderBottom: `1px solid ${colors.border}`, marginBottom: '8px', marginTop: '4px' }}>
            <span data-testid="propiedades-section-heading" style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary }}>PROPIEDADES</span>
            <button
              onClick={() => { setShowAdd(v => !v); setEditingId(null) }}
              style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em', padding: '2px 8px' }}
            >
              {showAdd ? '✕' : '+ AGREGAR'}
            </button>
          </div>

          {showAdd && (
            <InversorAddPositionForm
              properties={fundableProperties}
              propertyId={addPropertyId}    setPropertyId={setAddPropertyId}
              interested={addInterested}  setInterested={setAddInterested}
              committed={addCommitted}    setCommitted={setAddCommitted}
              funded={addFunded}          setFunded={setAddFunded}
              rate={addRate}              setRate={setAddRate}
              date={addDate}              setDate={setAddDate}
              adding={adding}
              onAdd={handleAddPosition}
            />
          )}

          {positions.length === 0 && !showAdd ? (
            <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, marginTop: '8px' }}>
              Sin propiedades asociadas
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  {(['PROPIEDAD', 'FECHA', 'INTERESADO', 'COMPROMETIDO', 'FONDEADO', 'TASA', 'INTERÉS', 'RET %', 'RETORNO', 'PAGADO', 'FECHA PAGO', 'ESTADO', ''] as string[]).map(h => (
                    <th key={h} style={{ padding: '5px 8px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, textAlign: h === 'PROPIEDAD' || h === 'FECHA' ? 'left' : 'right', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => (
                  <InversorPositionRow
                    key={pos.id}
                    pos={pos}
                    isEditing={editingId === pos.id}
                    onNavigate={propertyId => navigate(`/propiedades/${propertyId}`)}
                    editDate={editDate}                 setEditDate={setEditDate}
                    editInterested={editInterested}     setEditInterested={setEditInterested}
                    editCommitted={editCommitted}       setEditCommitted={setEditCommitted}
                    editFunded={editFunded}             setEditFunded={setEditFunded}
                    editRate={editRate}                 setEditRate={setEditRate}
                    editReturnAmount={editReturnAmount} setEditReturnAmount={setEditReturnAmount}
                    editReturnDate={editReturnDate}     setEditReturnDate={setEditReturnDate}
                    savingEdit={savingEdit}
                    onSave={handleSaveEdit}
                    onCancel={() => setEditingId(null)}
                    onLiquidar={handleLiquidar}
                    onRemove={handleRemovePosition}
                    onStartEdit={startEdit}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
