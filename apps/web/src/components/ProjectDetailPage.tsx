import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import { fetchProject, updateProject } from '../lib/api'
import type { Project } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fieldInput } from '../lib/styles'
import { PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from '../lib/status'

function fmt(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const projectId = Number(id)

  const [project, setProject] = useState<Project | null>(null)
  const [edits, setEdits] = useState<Partial<Project>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [barsReady, setBarsReady] = useState(false)

  useEffect(() => {
    fetchProject(projectId).then(p => {
      setProject(p)
      setTimeout(() => setMounted(true), 40)
      setTimeout(() => setBarsReady(true), 420)
    })
  }, [projectId])

  const field = (key: keyof Project) => (edits as Record<string, unknown>)[key] ?? (project ? (project as unknown as Record<string, unknown>)[key] : undefined)
  const setField = (key: keyof Project, value: unknown) => setEdits(prev => ({ ...prev, [key]: value }))
  const hasEdits = Object.keys(edits).length > 0

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateProject(projectId, edits)
      setProject(updated)
      setEdits({})
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const fade = (delay = 0): React.CSSProperties => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(12px)',
    transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
  })

  if (!project) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 49px)', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
        Cargando…
      </div>
    )
  }

  const budget = (project.budget ?? {}) as Record<string, number>
  const budgetTotal = Object.values(budget).reduce((a, b) => a + b, 0)
  const milestones = (project.milestones ?? {}) as Record<string, string>
  const milestoneEntries = Object.entries(milestones).sort(([a], [b]) => a.localeCompare(b))
  const gain = project.unrealizedGain ?? 0
  const gainPct = (project.unrealizedGainPct ?? 0) * 100
  const gainPositive = gain >= 0
  const gainColor = gainPositive ? colors.primary : colors.tertiary
  const lat = project.latitude as number | null
  const lng = project.longitude as number | null
  const hasMap = lat && lng

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

  const barColors = [colors.primary, '#654F6F', '#5C5D8D', colors.tertiary, colors.secondary]

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: colors.dark }}>

      {/* ── HEADER ── */}
      <div style={{
        ...fade(0),
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
          onClick={() => navigate('/proyectos')}
          style={{ background: 'transparent', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', padding: 0, flexShrink: 0 }}
        >
          ← PROYECTOS
        </button>
        <span style={{ color: colors.border }}>·</span>
        <span style={{ fontFamily: fonts.serif, fontSize: '20px', color: colors.neutral, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {field('name') as string}
        </span>
        <span style={{
          fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.12em',
          padding: '3px 10px', flexShrink: 0,
          background: PROJECT_STATUS_COLOR[field('status') as string] ?? colors.border,
          color: colors.neutral,
        }}>
          {PROJECT_STATUS_LABEL[field('status') as string] ?? String(field('status') ?? '').toUpperCase()}
        </span>
        {hasEdits && (
          <button
            onClick={save}
            disabled={saving}
            style={{
              background: colors.primary, border: 'none', color: colors.neutral,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em',
              padding: '6px 16px', opacity: saving ? 0.7 : 1,
              transition: 'opacity 0.2s', flexShrink: 0,
            }}
          >
            {saving ? 'GUARDANDO…' : 'GUARDAR ▸'}
          </button>
        )}
      </div>

      {/* ── MAIN 3-COLUMN GRID ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '290px 1fr 310px', overflow: 'hidden' }}>

        {/* ── LEFT: Métricas + Edición ── */}
        <div style={{
          ...fade(80),
          borderRight: `1px solid ${colors.border}`,
          overflowY: 'auto',
          padding: '20px',
          scrollbarWidth: 'none',
        }}>

          {/* Hero gain */}
          <div style={{ paddingBottom: '16px', borderBottom: `1px solid ${colors.border}`, marginBottom: '4px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '10px' }}>
              GANANCIA NO REALIZADA
            </div>
            <div style={{ fontFamily: fonts.serif, fontSize: '42px', color: gainColor, lineHeight: 1 }}>
              {gainPositive ? '+' : ''}{fmt(gain)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
              <div style={{ flex: 1, height: '3px', background: colors.border, borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: barsReady ? `${Math.min(100, Math.abs(gainPct))}%` : '0%',
                  background: gainColor,
                  transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
                }} />
              </div>
              <span style={{ fontFamily: fonts.label, fontSize: '13px', color: gainColor, fontWeight: 700, flexShrink: 0 }}>
                {gainPositive ? '+' : ''}{gainPct.toFixed(1)}%
              </span>
            </div>
          </div>

          {stat('INVERSIÓN', fmt((field('totalInvestment') as number) ?? 0))}
          {stat('VALORACIÓN', fmt((field('currentValuation') as number) ?? 0))}
          {stat('UNIDADES', field('totalUnits') as React.ReactNode)}
          {stat('TIPO', field('type') as React.ReactNode)}
          {project.holdMonthsActual ? stat('HOLD', `${project.holdMonthsActual} meses`) : null}

          {divider('FECHAS')}
          {stat('ADQUISICIÓN', field('acquisitionDate') as React.ReactNode)}
          {project.firstRentDate ? stat('PRIMERA RENTA', field('firstRentDate') as React.ReactNode) : null}
          {project.valuationDate ? stat('VALUACIÓN', field('valuationDate') as React.ReactNode) : null}

          {divider('UBICACIÓN')}
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral, marginBottom: '2px' }}>{field('address') as string}</div>
          <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>{field('city') as string}</div>

          {divider('EDITAR')}
          {([
            { key: 'name', label: 'Nombre', type: 'text' },
            { key: 'address', label: 'Dirección', type: 'text' },
            { key: 'city', label: 'Ciudad', type: 'text' },
            { key: 'type', label: 'Tipo', type: 'text' },
          ] as const).map(({ key, label, type }) => (
            <div key={key} style={{ marginBottom: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>{label.toUpperCase()}</div>
              <input
                value={(field(key as keyof Project) as string) ?? ''}
                onChange={e => setField(key as keyof Project, e.target.value)}
                type={type}
                style={fieldInput}
              />
            </div>
          ))}

          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>ESTADO</div>
            <select
              value={(field('status') as string) ?? ''}
              onChange={e => setField('status', e.target.value)}
              style={{ ...fieldInput, cursor: 'pointer' }}
            >
              {Object.entries(PROJECT_STATUS_LABEL).map(([val, lbl]) => (
                <option key={val} value={val}>{lbl}</option>
              ))}
            </select>
          </div>

          {([
            { key: 'totalInvestment', label: 'Inversión ($)' },
            { key: 'currentValuation', label: 'Valoración ($)' },
            { key: 'totalUnits', label: 'Unidades' },
          ] as const).map(({ key, label }) => (
            <div key={key} style={{ marginBottom: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>{label.toUpperCase()}</div>
              <input
                value={(field(key as keyof Project) as number) ?? ''}
                onChange={e => setField(key as keyof Project, Number(e.target.value))}
                type="number"
                style={fieldInput}
              />
            </div>
          ))}

          {([
            { key: 'acquisitionDate', label: 'Adquisición (YYYY-MM)' },
            { key: 'firstRentDate', label: 'Primera renta (YYYY-MM)' },
            { key: 'valuationDate', label: 'Valuación (YYYY-MM)' },
          ] as const).map(({ key, label }) => (
            <div key={key} style={{ marginBottom: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>{label.toUpperCase()}</div>
              <input
                value={(field(key as keyof Project) as string) ?? ''}
                onChange={e => setField(key as keyof Project, e.target.value)}
                type="text"
                placeholder="YYYY-MM"
                style={fieldInput}
              />
            </div>
          ))}

          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em', marginBottom: '2px' }}>NOTAS</div>
            <textarea
              value={(field('notes') as string) ?? ''}
              onChange={e => setField('notes', e.target.value)}
              rows={3}
              style={{ ...fieldInput, resize: 'vertical' }}
            />
          </div>

          {error && (
            <div style={{ color: colors.tertiary, fontFamily: fonts.sans, fontSize: '11px', marginTop: '8px' }}>{error}</div>
          )}
        </div>

        {/* ── CENTER: Mapa ── */}
        <div style={{ ...fade(160), position: 'relative', overflow: 'hidden' }}>
          {hasMap ? (
            <MapContainer
              center={[lat, lng]}
              zoom={15}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={false}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              />
              <CircleMarker
                center={[lat, lng]}
                radius={12}
                pathOptions={{ color: colors.primary, fillColor: colors.primary, fillOpacity: 0.7, weight: 2 }}
              />
            </MapContainer>
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.12em', color: colors.border }}>SIN COORDENADAS</div>
              <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>Agrega lat/lng en el panel izquierdo</div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Presupuesto + Hitos + Notas ── */}
        <div style={{
          ...fade(240),
          borderLeft: `1px solid ${colors.border}`,
          overflowY: 'auto',
          padding: '20px',
          scrollbarWidth: 'none',
        }}>

          {/* Presupuesto */}
          {Object.keys(budget).length > 0 && (
            <>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '6px' }}>PRESUPUESTO</div>
              <div style={{ fontFamily: fonts.serif, fontSize: '28px', color: colors.neutral, marginBottom: '20px' }}>
                {fmt(budgetTotal)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {Object.entries(budget).sort(([, a], [, b]) => b - a).map(([cat, amount], i) => {
                  const pct = budgetTotal > 0 ? (amount / budgetTotal) * 100 : 0
                  return (
                    <div key={cat}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.08em' }}>
                          {cat.toUpperCase()}
                        </span>
                        <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.neutral }}>{fmt(amount)}</span>
                      </div>
                      <div style={{ height: '3px', background: colors.border, borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: barsReady ? `${pct}%` : '0%',
                          background: barColors[i % barColors.length],
                          borderRadius: '2px',
                          transition: `width 0.9s cubic-bezier(0.4, 0, 0.2, 1) ${i * 70}ms`,
                        }} />
                      </div>
                      <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.border, marginTop: '3px', textAlign: 'right' }}>
                        {pct.toFixed(0)}%
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Hitos */}
          {milestoneEntries.length > 0 && (
            <div style={{ marginTop: Object.keys(budget).length > 0 ? '28px' : '0', paddingTop: Object.keys(budget).length > 0 ? '20px' : '0', borderTop: Object.keys(budget).length > 0 ? `1px solid ${colors.border}` : 'none' }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '16px' }}>HITOS</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {milestoneEntries.map(([date, label], i) => (
                  <div key={date} style={{ display: 'flex', gap: '14px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '8px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: colors.primary,
                        flexShrink: 0,
                        boxShadow: `0 0 6px ${colors.primary}66`,
                      }} />
                      {i < milestoneEntries.length - 1 && (
                        <div style={{ width: '1px', flex: 1, minHeight: '20px', background: colors.border }} />
                      )}
                    </div>
                    <div style={{ paddingBottom: '16px' }}>
                      <div style={{ fontFamily: fonts.label, fontSize: '8px', color: colors.secondary, letterSpacing: '0.05em' }}>{date}</div>
                      <div style={{ fontFamily: fonts.sans, fontSize: '12px', color: colors.neutral, marginTop: '2px' }}>{label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notas */}
          {project.notes && (
            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${colors.border}` }}>
              <div style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.15em', color: colors.secondary, marginBottom: '8px' }}>NOTAS</div>
              <div style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
                {project.notes}
              </div>
            </div>
          )}

          {/* URL */}
          {project.url && (
            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${colors.border}` }}>
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.1em', color: colors.secondary, textDecoration: 'none' }}
              >
                VER FUENTE ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
