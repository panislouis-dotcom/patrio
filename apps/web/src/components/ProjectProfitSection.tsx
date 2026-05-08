import { useEffect, useState } from 'react'
import { fetchProjectProfit, updateProjectProfit } from '../lib/api'
import type { ProfitSplitConfig, ProfitWaterfall, TeamMember } from '../lib/types'
import { colors, fonts } from '../lib/theme'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

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
  projectId: number
  team: TeamMember[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectProfitSection({ projectId, team }: Props) {
  // server state
  const [config, setConfig] = useState<ProfitSplitConfig | null>(null)
  const [waterfall, setWaterfall] = useState<ProfitWaterfall | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // draft fields
  const [exitPrice, setExitPrice] = useState<string>('')
  const [investorCapital, setInvestorCapital] = useState<string>('')
  const [investorRateAnnual, setInvestorRateAnnual] = useState<string>('12')
  const [investorMonths, setInvestorMonths] = useState<string>('')
  const [isrRate, setIsrRate] = useState<string>('30')
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
  const [plannedEndDate, setPlannedEndDate] = useState<string>('')
  const [actualEndDate, setActualEndDate] = useState<string>('')
  const [bufferDays, setBufferDays] = useState<string>('0')

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    fetchProjectProfit(projectId).then(({ config, waterfall }) => {
      setConfig(config)
      setWaterfall(waterfall)
      setExitPrice(config.exitPrice != null ? String(config.exitPrice) : '')
      setInvestorCapital(config.investorCapital != null ? String(config.investorCapital) : '')
      setInvestorRateAnnual(String((config.investorRateAnnual * 100).toFixed(2)))
      setInvestorMonths(config.investorMonths != null ? String(config.investorMonths) : '')
      setIsrRate(String((config.isrRate * 100).toFixed(0)))
      setFinderFeePct(String((config.finderFeePct * 100).toFixed(2)))
      setDirectorPct(String((config.directorPct * 100).toFixed(2)))
      setResponsablePct(String((config.responsablePct * 100).toFixed(2)))
      setLiderPct(String((config.liderPct * 100).toFixed(2)))
      setMaestroPct(String((config.maestroPct * 100).toFixed(2)))
      setAyudantePct(String((config.ayudantePct * 100).toFixed(2)))
      setFinderMemberId(config.finderMemberId != null ? String(config.finderMemberId) : '')
      setResponsableMemberId(config.responsableMemberId != null ? String(config.responsableMemberId) : '')
      setLiderMemberId(config.liderMemberId != null ? String(config.liderMemberId) : '')
      setMaestroMemberIds(config.maestroMemberIds)
      setAyudanteMemberIds(config.ayudanteMemberIds)
      setPlannedEndDate(config.plannedEndDate ?? '')
      setActualEndDate(config.actualEndDate ?? '')
      setBufferDays(String(config.bufferDays ?? 0))
      setLoading(false)
    }).catch((err: unknown) => {
      setFetchError(err instanceof Error ? err.message : 'Error al cargar datos')
      setLoading(false)
    })
  }, [projectId])

  async function handleSave() {
    setSaving(true)
    try {
      const draft: Partial<ProfitSplitConfig> = {
        exitPrice: exitPrice ? Number(exitPrice) : null,
        investorCapital: investorCapital ? Number(investorCapital) : null,
        investorRateAnnual: Number(investorRateAnnual) / 100,
        investorMonths: investorMonths ? Number(investorMonths) : null,
        isrRate: Number(isrRate) / 100,
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
        plannedEndDate: plannedEndDate || null,
        actualEndDate: actualEndDate || null,
        bufferDays: Number(bufferDays),
      }
      const result = await updateProjectProfit(projectId, draft)
      setConfig(result.config)
      setWaterfall(result.waterfall)
      setSaveError(null)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // ─── Derived helpers (safe after loading) ──────────────────────────────────

  function splitTotal(label: string): number {
    if (!waterfall) return 0
    return waterfall.splits.filter(s => s.label === label).reduce((sum, s) => sum + s.total, 0)
  }

  // ─── Loading ───────────────────────────────────────────────────────────────

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

  // ─── Bonus badge ───────────────────────────────────────────────────────────

  const bonusTier = waterfall.bonusTier ?? 0
  const bonusBg = bonusTier >= 0.5 ? colors.primary : bonusTier >= 0.25 ? colors.tertiary : 'transparent'
  const bonusBorder = bonusTier === 0 ? colors.border : bonusBg
  const bonusColor = bonusTier === 0 ? colors.secondary : colors.neutral
  const bonusLabel = bonusTier >= 0.5 ? '50% BONO' : bonusTier >= 0.25 ? '25% BONO' : 'SIN BONO'

  // ─── Role-filtered member lists ────────────────────────────────────────────

  const responsableMembers = team.filter(m => m.role === 'responsable_proyecto')
  const liderMembers = team.filter(m => m.role === 'lider_proyecto')
  const maestroMembers = team.filter(m => m.role === 'maestro')
  const ayudanteMembers = team.filter(m => m.role === 'ayudante')

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '0', display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── Section 1: CASCADA DE UTILIDAD ─────────────────────────────────── */}
      <div>
        {sectionDivider('CASCADA DE UTILIDAD')}

        {/* Exit price — editable */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', gap: '8px' }}>
          <span style={labelStyle}>PRECIO DE SALIDA</span>
          <input
            type="number"
            value={exitPrice}
            onChange={e => setExitPrice(e.target.value)}
            placeholder="Precio de salida"
            style={{ ...inputStyle, width: '130px', textAlign: 'right' }}
          />
        </div>

        {/* Investment — read-only */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
          <span style={labelStyle}>− INVERSIÓN TOTAL</span>
          <span style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>{fmt(waterfall.investment)}</span>
        </div>

        {/* Gross profit — computed */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
          <span style={labelStyle}>= UTILIDAD BRUTA</span>
          <span style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>{fmt(waterfall.grossProfit)}</span>
        </div>

        {/* Investor cuota */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
          <span style={labelStyle}>− CUOTA INVERSIONISTA</span>
          <span style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>{fmt(waterfall.investorCuota)}</span>
        </div>

        {/* Investor sub-inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginLeft: '8px', marginBottom: '4px' }}>
          <div>
            <div style={{ ...labelStyle, marginBottom: '3px' }}>CAPITAL</div>
            <input
              type="number"
              value={investorCapital}
              onChange={e => setInvestorCapital(e.target.value)}
              placeholder="Capital"
              style={inputStyle}
            />
          </div>
          <div>
            <div style={{ ...labelStyle, marginBottom: '3px' }}>TASA ANUAL %</div>
            <input
              type="number"
              value={investorRateAnnual}
              onChange={e => setInvestorRateAnnual(e.target.value)}
              placeholder="12.00"
              step="0.01"
              style={inputStyle}
            />
          </div>
          <div>
            <div style={{ ...labelStyle, marginBottom: '3px' }}>MESES</div>
            <input
              type="number"
              value={investorMonths}
              onChange={e => setInvestorMonths(e.target.value)}
              placeholder="Meses"
              style={inputStyle}
            />
          </div>
        </div>

        {/* ISR */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
          <span style={labelStyle}>− ISR</span>
          <span style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>{fmt(waterfall.isr)}</span>
        </div>

        {/* ISR rate sub-input */}
        <div style={{ marginLeft: '8px', marginBottom: '4px', width: '80px' }}>
          <div style={{ ...labelStyle, marginBottom: '3px' }}>ISR %</div>
          <input
            type="number"
            value={isrRate}
            onChange={e => setIsrRate(e.target.value)}
            placeholder="30"
            step="1"
            style={inputStyle}
          />
        </div>

        {/* Net profit — highlighted */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          padding: '5px 0', borderTop: `1px solid ${colors.border}`, marginTop: '4px',
        }}>
          <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.primary, letterSpacing: '0.10em' }}>= UTILIDAD NETA</span>
          <span style={{ fontFamily: fonts.sans, fontSize: '14px', color: colors.primary, fontWeight: 600 }}>{fmt(waterfall.netProfit)}</span>
        </div>

        {/* Distributable */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
          <span style={labelStyle}>= DISTRIBUIBLE</span>
          <span style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral }}>{fmt(waterfall.distributable)}</span>
        </div>
      </div>

      {/* ── Section 2: COLCHÓN Y BONO ──────────────────────────────────────── */}
      <div>
        {sectionDivider('COLCHÓN Y BONO')}

        {/* Row 1: planned end + buffer */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '8px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...labelStyle, marginBottom: '3px' }}>FIN PLANEADO</div>
            <input
              type="date"
              value={plannedEndDate}
              onChange={e => setPlannedEndDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ width: '70px' }}>
            <div style={{ ...labelStyle, marginBottom: '3px' }}>BUFFER DÍAS</div>
            <input
              type="number"
              value={bufferDays}
              onChange={e => setBufferDays(e.target.value)}
              placeholder="0"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Row 2: actual end */}
        <div style={{ marginBottom: '10px' }}>
          <div style={{ ...labelStyle, marginBottom: '3px' }}>FIN REAL</div>
          <input
            type="date"
            value={actualEndDate}
            onChange={e => setActualEndDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Row 3: bonus badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={labelStyle}>BONO ACTUAL</span>
          <span style={{
            background: bonusBg,
            border: `1px solid ${bonusBorder}`,
            color: bonusColor,
            fontFamily: fonts.label,
            fontSize: '9px',
            letterSpacing: '0.10em',
            padding: '3px 8px',
          }}>
            {bonusLabel}
          </span>
        </div>
      </div>

      {/* ── Section 3: SPLIT DEL EQUIPO ────────────────────────────────────── */}
      <div>
        {sectionDivider('SPLIT DEL EQUIPO')}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

          {/* FINDER */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <span style={{ ...labelStyle, minWidth: '80px' }}>FINDER</span>
              <input
                type="number"
                value={finderFeePct}
                onChange={e => setFinderFeePct(e.target.value)}
                step="0.01"
                style={{ ...inputStyle, width: '60px', textAlign: 'right' }}
              />
              <span style={{ ...labelStyle }}>%</span>
              <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginLeft: 'auto' }}>
                {fmt(splitTotal('Finder'))}
              </span>
            </div>
            <select
              value={finderMemberId}
              onChange={e => setFinderMemberId(e.target.value)}
              style={selectStyle}
            >
              <option value="">— sin asignar —</option>
              {team.map(m => (
                <option key={m.id} value={String(m.id)}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* DIRECTORES */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ ...labelStyle, minWidth: '80px' }}>DIRECTORES</span>
            <input
              type="number"
              value={directorPct}
              onChange={e => setDirectorPct(e.target.value)}
              step="0.01"
              style={{ ...inputStyle, width: '60px', textAlign: 'right' }}
            />
            <span style={{ ...labelStyle }}>%</span>
            <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginLeft: 'auto' }}>
              {fmt(splitTotal('Director'))}
            </span>
          </div>

          {/* RESPONSABLE */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <span style={{ ...labelStyle, minWidth: '80px' }}>RESPONSABLE</span>
              <input
                type="number"
                value={responsablePct}
                onChange={e => setResponsablePct(e.target.value)}
                step="0.01"
                style={{ ...inputStyle, width: '60px', textAlign: 'right' }}
              />
              <span style={{ ...labelStyle }}>%</span>
              <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginLeft: 'auto' }}>
                {fmt(splitTotal('Responsable'))}
              </span>
            </div>
            <select
              value={responsableMemberId}
              onChange={e => setResponsableMemberId(e.target.value)}
              style={selectStyle}
            >
              <option value="">— sin asignar —</option>
              {responsableMembers.map(m => (
                <option key={m.id} value={String(m.id)}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* LÍDER */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <span style={{ ...labelStyle, minWidth: '80px' }}>LÍDER</span>
              <input
                type="number"
                value={liderPct}
                onChange={e => setLiderPct(e.target.value)}
                step="0.01"
                style={{ ...inputStyle, width: '60px', textAlign: 'right' }}
              />
              <span style={{ ...labelStyle }}>%</span>
              <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginLeft: 'auto' }}>
                {fmt(splitTotal('Líder'))}
              </span>
            </div>
            <select
              value={liderMemberId}
              onChange={e => setLiderMemberId(e.target.value)}
              style={selectStyle}
            >
              <option value="">— sin asignar —</option>
              {liderMembers.map(m => (
                <option key={m.id} value={String(m.id)}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* MAESTROS */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <span style={{ ...labelStyle, minWidth: '80px' }}>MAESTROS</span>
              <input
                type="number"
                value={maestroPct}
                onChange={e => setMaestroPct(e.target.value)}
                step="0.01"
                style={{ ...inputStyle, width: '60px', textAlign: 'right' }}
              />
              <span style={{ ...labelStyle }}>%</span>
              <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginLeft: 'auto' }}>
                {fmt(splitTotal('Maestro'))}
              </span>
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
              {maestroMembers.length === 0 && (
                <span style={{ ...labelStyle }}>sin maestros en el equipo</span>
              )}
            </div>
          </div>

          {/* AYUDANTES */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <span style={{ ...labelStyle, minWidth: '80px' }}>AYUDANTES</span>
              <input
                type="number"
                value={ayudantePct}
                onChange={e => setAyudantePct(e.target.value)}
                step="0.01"
                style={{ ...inputStyle, width: '60px', textAlign: 'right' }}
              />
              <span style={{ ...labelStyle }}>%</span>
              <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginLeft: 'auto' }}>
                {fmt(splitTotal('Ayudante'))}
              </span>
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
              {ayudanteMembers.length === 0 && (
                <span style={{ ...labelStyle }}>sin ayudantes en el equipo</span>
              )}
            </div>
          </div>

          {/* EMPRESA (residual) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderTop: `1px solid ${colors.border}`, paddingTop: '8px' }}>
            <span style={{ ...labelStyle, minWidth: '80px' }}>EMPRESA</span>
            <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.06em' }}>(residual)</span>
            <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginLeft: 'auto' }}>
              {fmt(waterfall.companyResidual)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Section 4: POR PERSONA ─────────────────────────────────────────── */}
      <div>
        {sectionDivider('POR PERSONA')}

        {waterfall.splits.length === 0 ? (
          <span style={labelStyle}>sin distribución calculada</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {/* Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto auto',
              gap: '8px',
              padding: '3px 0',
              borderBottom: `1px solid ${colors.border}`,
              marginBottom: '4px',
            }}>
              <span style={labelStyle}>NOMBRE</span>
              <span style={{ ...labelStyle, textAlign: 'right' }}>BASE</span>
              <span style={{ ...labelStyle, textAlign: 'right' }}>BONO</span>
              <span style={{ ...labelStyle, textAlign: 'right' }}>TOTAL</span>
            </div>

            {/* Rows */}
            {waterfall.splits.map(split => (
              <div key={`${split.label}-${split.id}`} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                gap: '8px',
                padding: '3px 0',
                borderBottom: `1px solid ${colors.border}`,
              }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{split.name}</span>
                  <span style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>
                    {split.label.toUpperCase()}
                  </span>
                </div>
                <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, textAlign: 'right', alignSelf: 'center' }}>
                  {fmt(split.base)}
                </span>
                <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, textAlign: 'right', alignSelf: 'center' }}>
                  {fmt(split.bonus)}
                </span>
                <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, textAlign: 'right', alignSelf: 'center', fontWeight: 600 }}>
                  {fmt(split.total)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Save button ────────────────────────────────────────────────────── */}
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
            marginTop: '16px',
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
