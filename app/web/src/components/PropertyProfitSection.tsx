import { useEffect, useState } from 'react'
import { fetchPropertyProfit, updatePropertyProfit } from '../lib/api'
import type { ProfitSplitConfig, ProfitWaterfall, TeamMember } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fmtMXN } from '../lib/fmt'

function toggleId(ids: number[], id: number): number[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
}

const sectionDivider = (label: string) => (
  <div style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: '4px', marginBottom: '12px' }}>
    <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em' }}>
      {label}
    </span>
  </div>
)

const labelStyle: React.CSSProperties = {
  fontFamily: fonts.label,
  fontSize: '9px',
  color: colors.secondary,
  letterSpacing: '0.08em',
}

const inputStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '12px',
  padding: '5px 8px',
  outline: 'none',
  width: '100%',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  propertyId: number
  team: TeamMember[]
  showWaterfall?: boolean
  showInvestorBreakdown?: boolean
  onWaterfallChange?: (w: ProfitWaterfall) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PropertyProfitSection({ propertyId, team, showWaterfall = true, showInvestorBreakdown = true, onWaterfallChange }: Props) {
  const [config, setConfig] = useState<ProfitSplitConfig | null>(null)
  const [waterfall, setWaterfall] = useState<ProfitWaterfall | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // draft fields — split percentages and assignments only
  const [finderFeePct, setFinderFeePct] = useState<string>('0')
  const [directorPct, setDirectorPct] = useState<string>('0')
  const [responsablePct, setResponsablePct] = useState<string>('0')
  const [liderPct, setLiderPct] = useState<string>('0')
  const [maestroPct, setMaestroPct] = useState<string>('0')
  const [ayudantePct, setAyudantePct] = useState<string>('0')
  const [finderMemberId, setFinderMemberId] = useState<string>('')
  const [responsableMemberId, setResponsableMemberId] = useState<string>('')
  const [liderMemberId, setLiderMemberId] = useState<string>('')
  const [maestroMemberIds, setMaestroMemberIds] = useState<number[]>([])
  const [ayudanteMemberIds, setAyudanteMemberIds] = useState<number[]>([])
  const [maestroCount, setMaestroCount] = useState<string>('')
  const [ayudanteCount, setAyudanteCount] = useState<string>('')

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    fetchPropertyProfit(propertyId).then(({ config, waterfall }) => {
      setConfig(config)
      setWaterfall(waterfall)
      onWaterfallChange?.(waterfall)
      setFinderFeePct(String(Math.round(config.finderFeePct * 100)))
      setDirectorPct(String(Math.round(config.directorPct * 100)))
      setResponsablePct(String(Math.round(config.responsablePct * 100)))
      setLiderPct(String(Math.round(config.liderPct * 100)))
      setMaestroPct(String(Math.round(config.maestroPct * 100)))
      setAyudantePct(String(Math.round(config.ayudantePct * 100)))
      setFinderMemberId(config.finderMemberId != null ? String(config.finderMemberId) : '')
      setResponsableMemberId(config.responsableMemberId != null ? String(config.responsableMemberId) : '')
      setLiderMemberId(config.liderMemberId != null ? String(config.liderMemberId) : '')
      setMaestroMemberIds(config.maestroMemberIds)
      setAyudanteMemberIds(config.ayudanteMemberIds)
      setMaestroCount(config.maestroCount != null ? String(config.maestroCount) : '')
      setAyudanteCount(config.ayudanteCount != null ? String(config.ayudanteCount) : '')
      setLoading(false)
    }).catch((err: unknown) => {
      setFetchError(err instanceof Error ? err.message : 'Error al cargar datos')
      setLoading(false)
    })
  }, [propertyId])

  async function handleSave() {
    setSaving(true)
    try {
      const draft: Partial<ProfitSplitConfig> = {
        finderFeePct: Number(finderFeePct) / 100,
        directorPct: Number(directorPct) / 100,
        responsablePct: Number(responsablePct) / 100,
        liderPct: Number(liderPct) / 100,
        maestroPct: Number(maestroPct) / 100,
        ayudantePct: Number(ayudantePct) / 100,
        finderMemberId: finderMemberId ? Number(finderMemberId) : null,
        responsableMemberId: responsableMemberId ? Number(responsableMemberId) : null,
        liderMemberId: liderMemberId ? Number(liderMemberId) : null,
        maestroMemberIds,
        ayudanteMemberIds,
        maestroCount: maestroCount ? Number(maestroCount) : null,
        ayudanteCount: ayudanteCount ? Number(ayudanteCount) : null,
      }
      const result = await updatePropertyProfit(propertyId, draft)
      setConfig(result.config)
      setWaterfall(result.waterfall)
      onWaterfallChange?.(result.waterfall)
      setSaveError(null)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (fetchError) {
    return (
      <div style={{ padding: '16px', fontFamily: fonts.label, fontSize: '10px', color: '#e55', letterSpacing: '0.08em' }}>
        {fetchError}
      </div>
    )
  }

  if (loading || !waterfall || !config) {
    return (
      <div style={{ padding: '16px', fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, letterSpacing: '0.08em' }}>
        CARGANDO…
      </div>
    )
  }

  const responsableMembers = team.filter(m => m.role === 'responsable_proyecto' || m.role === 'director')
  const liderMembers = team.filter(m => m.role === 'lider_proyecto')
  const maestroMembers = team.filter(m => m.role === 'maestro')
  const ayudanteMembers = team.filter(m => m.role === 'ayudante')

  const pctInput = (value: string, onChange: (v: string) => void) => (
    <input
      type="number"
      value={value}
      onChange={e => onChange(e.target.value)}
      step="1"
      min="0"
      max="100"
      style={{ ...inputStyle, width: '52px', textAlign: 'right' }}
    />
  )

  return (
    <div style={{ padding: '0', display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── FLUJO FINANCIERO ─────────────────────────────────────────────────── */}
      {showWaterfall && <div>
        {sectionDivider('FLUJO FINANCIERO')}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {([
              { label: 'PRECIO DE SALIDA',    value: waterfall.exitPrice,      dividerBefore: false, indent: false, highlight: false },
              { label: '− INVERSIÓN TOTAL',   value: waterfall.investment,     dividerBefore: false, indent: false, highlight: false },
              { label: 'GANANCIA BRUTA',      value: waterfall.grossProfit,    dividerBefore: true,  indent: true,  highlight: false },
              { label: '− CUOTA INVERSORES',  value: waterfall.investorCuota,  dividerBefore: false, indent: false, highlight: false },
              { label: 'GANANCIA OPERADOR',   value: waterfall.operatorGross,  dividerBefore: true,  indent: true,  highlight: false },
              { label: `− ISR (${Math.round((config.isrRate || 0.30) * 100)}%)`, value: waterfall.isr, dividerBefore: false, indent: false, highlight: false },
              { label: 'DISTRIBUIBLE',        value: waterfall.distributable,  dividerBefore: true,  indent: true,  highlight: true  },
            ] as { label: string; value: number; dividerBefore: boolean; indent: boolean; highlight: boolean }[]).map(row => (
              <tr key={row.label} style={{ borderTop: row.dividerBefore ? `1px solid ${colors.border}` : undefined }}>
                <td style={{ padding: '4px 0', paddingLeft: row.indent ? '10px' : '0', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.08em' }}>
                  {row.label}
                </td>
                <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: fonts.sans, fontSize: '11px', color: row.highlight ? colors.primary : colors.neutral }}>
                  {fmtMXN(row.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}

      {/* ── PAGOS A INVERSORES ───────────────────────────────────────────────── */}
      {showInvestorBreakdown && waterfall.investorBreakdown.length > 0 && (
        <div>
          {sectionDivider(`PAGOS A INVERSORES (${waterfall.months} meses)`)}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                {(['INVERSOR', 'FONDEO', 'TASA', 'CUOTA', 'TOTAL RETORNO'] as string[]).map((h, i) => (
                  <th key={h} style={{ ...labelStyle, padding: '3px 4px', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {waterfall.investorBreakdown.map((entry, idx) => (
                <tr key={idx} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={{ padding: '5px 4px', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{entry.name}</td>
                  <td style={{ padding: '5px 4px', textAlign: 'right', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{fmtMXN(entry.fundedAmount)}</td>
                  <td style={{ padding: '5px 4px', textAlign: 'right', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary }}>{Math.round(entry.interestRateAnnual * 100)}%</td>
                  <td style={{ padding: '5px 4px', textAlign: 'right', fontFamily: fonts.sans, fontSize: '11px', color: colors.tertiary }}>{fmtMXN(entry.cuota)}</td>
                  <td style={{ padding: '5px 4px', textAlign: 'right', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, fontWeight: 600 }}>{fmtMXN(entry.totalReturn)}</td>
                </tr>
              ))}
              {waterfall.investorBreakdown.length > 1 && (
                <tr style={{ borderTop: `1px solid ${colors.border}` }}>
                  <td style={{ padding: '5px 4px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.08em' }}>TOTAL</td>
                  <td style={{ padding: '5px 4px', textAlign: 'right', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{fmtMXN(waterfall.investorBreakdown.reduce((s, e) => s + e.fundedAmount, 0))}</td>
                  <td />
                  <td style={{ padding: '5px 4px', textAlign: 'right', fontFamily: fonts.sans, fontSize: '11px', color: colors.tertiary }}>{fmtMXN(waterfall.investorBreakdown.reduce((s, e) => s + e.cuota, 0))}</td>
                  <td style={{ padding: '5px 4px', textAlign: 'right', fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, fontWeight: 600 }}>{fmtMXN(waterfall.investorBreakdown.reduce((s, e) => s + e.totalReturn, 0))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── SPLIT DEL EQUIPO ─────────────────────────────────────────────────── */}
      <div>
        {sectionDivider('SPLIT DEL EQUIPO')}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

          {/* FINDER */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <span style={{ ...labelStyle, minWidth: '80px' }}>FINDER</span>
              {pctInput(finderFeePct, setFinderFeePct)}
              <span style={labelStyle}>%</span>
            </div>
            <select value={finderMemberId} onChange={e => setFinderMemberId(e.target.value)} style={selectStyle}>
              <option value="">— sin asignar —</option>
              {team.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
            </select>
          </div>

          {/* DIRECTORES */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ ...labelStyle, minWidth: '80px' }}>DIRECTORES</span>
            {pctInput(directorPct, setDirectorPct)}
            <span style={labelStyle}>%</span>
          </div>

          {/* RESPONSABLE */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <span style={{ ...labelStyle, minWidth: '80px' }}>RESPONSABLE</span>
              {pctInput(responsablePct, setResponsablePct)}
              <span style={labelStyle}>%</span>
            </div>
            <select value={responsableMemberId} onChange={e => setResponsableMemberId(e.target.value)} style={selectStyle}>
              <option value="">— sin asignar —</option>
              {responsableMembers.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
            </select>
          </div>

          {/* LÍDER */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <span style={{ ...labelStyle, minWidth: '80px' }}>LÍDER</span>
              {pctInput(liderPct, setLiderPct)}
              <span style={labelStyle}>%</span>
            </div>
            <select value={liderMemberId} onChange={e => setLiderMemberId(e.target.value)} style={selectStyle}>
              <option value="">— sin asignar —</option>
              {liderMembers.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
            </select>
          </div>

          {/* MAESTROS */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <span style={{ ...labelStyle, minWidth: '80px' }}>MAESTROS</span>
              {pctInput(maestroPct, setMaestroPct)}
              <span style={labelStyle}>%</span>
              <input
                type="number"
                min="0"
                placeholder="# personas"
                value={maestroCount}
                onChange={e => setMaestroCount(e.target.value)}
                style={{ ...inputStyle, width: '76px', textAlign: 'right' }}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginLeft: '4px' }}>
              {maestroMembers.map(m => (
                <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={maestroMemberIds.includes(m.id)}
                    onChange={() => setMaestroMemberIds(prev => toggleId(prev, m.id))}
                    style={{ accentColor: colors.primary }}
                  />
                  <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{m.name}</span>
                </label>
              ))}
              {maestroMembers.length === 0 && <span style={labelStyle}>sin maestros en el equipo</span>}
            </div>
          </div>

          {/* AYUDANTES */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <span style={{ ...labelStyle, minWidth: '80px' }}>AYUDANTES</span>
              {pctInput(ayudantePct, setAyudantePct)}
              <span style={labelStyle}>%</span>
              <input
                type="number"
                min="0"
                placeholder="# personas"
                value={ayudanteCount}
                onChange={e => setAyudanteCount(e.target.value)}
                style={{ ...inputStyle, width: '76px', textAlign: 'right' }}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginLeft: '4px' }}>
              {ayudanteMembers.map(m => (
                <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={ayudanteMemberIds.includes(m.id)}
                    onChange={() => setAyudanteMemberIds(prev => toggleId(prev, m.id))}
                    style={{ accentColor: colors.primary }}
                  />
                  <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{m.name}</span>
                </label>
              ))}
              {ayudanteMembers.length === 0 && <span style={labelStyle}>sin ayudantes en el equipo</span>}
            </div>
          </div>

          {/* EMPRESA (residual) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderTop: `1px solid ${colors.border}`, paddingTop: '8px' }}>
            <span style={{ ...labelStyle, minWidth: '80px' }}>EMPRESA</span>
            <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.06em' }}>(residual)</span>
            <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginLeft: 'auto' }}>
              {fmtMXN(waterfall.scenarios.sin_bono.companyResidual)}
            </span>
          </div>
        </div>
      </div>

      {/* ── POR PERSONA ──────────────────────────────────────────────────────── */}
      {waterfall.scenarios.sin_bono.splits.length > 0 && (
        <div>
          {sectionDivider('POR PERSONA')}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...labelStyle, textAlign: 'left', padding: '3px 0', borderBottom: `1px solid ${colors.border}` }}>
                    NOMBRE
                  </th>
                  {(['sin_bono', 'bono_25', 'bono_50'] as const).map(key => {
                    const tierValue = key === 'sin_bono' ? 0 : key === 'bono_25' ? 0.25 : 0.50
                    const isActive = waterfall.activeTier === tierValue
                    const label = key === 'sin_bono' ? 'Sin bono' : key === 'bono_25' ? 'Bono 25%' : 'Bono 50%'
                    return (
                      <th key={key} style={{
                        ...labelStyle,
                        textAlign: 'right',
                        padding: '3px 4px',
                        borderBottom: `1px solid ${colors.border}`,
                        color: isActive ? colors.primary : colors.secondary,
                        fontWeight: isActive ? 700 : undefined,
                      }}>
                        {label}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {waterfall.scenarios.sin_bono.splits.map((split, idx) => (
                  <tr key={`${split.label}-${split.id ?? 'anon'}-${idx}`} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={{ padding: '5px 0' }}>
                      <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{split.name ?? '—'}</div>
                      <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>{split.label.toUpperCase()}</div>
                    </td>
                    {(['sin_bono', 'bono_25', 'bono_50'] as const).map(key => {
                      const tierValue = key === 'sin_bono' ? 0 : key === 'bono_25' ? 0.25 : 0.50
                      const isActive = waterfall.activeTier === tierValue
                      const amount = waterfall.scenarios[key].splits[idx]?.total ?? 0
                      return (
                        <td key={key} style={{
                          padding: '5px 4px',
                          textAlign: 'right',
                          fontFamily: fonts.sans,
                          fontSize: '11px',
                          color: colors.neutral,
                          fontWeight: isActive ? 600 : undefined,
                        }}>
                          {fmtMXN(amount)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {/* Empresa row */}
                <tr style={{ borderTop: `1px solid ${colors.border}` }}>
                  <td style={{ padding: '5px 0', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.08em' }}>
                    EMPRESA
                  </td>
                  {(['sin_bono', 'bono_25', 'bono_50'] as const).map(key => {
                    const tierValue = key === 'sin_bono' ? 0 : key === 'bono_25' ? 0.25 : 0.50
                    const isActive = waterfall.activeTier === tierValue
                    return (
                      <td key={key} style={{
                        padding: '5px 4px',
                        textAlign: 'right',
                        fontFamily: fonts.sans,
                        fontSize: '11px',
                        color: colors.secondary,
                        fontWeight: isActive ? 600 : undefined,
                      }}>
                        {fmtMXN(waterfall.scenarios[key].companyResidual)}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Save ─────────────────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            background: saving ? colors.border : colors.primary,
            border: 'none',
            color: colors.neutral,
            cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: fonts.label,
            fontSize: '10px',
            letterSpacing: '0.08em',
            padding: '8px 20px',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'GUARDANDO…' : 'GUARDAR'}
        </button>
        {saveError && (
          <div style={{ fontFamily: fonts.label, fontSize: '9px', color: '#e55', letterSpacing: '0.06em', marginTop: '6px' }}>
            {saveError}
          </div>
        )}
      </div>
    </div>
  )
}
