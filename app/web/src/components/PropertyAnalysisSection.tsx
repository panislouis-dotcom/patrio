import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'
import { runAnalysis, fetchAnalyses } from '../lib/api'
import { ANALYSIS_DEFAULTS } from '../lib/types'
import type { AnalysisSnapshot, AnalysisRequest, Assumption } from '../lib/types'

const inputStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  color: colors.neutral,
  fontFamily: fonts.sans,
  fontSize: '11px',
  padding: '4px 7px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontFamily: fonts.label,
  fontSize: '8px',
  letterSpacing: '0.1em',
  color: colors.secondary,
  marginBottom: '2px',
  display: 'block',
}

interface Props {
  propertyId: number
  /**
   * El analizador valora una compra, así que deja de aplicar cuando la
   * propiedad ya renta o ya se vendió. El historial, en cambio, se consulta
   * siempre: es la hipótesis contra la que se mide lo que pasó.
   */
  canRun: boolean
  /** El plazo proyectado de la propiedad, con su procedencia. */
  holdMonths?: Assumption | null
  /** Qué es el inmueble y cuántos metros de obra a ejecutar tiene capturados.
   *  Son hechos de la propiedad; con ellos el formulario PROPONE un escenario
   *  inicial, sin decidir nada. */
  assetType?: string | null
  sqmConstruction?: number | null
}

/** Un supuesto que se teclea en porcentaje y viaja como fracción. */
const asPct = (fraction: number) => String(Math.round(fraction * 1000) / 10)

/**
 * El escenario con el que ABRE el formulario. Es un default de interfaz, no una
 * regla del dominio: se ve en el selector antes de correr nada, se cambia con un
 * clic, y el servidor no lo infiere — el analizador corre exactamente el nivel
 * de intervención que el formulario le mande.
 *
 * La distinción importa porque esta misma comodidad vivía antes en el servidor
 * como inferencia silenciosa (`sqm_construction == 0` → obra nueva sobre todo el
 * terreno) y convertía un trato de 20% de ROI en uno de 7% sin que nadie
 * eligiera. Un lote sin obra capturada casi siempre se valora construyendo, así
 * que proponerlo ahorra un paso; proponerlo en silencio era el problema.
 */
export function initialIntervention(assetType?: string | null,
                                    sqmConstruction?: number | null): string {
  const sinObraCapturada = !sqmConstruction || sqmConstruction <= 0
  return assetType === 'lote' && sinObraCapturada ? 'obra_nueva' : 'media'
}

