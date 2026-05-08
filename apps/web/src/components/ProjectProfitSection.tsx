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
  conclusionDate: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectProfitSection({ projectId, team, conclusionDate }: Props) {
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
  const [plannedEndDate, setPlannedEndDate] = useState<string>('')
  const [bufferDays, setBufferDays] = useState<string>('0')

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    fetchProjectProfit(projectId).then(({ config, waterfall }) => {
      setConfig(config)
      setWaterfall(waterfall)
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
      setPlannedEndDate(config.plannedEndDate ?? '')
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
        plannedEndDate: plannedEndDate || null,
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
              {fmt(waterfall.scenarios.sin_bono.companyResidual)}
            </span>
          </div>
        </div>
      </div>

      {/* ── COLCHÓN ─────────────────────────────────────────────────────────── */}
      <div>
        {sectionDivider('COLCHÓN')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...labelStyle, marginBottom: '3px' }}>FIN PLANEADO</div>
              <input
                type="text"
                value={plannedEndDate}
                onChange={e => setPlannedEndDate(e.target.value)}
                placeholder="YYYY-MM"
                style={inputStyle}
              />
            </div>
            <div style={{ width: '80px' }}>
              <div style={{ ...labelStyle, marginBottom: '3px' }}>COLCHÓN (días)</div>
              <input
                type="number"
                value={bufferDays}
                onChange={e => setBufferDays(e.target.value)}
                min="0"
                step="1"
                style={{ ...inputStyle, textAlign: 'right' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={labelStyle}>FIN REAL</span>
            <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>
              {conclusionDate ?? '—'}
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
                          {fmt(amount)}
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
                        {fmt(waterfall.scenarios[key].companyResidual)}
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
