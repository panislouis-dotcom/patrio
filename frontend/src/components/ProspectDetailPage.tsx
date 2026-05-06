import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { fetchProspect } from '../lib/api'
import type { Prospect } from '../lib/types'
import { colors, fonts } from '../lib/theme'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px', borderBottom: `1px solid ${colors.border}`, paddingBottom: '8px' }}>{title}</div>
      {children}
    </section>
  )
}

function Hero({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: fonts.serif, fontSize: '36px', color: colors.tertiary, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: '6px' }}>{label}</div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.sans, fontSize: '13px' }}>
      <span style={{ color: colors.secondary }}>{label}</span>
      <span style={{ color: colors.neutral, fontWeight: bold ? 600 : 400 }}>{value}</span>
    </div>
  )
}

function fmt(n: number, type: 'pct' | 'mxn') {
  if (!n) return '—'
  if (type === 'pct') return `${(n * 100).toFixed(1)}%`
  return `$${n.toLocaleString('es-MX')} MXN`
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}

export function ProspectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [prospect, setProspect] = useState<Prospect | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchProspect(Number(id))
      .then(setProspect)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>
  if (error || !prospect) return <div style={{ padding: '32px', color: 'tomato' }}>{error ?? 'No encontrado'}</div>

  const hasCoords = prospect.latitude !== 0 && prospect.longitude !== 0
  const errors = prospect.issues.filter(i => i.severity === 'error')
  const warnings = prospect.issues.filter(i => i.severity === 'warning')
  const duration = prospect.investmentDate && prospect.saleDate
    ? monthsBetween(prospect.investmentDate, prospect.saleDate)
    : null

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>
      <button
        onClick={() => navigate('/tabla')}
        style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '11px', letterSpacing: '0.1em', marginBottom: '24px', padding: 0 }}
      >
        ← PROSPECTOS
      </button>

      <h1 style={{ fontFamily: fonts.serif, fontSize: '28px', color: colors.neutral, marginBottom: '8px' }}>{prospect.name}</h1>
      <div style={{ fontFamily: fonts.sans, fontSize: '13px', color: colors.secondary, marginBottom: '32px' }}>{prospect.address} · {prospect.sqmLand} m²</div>

      <Section title="Métricas clave">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', background: colors.surfaceAlt, padding: '24px', borderRadius: '2px' }}>
          <Hero label="ROI" value={fmt(prospect.roi, 'pct')} />
          <Hero label="Profit" value={`$${(prospect.profit / 1_000_000).toFixed(1)}M`} />
          <Hero label="Cap Rate" value={fmt(prospect.capRate, 'pct')} />
          <Hero label="Score" value={String(prospect.score ?? '—')} />
        </div>
      </Section>

      <Section title="Desglose de inversión">
        <Row label="Precio terreno" value={fmt(prospect.landPrice, 'mxn')} />
        <Row label={`Costos adquisición (${(prospect.acquisitionCostPct * 100).toFixed(1)}%)`} value={fmt(prospect.acquisitionCosts, 'mxn')} />
        <Row label="Permisos" value={fmt(prospect.permitsCost, 'mxn')} />
        <Row label="Subdivisión" value={fmt(prospect.subdivisionCost, 'mxn')} />
        <Row label={`Construcción (${prospect.constructionCostPerSqm?.toLocaleString('es-MX')}/m² × ${prospect.sqmConstruction} m²)`} value={fmt(prospect.constructionBase, 'mxn')} />
        <Row label={`+ IVA/indirectos (×${prospect.constructionOverhead})`} value={fmt(prospect.constructionTotal, 'mxn')} />
        <Row label="INVERSIÓN TOTAL" value={fmt(prospect.totalInvestment, 'mxn')} bold />
        <Row label="Venta proyectada" value={fmt(prospect.projectedSale, 'mxn')} />
        <Row label="PROFIT" value={fmt(prospect.profit, 'mxn')} bold />
      </Section>

      {hasCoords && (
        <Section title="Ubicación">
          <div style={{ height: '320px', borderRadius: '2px', overflow: 'hidden' }}>
            <MapContainer center={[prospect.latitude, prospect.longitude]} zoom={15} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
              <CircleMarker center={[prospect.latitude, prospect.longitude]} radius={10} pathOptions={{ color: colors.tertiary, fillColor: colors.tertiary, fillOpacity: 1 }}>
                <Popup>{prospect.name}</Popup>
              </CircleMarker>
            </MapContainer>
          </div>
        </Section>
      )}

      {prospect.investmentDate && prospect.saleDate && (
        <Section title="Timeline">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontFamily: fonts.sans, fontSize: '13px' }}>
            <span style={{ color: colors.neutral }}>{prospect.investmentDate}</span>
            <span style={{ flex: 1, borderTop: `1px solid ${colors.tertiary}`, position: 'relative' }}>
              {duration !== null && (
                <span style={{ position: 'absolute', top: '-18px', left: '50%', transform: 'translateX(-50%)', fontFamily: fonts.label, fontSize: '10px', color: colors.tertiary, whiteSpace: 'nowrap' }}>{duration} meses</span>
              )}
            </span>
            <span style={{ color: colors.neutral }}>{prospect.saleDate}</span>
          </div>
        </Section>
      )}

      {(errors.length > 0 || warnings.length > 0) && (
        <Section title="Calidad de datos">
          {errors.map((issue, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontSize: '13px' }}>
              <span>🔴</span>
              <div>
                <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{issue.field}</span>
                <div style={{ color: colors.neutral, marginTop: '2px' }}>{issue.message}</div>
              </div>
            </div>
          ))}
          {warnings.map((issue, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${colors.border}`, fontSize: '13px' }}>
              <span>⚠️</span>
              <div>
                <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{issue.field}</span>
                <div style={{ color: colors.secondary, marginTop: '2px' }}>{issue.message}</div>
              </div>
            </div>
          ))}
        </Section>
      )}

      <Section title="Todos los campos">
        {Object.entries(prospect)
          .filter(([k]) => !['issues', 'score'].includes(k))
          .map(([k, v]) => (
            <Row key={k} label={k} value={String(v ?? '—')} />
          ))}
      </Section>
    </div>
  )
}