export function PropertyAnalysisSection({ propertyId, canRun, holdMonths,
                                          assetType, sqmConstruction }: Props) {
  const navigate = useNavigate()
  const [snapshots, setSnapshots] = useState<AnalysisSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showAssumptions, setShowAssumptions] = useState(false)

  // El plazo arranca en el que la propiedad ya tiene proyectado. Arrancar
  // siempre en 12 obligaba a recapturar un dato que el sistema ya conocía, y
  // corría el modelo sobre un horizonte que nadie eligió.
  // `interventionLevel` empieza ausente a propósito: ausente = el usuario no ha
  // elegido, y entonces manda la propuesta. Derivarlo en vez de sincronizarlo
  // con un efecto evita que un prop que llegue tarde pise una elección ya hecha.
  const [params, setParams] = useState<Partial<AnalysisRequest>>({
    holdingPeriodMonths: holdMonths?.value ?? 12,
    exitPriceSource: 'calculated',
    ...ANALYSIS_DEFAULTS,
  })

  const proposedIntervention = initialIntervention(assetType, sqmConstruction)
  const interventionLevel = params.interventionLevel ?? proposedIntervention
  const interventionIsProposed = params.interventionLevel == null
    && proposedIntervention === 'obra_nueva'

  const holdMonthsValue = holdMonths?.value
  useEffect(() => {
    if (holdMonthsValue != null) {
      setParams(p => ({ ...p, holdingPeriodMonths: holdMonthsValue }))
    }
  }, [holdMonthsValue])

  useEffect(() => {
    fetchAnalyses(propertyId)
      .then(setSnapshots)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [propertyId])

  async function handleRun() {
    setRunning(true)
    setError(null)
    try {
      const snap = await runAnalysis(
        { propertyId, ...params, interventionLevel } as AnalysisRequest)
      setSnapshots(prev => [snap, ...prev])
      setShowForm(false)
      navigate(`/analyses/${snap.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al correr análisis')
    } finally {
      setRunning(false)
    }
  }

  const confidenceColor = (score: number) =>
    score >= 70 ? colors.primary : score >= 40 ? colors.tertiary : '#c0392b'

  return (
    <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: `1px solid ${colors.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary }}>
          ANÁLISIS
        </div>
        {canRun && <button
          onClick={() => setShowForm(s => !s)}
          style={{
            background: showForm ? 'transparent' : colors.primary,
            border: showForm ? `1px solid ${colors.border}` : 'none',
            color: showForm ? colors.secondary : colors.neutral,
            fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em',
            padding: '5px 14px', cursor: 'pointer',
          }}
        >
          {showForm ? 'CANCELAR' : 'CORRER ANÁLISIS'}
        </button>}
      </div>

      {showForm && canRun && (
        <div style={{ border: `1px solid ${colors.border}`, padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>INTERVENCIÓN</label>
              <select
                style={inputStyle}
                aria-label="INTERVENCIÓN"
                value={interventionLevel}
                onChange={e => setParams(p => ({ ...p, interventionLevel: e.target.value }))}
              >
                <option value="cosmetica">Cosmética</option>
                <option value="media">Media</option>
                <option value="total">Total</option>
                <option value="obra_nueva">Obra nueva</option>
              </select>
              {interventionIsProposed && (
                <div style={{ fontFamily: fonts.sans, fontSize: '9px', color: colors.secondary, marginTop: '2px' }}>
                  propuesto: es un lote sin obra capturada
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>PLAZO (MESES)</label>
              <input
                style={inputStyle}
                type="number"
                aria-label="PLAZO (MESES)"
                value={params.holdingPeriodMonths ?? 12}
                onChange={e => setParams(p => ({ ...p, holdingPeriodMonths: Number(e.target.value) }))}
              />
              <div style={{ fontFamily: fonts.sans, fontSize: '9px', color: colors.secondary, marginTop: '2px' }}>
                {holdMonths?.source === 'captured'
                  ? 'plazo proyectado de la propiedad'
                  : 'supuesto por omisión'}
              </div>
            </div>
            <div>
              <label style={labelStyle}>FUENTE PRECIO</label>
              <select
                style={inputStyle}
                value={params.exitPriceSource ?? 'calculated'}
                onChange={e => setParams(p => ({ ...p, exitPriceSource: e.target.value as AnalysisRequest['exitPriceSource'] }))}
              >
                <option value="calculated">Mercado (comps)</option>
                <option value="manual">Manual</option>
                <option value="blended">Blended</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>RENTA MENSUAL (OPC.)</label>
              <input
                style={inputStyle}
                type="number"
                value={params.rentaMensualEstimada ?? ''}
                onChange={e => setParams(p => ({ ...p, rentaMensualEstimada: e.target.value ? Number(e.target.value) : undefined }))}
                placeholder="Para B&H"
              />
            </div>
            <div>
              <label style={labelStyle}>ARV MANUAL (OPC.)</label>
              <input
                style={inputStyle}
                type="number"
                value={params.arvManualOverride ?? ''}
                onChange={e => setParams(p => ({ ...p, arvManualOverride: e.target.value ? Number(e.target.value) : undefined }))}
                placeholder="Override precio salida"
              />
            </div>
          </div>
          {/* ── SUPUESTOS ────────────────────────────────────────────────────
              Siete números que mueven COSTOS FINANCIAMIENTO, SERVICIO DEUDA,
              CASH ON CASH, NPV e IRR. Estaban escondidos como defaults del
              servidor: la corrida publicaba sus resultados sin que se pudiera
              ver — mucho menos discutir — con qué se calcularon. */}
          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '10px', marginBottom: '12px' }}>
            <button
              onClick={() => setShowAssumptions(s => !s)}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em',
                color: colors.secondary,
              }}
            >
              {showAssumptions ? '▾' : '▸'} SUPUESTOS DEL MODELO
            </button>
            {showAssumptions && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: '10px' }}>
                {([
                  ['COSTOS TRANSACCIÓN %', 'transactionCostPct', true],
                  ['CASTIGO ANUNCIO→VENTA %', 'listingHaircut', true],
                  ['TASA DE DESCUENTO %', 'discountRate', true],
                  ['FINANCIAMIENTO %', 'financiamientoPct', true],
                  ['TASA CRÉDITO %', 'tasaInteresCredito', true],
                  ['GASTOS OPERATIVOS %', 'gastosOperativosPct', true],
                  ['PLAZO CRÉDITO (MESES)', 'plazoCreditoMeses', false],
                ] as [string, keyof typeof ANALYSIS_DEFAULTS, boolean][]).map(([label, key, isPct]) => {
                  const raw = params[key] ?? ANALYSIS_DEFAULTS[key]
                  return (
                    <div key={key}>
                      <label style={labelStyle}>{label}</label>
                      <input
                        style={inputStyle}
                        type="number"
                        step={isPct ? '0.1' : '1'}
                        aria-label={label}
                        value={isPct ? asPct(raw as number) : String(raw)}
                        onChange={e => {
                          const n = Number(e.target.value)
                          setParams(p => ({ ...p, [key]: isPct ? n / 100 : n }))
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            )}
            {!showAssumptions && (
              <div style={{ fontFamily: fonts.sans, fontSize: '10px', color: colors.secondary, marginTop: '4px' }}>
                Transacción {asPct(params.transactionCostPct ?? ANALYSIS_DEFAULTS.transactionCostPct)}% ·
                castigo {asPct(params.listingHaircut ?? ANALYSIS_DEFAULTS.listingHaircut)}% ·
                descuento {asPct(params.discountRate ?? ANALYSIS_DEFAULTS.discountRate)}% ·
                financiamiento {asPct(params.financiamientoPct ?? ANALYSIS_DEFAULTS.financiamientoPct)}% a{' '}
                {asPct(params.tasaInteresCredito ?? ANALYSIS_DEFAULTS.tasaInteresCredito)}% /{' '}
                {params.plazoCreditoMeses ?? ANALYSIS_DEFAULTS.plazoCreditoMeses}m ·
                opex {asPct(params.gastosOperativosPct ?? ANALYSIS_DEFAULTS.gastosOperativosPct)}%
              </div>
            )}
          </div>
          {error && (
            <div style={{ color: '#E62300', fontFamily: fonts.sans, fontSize: '10px', marginBottom: '8px' }}>{error}</div>
          )}
          <button
            onClick={handleRun}
            disabled={running}
            style={{
              background: running ? colors.border : colors.primary,
              border: 'none', color: colors.neutral,
              fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em',
              padding: '6px 16px', cursor: running ? 'not-allowed' : 'pointer',
            }}
          >
            {running ? 'ANALIZANDO...' : 'EJECUTAR'}
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Cargando historial...</div>
      ) : snapshots.length === 0 ? (
        <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Sin análisis previos</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {snapshots.map(s => (
            <div
              key={s.id}
              onClick={() => navigate(`/analyses/${s.id}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 10px', cursor: 'pointer',
                border: `1px solid ${colors.border}`,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = `${colors.border}55`)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary }}>#{s.id}</span>
              <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, flex: 1 }}>
                {s.interventionLevel} · {s.holdingPeriodMonths}m
              </span>
              <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>
                ROI/a {s.roiPct != null ? `${s.roiPct.toFixed(1)}%` : '—'}
              </span>
              <span style={{
                fontFamily: fonts.label, fontSize: '9px',
                color: confidenceColor(s.confidenceScore),
                minWidth: '28px', textAlign: 'right',
              }}>
                {s.confidenceScore}
              </span>
              <span style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.border }}>
                {new Date(s.generatedAt).toLocaleDateString('es-MX')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
