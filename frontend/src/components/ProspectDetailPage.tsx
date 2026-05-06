import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { fetchProspect, updateProspect, createProspect } from '../lib/api'
import type { Prospect, RawFields } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { ProspectForm } from './ProspectForm'

export const DEFAULT_PROSPECT: Partial<RawFields> = {
  city: 'Monterrey',
  status: 'evaluating',
  acquisitionCostPct: 0.065,
  constructionOverhead: 1.3,
  latitude: 0,
  longitude: 0,
  sqmLand: 0,
  sqmConstruction: 0,
  landPrice: 0,
  permitsCost: 0,
  subdivisionCost: 0,
  constructionCostPerSqm: 0,
  projectedSale: 0,
  rentMonthly: 0,
  investmentDate: '',
  saleDate: '',
  notes: '',
}

function prospectToRawFields(p: Prospect): RawFields {
  return {
    name: p.name,
    address: p.address,
    city: p.city,
    status: p.status,
    url: p.url,
    latitude: p.latitude,
    longitude: p.longitude,
    sqmLand: p.sqmLand,
    sqmConstruction: p.sqmConstruction,
    landPrice: p.landPrice,
    acquisitionCostPct: p.acquisitionCostPct,
    permitsCost: p.permitsCost,
    subdivisionCost: p.subdivisionCost,
    constructionCostPerSqm: p.constructionCostPerSqm,
    constructionOverhead: p.constructionOverhead,
    projectedSale: p.projectedSale,
    rentMonthly: p.rentMonthly,
    investmentDate: p.investmentDate,
    saleDate: p.saleDate,
    notes: p.notes,
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
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
  const isNew = id === 'nuevo'

  const [prospect, setProspect] = useState<Prospect | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(isNew)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (isNew) {
      setLoading(false)
      return
    }
    fetchProspect(Number(id))
      .then(setProspect)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, isNew])

  async function handleSave(data: RawFields) {
    setSaving(true)
    setSaveError(null)
    try {
      let result: Prospect
      if (isNew) {
        result = await createProspect(data)
        navigate(`/tabla/${result.id}`, { replace: true })
      } else {
        result = await updateProspect(Number(id), data)
        setProspect(result)
        setEditing(false)
      }
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (!isNew && loading) return <div style={{ padding: '32px', color: colors.secondary }}>Cargando…</div>
  if (!isNew && (error || !prospect)) return <div style={{ padding: '32px', color: 'tomato' }}>{error ?? 'No encontrado'}</div>

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
      <button
        onClick={() => navigate('/tabla')}
        style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '11px', letterSpacing: '0.1em', padding: 0 }}
      >
        ← PROSPECTOS
      </button>
      {!isNew && !editing && (
        <button
          onClick={() => setEditing(true)}
          style={{ background: 'none', border: `1px solid ${colors.primary}`, color: colors.primary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '11px', letterSpacing: '0.1em', padding: '6px 14px' }}
        >
          EDITAR
        </button>
      )}
    </div>
  )

  if (editing) {
    return (
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>
        {header}
        <ProspectForm
          initial={isNew ? DEFAULT_PROSPECT : prospectToRawFields(prospect!)}
          onSave={handleSave}
          onCancel={isNew ? undefined : () => setEditing(false)}
          saving={saving}
          saveError={saveError}
        />
      </div>
    )
  }

  // Read-only view — prospect is guaranteed non-null here (isNew=false and !editing)
  const p = prospect!
  const hasCoords = p.latitude !== 0 && p.longitude !== 0
  const errors = p.issues.filter(i => i.severity === 'error')
  const warnings = p.issues.filter(i => i.severity === 'warning')
  const duration = p.investmentDate && p.saleDate
    ? monthsBetween(p.investmentDate, p.saleDate)
    : null

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>
      {header}

      <h1 style={{ fontFamily: fonts.serif, fontSize: '28px', color: colors.neutral, marginBottom: '8px' }}>{p.name}</h1>
      <div style={{ fontFamily: fonts.sans, fontSize: '13px', color: colors.secondary, marginBottom: '32px' }}>{p.address} · {p.sqmLand} m²</div>

      <Section title="Métricas clave">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', background: colors.surfaceAlt, padding: '24px', borderRadius: '2px' }}>
          <Hero label="ROI" value={fmt(p.roi, 'pct')} />
          <Hero label="Profit" value={`$${(p.profit / 1_000_000).toFixed(1)}M`} />
          <Hero label="Cap Rate" value={fmt(p.capRate, 'pct')} />
          <Hero label="Score" value={String(p.score ?? '—')} />
        </div>
      </Section>

      <Section title="Desglose de inversión">
        <Row label="Precio terreno" value={fmt(p.landPrice, 'mxn')} />
        <Row label={`Costos adquisición (${(p.acquisitionCostPct * 100).toFixed(1)}%)`} value={fmt(p.acquisitionCosts, 'mxn')} />
        <Row label="Permisos" value={fmt(p.permitsCost, 'mxn')} />
        <Row label="Subdivisión" value={fmt(p.subdivisionCost, 'mxn')} />
        <Row label={`Construcción (${p.constructionCostPerSqm?.toLocaleString('es-MX')}/m² × ${p.sqmConstruction} m²)`} value={fmt(p.constructionBase, 'mxn')} />
        <Row label={`+ IVA/indirectos (×${p.constructionOverhead})`} value={fmt(p.constructionTotal, 'mxn')} />
        <Row label="INVERSIÓN TOTAL" value={fmt(p.totalInvestment, 'mxn')} bold />
        <Row label="Venta proyectada" value={fmt(p.projectedSale, 'mxn')} />
        <Row label="PROFIT" value={fmt(p.profit, 'mxn')} bold />
      </Section>

      {hasCoords && (
        <Section title="Ubicación">
          <div style={{ height: '320px', borderRadius: '2px', overflow: 'hidden' }}>
            <MapContainer center={[p.latitude, p.longitude]} zoom={15} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
              <CircleMarker center={[p.latitude, p.longitude]} radius={10} pathOptions={{ color: colors.tertiary, fillColor: colors.tertiary, fillOpacity: 1 }}>
                <Popup>{p.name}</Popup>
              </CircleMarker>
            </MapContainer>
          </div>
        </Section>
      )}

      {p.investmentDate && p.saleDate && (
        <Section title="Timeline">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontFamily: fonts.sans, fontSize: '13px' }}>
            <span style={{ color: colors.neutral }}>{p.investmentDate}</span>
            <span style={{ flex: 1, borderTop: `1px solid ${colors.tertiary}`, position: 'relative' }}>
              {duration !== null && (
                <span style={{ position: 'absolute', top: '-18px', left: '50%', transform: 'translateX(-50%)', fontFamily: fonts.label, fontSize: '10px', color: colors.tertiary, whiteSpace: 'nowrap' }}>{duration} meses</span>
              )}
            </span>
            <span style={{ color: colors.neutral }}>{p.saleDate}</span>
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
        {Object.entries(p)
          .filter(([k]) => !['issues', 'score'].includes(k))
          .map(([k, v]) => (
            <Row key={k} label={k} value={String(v ?? '—')} />
          ))}
      </Section>
    </div>
  )
}
