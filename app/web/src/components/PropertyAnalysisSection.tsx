import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { colors, fonts } from '../lib/theme'
import { runAnalysis, fetchAnalyses } from '../lib/api'
import type { AnalysisSnapshot, AnalysisRequest } from '../lib/types'

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
}

export function PropertyAnalysisSection({ propertyId, canRun }: Props) {
  const navigate = useNavigate()
  const [snapshots, setSnapshots] = useState<AnalysisSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [params, setParams] = useState<Partial<AnalysisRequest>>({
    interventionLevel: 'media',
    holdingPeriodMonths: 12,
    exitPriceSource: 'calculated',
  })

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
      const snap = await runAnalysis({ propertyId, ...params } as AnalysisRequest)
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
                value={params.interventionLevel ?? 'media'}
                onChange={e => setParams(p => ({ ...p, interventionLevel: e.target.value }))}
              >
                <option value="cosmetica">Cosmética</option>
                <option value="media">Media</option>
                <option value="total">Total</option>
                <option value="obra_nueva">Obra nueva</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>PLAZO (MESES)</label>
              <input
                style={inputStyle}
                type="number"
                value={params.holdingPeriodMonths ?? 12}
                onChange={e => setParams(p => ({ ...p, holdingPeriodMonths: Number(e.target.value) }))}
              />
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
