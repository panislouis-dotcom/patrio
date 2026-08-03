import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'
import { fmtMXN, fmtPct } from '../lib/fmt'
import { fetchAnalysis, fetchComparables } from '../lib/api'
import type { AnalysisSnapshot, Comparable } from '../lib/types'

const cardStyle: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  padding: '20px',
  marginBottom: '16px',
}

const cardTitleStyle: React.CSSProperties = {
  fontFamily: fonts.label,
  fontSize: '9px',
  letterSpacing: '0.12em',
  color: colors.secondary,
  textTransform: 'uppercase',
  marginBottom: '14px',
}

function Row({ label, value, highlight, warn }: {
  label: string
  value: React.ReactNode
  highlight?: boolean
  warn?: boolean
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '6px 0',
      borderBottom: `1px solid ${colors.border}`,
    }}>
      <span style={{
        fontFamily: fonts.label,
        fontSize: '9px',
        letterSpacing: '0.08em',
        color: colors.secondary,
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: fonts.sans,
        fontSize: highlight ? '14px' : '12px',
        color: warn ? colors.tertiary : highlight ? colors.primary : colors.neutral,
        fontWeight: highlight ? 600 : 400,
      }}>
        {value}
      </span>
    </div>
  )
}

/**
 * Una fracción como porcentaje. `fmtPct` traduce 0 a "—", y aquí un supuesto de
 * 0% es una decisión (sin financiamiento, sin castigo) que hay que poder leer;
 * lo que de verdad falta es null, y solo eso se muestra en blanco.
 */
function fmtRatePct(fraction: number | null | undefined): string {
  return fraction == null ? '—' : `${(fraction * 100).toFixed(1)}%`
}

const thStyle: React.CSSProperties = {
  padding: '5px 10px',
  fontFamily: fonts.label,
  fontSize: '9px',
  color: colors.secondary,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '5px 10px',
  fontFamily: fonts.sans,
  fontSize: '12px',
  whiteSpace: 'nowrap',
  color: colors.neutral,
}

// Sensitivity matrix: ROI at different exit price and remodel cost multiples
function SensitivityMatrix({ snap }: { snap: AnalysisSnapshot }) {
  const exitMultipliers = [0.85, 0.90, 1.00, 1.10, 1.15]
  const remodelMultipliers = [0.80, 0.90, 1.00, 1.10, 1.20]

  const holdMonths = snap.holdingPeriodMonths ?? 12

  function sensitivityROI(exitMult: number, remodelMult: number): number | null {
    const exit = snap.exitPriceUsed * exitMult
    const remodel = snap.remodelCostEstimate * remodelMult
    const total = snap.purchasePrice + remodel + snap.transactionCosts + (snap.financingCosts ?? 0)
    if (total <= 0 || exit <= 0) return null
    return (Math.pow(exit / total, 12 / holdMonths) - 1) * 100
  }

  function roiColor(roi: number | null): string {
    if (roi == null) return colors.border
    if (roi >= 20) return colors.primary + '33'
    if (roi >= 10) return colors.tertiary + '33'
    return '#c0392b33'
  }

  function roiTextColor(roi: number | null): string {
    if (roi == null) return colors.secondary
    if (roi >= 20) return colors.primary
    if (roi >= 10) return colors.tertiary
    return '#c0392b'
  }

  if (snap.exitPriceUsed <= 0 || snap.purchasePrice <= 0) return null

  return (
    <div style={{ border: `1px solid ${colors.border}`, padding: '20px', marginBottom: '16px' }}>
      <div style={{
        fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em',
        color: colors.secondary, textTransform: 'uppercase', marginBottom: '8px',
      }}>
        MATRIZ DE SENSIBILIDAD — ROI ANUAL FLIP
      </div>
      <div style={{ fontFamily: fonts.sans, fontSize: '10px', color: colors.secondary, marginBottom: '12px' }}>
        Filas: precio de salida · Columnas: costo de remodelación
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: '400px' }}>
          <thead>
            <tr>
              <th style={{ padding: '4px 8px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, textAlign: 'right' }}>
                SALIDA / REMO
              </th>
              {remodelMultipliers.map(m => (
                <th key={m} style={{ padding: '4px 8px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, textAlign: 'center' }}>
                  {m === 1.0 ? 'BASE' : `${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exitMultipliers.map(exitM => (
              <tr key={exitM}>
                <td style={{ padding: '4px 8px', fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {exitM === 1.0 ? 'BASE' : `${exitM >= 1 ? '+' : ''}${Math.round((exitM - 1) * 100)}%`}
                </td>
                {remodelMultipliers.map(remoM => {
                  const roi = sensitivityROI(exitM, remoM)
                  return (
                    <td key={remoM} style={{
                      padding: '5px 10px',
                      textAlign: 'center',
                      background: roiColor(roi),
                      fontFamily: fonts.sans,
                      fontSize: '11px',
                      color: roiTextColor(roi),
                      border: exitM === 1.0 && remoM === 1.0 ? `1px solid ${colors.border}` : 'none',
                      fontWeight: exitM === 1.0 && remoM === 1.0 ? 600 : 400,
                    }}>
                      {roi != null ? `${roi.toFixed(1)}%` : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function AnalysisView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [snap, setSnap] = useState<AnalysisSnapshot | null>(null)
  const [comps, setComps] = useState<Comparable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      try {
        const s = await fetchAnalysis(Number(id))
        if (cancelled) return
        setSnap(s)
        if (s.comparableIds && s.comparableIds.length > 0) {
          const all = await fetchComparables()
          if (cancelled) return
          const idSet = new Set(s.comparableIds)
          setComps(all.filter(c => idSet.has(c.id)))
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error al cargar análisis')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return <div style={{ padding: '32px', color: colors.secondary, fontFamily: fonts.sans }}>Cargando análisis...</div>
  }
  if (error || !snap) {
    return <div style={{ padding: '32px', color: '#E62300', fontFamily: fonts.sans }}>{error ?? 'No encontrado'}</div>
  }

  const showBuildHold = (snap.rentaMensualEstimada ?? 0) > 0
  const showMarketRange = snap.exitPriceCalculatedMid != null
  const confColor = snap.confidenceScore >= 70 ? colors.primary
    : snap.confidenceScore >= 40 ? colors.tertiary
      : '#c0392b'

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px', gap: '16px' }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none',
            border: 'none',
            color: colors.secondary,
            cursor: 'pointer',
            fontFamily: fonts.label,
            fontSize: '11px',
            letterSpacing: '0.1em',
            padding: 0,
          }}
        >
          ← VOLVER
        </button>
        <span style={{ color: colors.border }}>·</span>
        <span style={{ fontFamily: fonts.serif, fontSize: '22px', color: colors.neutral }}>
          Análisis #{snap.id}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.1em' }}>
          {new Date(snap.generatedAt).toLocaleString('es-MX')}
        </span>
      </div>

      {/* INPUTS */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>INPUTS</div>
        <Row label="PRECIO COMPRA" value={fmtMXN(snap.purchasePrice)} />
        <Row label="NIVEL INTERVENCIÓN" value={snap.interventionLevel} />
        <Row label="COSTO REMODELACIÓN" value={fmtMXN(snap.remodelCostEstimate)} />
        <Row label="REMODELACIÓN $/M²" value={snap.remodelCostPerM2.toLocaleString('es-MX')} />
        <Row label="COSTOS TRANSACCIÓN" value={fmtMXN(snap.transactionCosts)} />
        <Row label="COSTOS FINANCIAMIENTO" value={fmtMXN(snap.financingCosts)} />
        <Row label="COSTO TOTAL" value={fmtMXN(snap.totalCost)} highlight />
        <Row label="PLAZO (MESES)" value={snap.holdingPeriodMonths} />
      </div>

      {/* SUPUESTOS — con qué se calculó lo de abajo.
          Sin ellos, NPV, IRR y CASH ON CASH se publican como resultados de un
          modelo cuyos parámetros nadie puede auditar. Las corridas anteriores a
          que se guardaran muestran "—" en vez de inventarles un valor. */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>SUPUESTOS</div>
        <Row label="COSTOS TRANSACCIÓN" value={fmtRatePct(snap.transactionCostPct)} />
        <Row label="CASTIGO ANUNCIO→VENTA" value={fmtRatePct(snap.listingHaircut)} />
        <Row label="TASA DE DESCUENTO (NPV)" value={fmtRatePct(snap.discountRate)} />
        <Row label="FINANCIAMIENTO" value={fmtRatePct(snap.financiamientoPct)} />
        <Row label="TASA CRÉDITO" value={fmtRatePct(snap.tasaInteresCredito)} />
        <Row label="PLAZO CRÉDITO (MESES)" value={snap.plazoCreditoMeses ?? '—'} />
        <Row label="GASTOS OPERATIVOS" value={fmtRatePct(snap.gastosOperativosPct)} />
      </div>

      {/* FLIP RESULTS */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>FLIP RESULTS</div>
        <Row label="FUENTE PRECIO SALIDA" value={snap.exitPriceSource} />
        {snap.exitPriceManual != null && (
          <Row label="PRECIO SALIDA MANUAL" value={fmtMXN(snap.exitPriceManual)} />
        )}
        {showMarketRange && (
          <>
            {/* Sin `?? 0`: un precio de mercado que no se pudo calcular es una
                ausencia, y con la regla «cero es cero» ese cero fabricado se
                imprimiría como un precio de mercado de cero pesos. */}
            <Row label="PRECIO MERCADO BAJO" value={fmtMXN(snap.exitPriceCalculatedLow)} />
            <Row label="PRECIO MERCADO MEDIO" value={fmtMXN(snap.exitPriceCalculatedMid)} />
            <Row label="PRECIO MERCADO ALTO" value={fmtMXN(snap.exitPriceCalculatedHigh)} />
          </>
        )}
        <Row label="PRECIO SALIDA USADO" value={fmtMXN(snap.exitPriceUsed)} highlight />
        {snap.manualVsMarketDeltaPct != null && (
          <Row
            label="DELTA MANUAL VS MERCADO"
            value={`${snap.manualVsMarketDeltaPct.toFixed(1)}%`}
            warn={Math.abs(snap.manualVsMarketDeltaPct) > 20}
          />
        )}
        <Row label="MARGEN BRUTO" value={snap.grossMargin != null ? fmtMXN(snap.grossMargin) : '—'} />
        <Row
          label="ROI ANUAL"
          value={snap.roiPct != null ? fmtPct(snap.roiPct / 100) : '—'}
          highlight
        />
        <Row label="IRR" value={snap.irrPct != null ? `${snap.irrPct.toFixed(1)}%` : '—'} />
        <Row label="CAP RATE" value={snap.capRatePct != null ? `${snap.capRatePct.toFixed(1)}%` : '—'} />
      </div>

      {/* BUILD & HOLD */}
      {showBuildHold && (
        <div style={cardStyle}>
          <div style={cardTitleStyle}>BUILD & HOLD</div>
          <Row label="NOI ANUAL" value={snap.noiAnual != null ? fmtMXN(snap.noiAnual) : '—'} />
          <Row label="SERVICIO DEUDA ANUAL" value={snap.debtServiceAnual != null ? fmtMXN(snap.debtServiceAnual) : '—'} />
          <Row label="CASH FLOW ANUAL" value={snap.cashFlowAnual != null ? fmtMXN(snap.cashFlowAnual) : '—'} highlight />
          <Row label="CASH ON CASH YR1" value={snap.cashOnCashYr1Pct != null ? `${snap.cashOnCashYr1Pct.toFixed(1)}%` : '—'} />
          <Row label="BREAK EVEN (MESES)" value={snap.breakEvenMonths ?? '—'} />
          <Row label="NPV 10 AÑOS" value={snap.npv10Yr != null ? fmtMXN(snap.npv10Yr) : '—'} />
          <Row label="IRR 10 AÑOS" value={snap.irr10YrPct != null ? `${snap.irr10YrPct.toFixed(1)}%` : '—'} />
        </div>
      )}

      {/* CONFIDENCE */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>CONFIDENCE</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', marginBottom: '14px' }}>
          <div style={{ fontFamily: fonts.serif, fontSize: '48px', color: confColor, lineHeight: 1 }}>
            {snap.confidenceScore}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ height: '4px', background: colors.border, borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, Math.max(0, snap.confidenceScore))}%`,
                background: confColor,
                transition: 'width 0.6s ease',
              }} />
            </div>
          </div>
        </div>
        <Row label="COMPARABLES USADOS" value={snap.comparableCount} />
        {snap.avgCompDistanceKm != null && (
          <Row label="DISTANCIA PROM. COMPS" value={`${snap.avgCompDistanceKm.toFixed(2)} km`} />
        )}
        {snap.confidenceNotes && (
          <div style={{ marginTop: '12px', fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, lineHeight: 1.6 }}>
            {snap.confidenceNotes}
          </div>
        )}
        {snap.dataQualityWarnings && snap.dataQualityWarnings.length > 0 && (
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {snap.dataQualityWarnings.map((w, i) => (
              <div key={i} style={{
                padding: '6px 10px',
                background: colors.surfaceAlt,
                border: `1px solid ${colors.tertiary}55`,
                fontFamily: fonts.sans,
                fontSize: '11px',
                color: colors.neutral,
              }}>
                ⚠ {w}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* COMPARABLES TABLE */}
      {comps.length > 0 && (
        <div style={cardStyle}>
          <div style={cardTitleStyle}>COMPARABLES</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <th style={thStyle}>DIRECCIÓN</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>M²</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>PRECIO</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>$/M²</th>
                  <th style={thStyle}>TIPO</th>
                </tr>
              </thead>
              <tbody>
                {comps.map(c => (
                  <tr key={c.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <td style={tdStyle}>
                      <a
                        href={c.listingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: colors.accent2, textDecoration: 'underline' }}
                      >
                        {c.address}
                      </a>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{c.m2}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtMXN(c.price)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: colors.tertiary }}>
                      ${Math.round(c.pricePerM2).toLocaleString('es-MX')}
                    </td>
                    <td style={{ ...tdStyle, fontSize: '11px' }}>{c.propertyType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SensitivityMatrix snap={snap} />
    </div>
  )
}
