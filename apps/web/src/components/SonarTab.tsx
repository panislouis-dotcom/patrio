import { useEffect, useMemo, useState } from 'react'
import { fetchSignals, runSonarScan, dismissSignal, importSignal } from '../lib/api'
import type { Signal } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fmtM } from '../lib/fmt'

function fmtK(n: number) { return n ? `$${(n / 1_000).toFixed(0)}k` : '—' }

type SortCol = 'score' | 'portal' | 'title' | 'price' | 'sqmLand' | 'ppsqm' | 'scrapedAt'
type SortDir = 'asc' | 'desc'
type DisplaySignal = Signal & { ppsqm: number; score: number | null }

// ── score: percentile rank of inverted $/m² within the filtered set ──────────
function percentileRank(value: number, all: number[]): number {
  if (all.length <= 1) return 0.5
  const below = all.filter(v => v < value).length
  const ties  = all.filter(v => v === value).length
  return (below + 0.5 * ties) / all.length
}
function computeScores(signals: (Signal & { ppsqm: number })[]): DisplaySignal[] {
  const valid = signals.filter(s => s.ppsqm > 0).map(s => s.ppsqm)
  return signals.map(s => ({
    ...s,
    score: s.ppsqm > 0
      ? Math.round((1 - percentileRank(s.ppsqm, valid)) * 100)
      : null,
  }))
}

// ── filter options ────────────────────────────────────────────────────────────
const MIN_PRICE_OPTS  = [
  { label: 'Sin mínimo', value: 0 },
  { label: '> $500k',    value: 500_000 },
  { label: '> $1M',      value: 1_000_000 },
  { label: '> $2M',      value: 2_000_000 },
  { label: '> $5M',      value: 5_000_000 },
]
const MAX_PRICE_OPTS  = [
  { label: 'Sin límite', value: 0 },
  { label: '< $2M',      value: 2_000_000 },
  { label: '< $5M',      value: 5_000_000 },
  { label: '< $10M',     value: 10_000_000 },
  { label: '< $20M',     value: 20_000_000 },
]
const MAX_PPSQM_OPTS  = [
  { label: 'Sin límite',  value: 0 },
  { label: '< $5k/m²',   value: 5_000 },
  { label: '< $10k/m²',  value: 10_000 },
  { label: '< $20k/m²',  value: 20_000 },
  { label: '< $35k/m²',  value: 35_000 },
]

// ── shared styles ─────────────────────────────────────────────────────────────
const TH: React.CSSProperties = {
  padding: '6px 10px',
  fontFamily: fonts.label,
  fontSize: '9px',
  color: colors.secondary,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
}
const SELECT: React.CSSProperties = {
  background: colors.dark,
  border: `1px solid ${colors.border}`,
  color: colors.secondary,
  fontFamily: fonts.label,
  fontSize: '9px',
  letterSpacing: '0.08em',
  padding: '3px 6px',
  cursor: 'pointer',
}

function SortMark({ col, sort }: { col: SortCol; sort: { col: SortCol; dir: SortDir } }) {
  if (sort.col !== col) return <span style={{ opacity: 0.2, marginLeft: '3px' }}>↕</span>
  return <span style={{ marginLeft: '3px', color: colors.neutral }}>{sort.dir === 'asc' ? '↑' : '↓'}</span>
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '10px' }}>—</span>
  const bg = score >= 70 ? colors.tertiary : score >= 40 ? colors.accent1 : colors.secondary
  return (
    <span style={{ background: bg, color: colors.neutral, fontFamily: fonts.label, fontSize: '10px', padding: '2px 6px', borderRadius: '2px' }}>
      {score}
    </span>
  )
}

export function SonarTab() {
  const [signals, setSignals]   = useState<Signal[]>([])
  const [loading, setLoading]   = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<{ new: number; scanned: number } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey]   = useState(0)

  // filters
  const [statusFilter, setStatusFilter] = useState<'new' | 'all' | 'imported'>('new')
  const [portalFilter, setPortalFilter] = useState('all')
  const [minPrice,  setMinPrice]  = useState(0)
  const [maxPrice,  setMaxPrice]  = useState(0)
  const [maxPpsqm,  setMaxPpsqm]  = useState(0)

  // sort
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({ col: 'score', dir: 'desc' })

  function refresh() { setRefreshKey(k => k + 1) }

  useEffect(() => {
    setLoading(true)
    fetchSignals().then(setSignals).finally(() => setLoading(false))
  }, [refreshKey])

  function toggleSort(col: SortCol) {
    setSort(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: (col === 'scrapedAt') ? 'desc' : 'desc' }
    )
  }

  const portals = useMemo(() => Array.from(new Set(signals.map(s => s.portal))).sort(), [signals])
  const newCount = useMemo(() => signals.filter(s => s.status === 'new').length, [signals])

  const displayed = useMemo((): DisplaySignal[] => {
    // 1. status filter
    let list: Signal[] = signals
    if (statusFilter === 'new')      list = list.filter(s => s.status === 'new')
    else if (statusFilter === 'imported') list = list.filter(s => s.status === 'imported')

    // 2. portal
    if (portalFilter !== 'all') list = list.filter(s => s.portal === portalFilter)

    // 3. price
    if (minPrice > 0) list = list.filter(s => s.price >= minPrice)
    if (maxPrice > 0) list = list.filter(s => s.price > 0 && s.price <= maxPrice)

    // 4. attach ppsqm
    const withPpsqm = list.map(s => ({
      ...s,
      ppsqm: s.price > 0 && s.sqmLand > 0 ? s.price / s.sqmLand : 0,
    }))

    // 5. max $/m² (signals without sqm data pass through)
    const afterPpsqm = maxPpsqm > 0
      ? withPpsqm.filter(s => s.ppsqm === 0 || s.ppsqm <= maxPpsqm)
      : withPpsqm

    // 6. compute scores relative to this filtered set
    const scored = computeScores(afterPpsqm)

    // 7. sort
    return [...scored].sort((a, b) => {
      let av: number | string | null = 0
      let bv: number | string | null = 0
      switch (sort.col) {
        case 'score':    av = a.score ?? -1;  bv = b.score ?? -1;  break
        case 'portal':   av = a.portal;        bv = b.portal;        break
        case 'title':    av = a.title;         bv = b.title;         break
        case 'price':    av = a.price;         bv = b.price;         break
        case 'sqmLand':  av = a.sqmLand;       bv = b.sqmLand;       break
        case 'ppsqm':    av = a.ppsqm;         bv = b.ppsqm;         break
        case 'scrapedAt': av = a.scrapedAt ?? ''; bv = b.scrapedAt ?? ''; break
      }
      if (av! < bv!) return sort.dir === 'asc' ? -1 : 1
      if (av! > bv!) return sort.dir === 'asc' ? 1  : -1
      return 0
    })
  }, [signals, statusFilter, portalFilter, minPrice, maxPrice, maxPpsqm, sort])

  async function handleScan() {
    setScanning(true); setScanResult(null)
    try {
      const r = await runSonarScan()
      setScanResult({ new: r.new, scanned: r.scanned })
      refresh()
    } catch { /* fail silently */ }
    finally { setScanning(false) }
  }

  async function handleDismiss(s: Signal) {
    try { await dismissSignal(s.id); setSignals(prev => prev.filter(x => x.id !== s.id)) }
    catch { setActionError('Error al descartar la señal') }
  }

  async function handleImport(s: Signal) {
    try { await importSignal(s.id); refresh() }
    catch { setActionError('Error al importar la señal') }
  }

  const pill = (active: boolean): React.CSSProperties => ({
    background: active ? colors.primary : 'transparent',
    border: `1px solid ${active ? colors.primary : colors.border}`,
    color: active ? colors.neutral : colors.secondary,
    cursor: 'pointer',
    fontFamily: fonts.label,
    fontSize: '9px',
    letterSpacing: '0.1em',
    padding: '3px 9px',
  })

  const sep: React.CSSProperties = { width: '1px', height: '16px', background: colors.border, flexShrink: 0 }
  const label: React.CSSProperties = { fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.08em', whiteSpace: 'nowrap' }

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <span style={{ fontFamily: fonts.label, fontSize: '11px', color: colors.neutral, letterSpacing: '0.1em' }}>SONAR</span>
          <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary, marginLeft: '8px' }}>· Señales de mercado</span>
          {scanResult && (
            <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.tertiary, marginLeft: '12px' }}>
              ↑ {scanResult.new} nuevas de {scanResult.scanned} portales
            </span>
          )}
        </div>
        <button onClick={handleScan} disabled={scanning} style={{
          background: scanning ? colors.border : colors.primary, border: 'none',
          color: colors.neutral, cursor: scanning ? 'not-allowed' : 'pointer',
          fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.1em',
          padding: '6px 14px', opacity: scanning ? 0.6 : 1,
        }}>
          {scanning ? 'ESCANEANDO…' : 'EJECUTAR SCAN ▸'}
        </button>
      </div>

      {actionError && (
        <div style={{ padding: '6px 16px', background: 'tomato', color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px' }}>
          {actionError}
          <button onClick={() => setActionError(null)} style={{ marginLeft: '8px', background: 'none', border: 'none', color: colors.neutral, cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 16px', borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
        {/* Status */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button style={pill(statusFilter === 'new')}      onClick={() => setStatusFilter('new')}>NUEVAS{newCount > 0 ? ` (${newCount})` : ''}</button>
          <button style={pill(statusFilter === 'all')}      onClick={() => setStatusFilter('all')}>TODAS</button>
          <button style={pill(statusFilter === 'imported')} onClick={() => setStatusFilter('imported')}>IMPORTADAS</button>
        </div>

        <div style={sep} />

        {/* Portal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={label}>PORTAL</span>
          <select value={portalFilter} onChange={e => setPortalFilter(e.target.value)} style={SELECT}>
            <option value="all">Todos</option>
            {portals.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div style={sep} />

        {/* Min price */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={label}>PRECIO MÍN</span>
          <select value={minPrice} onChange={e => setMinPrice(Number(e.target.value))} style={SELECT}>
            {MIN_PRICE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Max price */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={label}>MÁX</span>
          <select value={maxPrice} onChange={e => setMaxPrice(Number(e.target.value))} style={SELECT}>
            {MAX_PRICE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div style={sep} />

        {/* Max $/m² */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={label}>$/M² MÁX</span>
          <select value={maxPpsqm} onChange={e => setMaxPpsqm(Number(e.target.value))} style={SELECT}>
            {MAX_PPSQM_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div style={{ marginLeft: 'auto', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.06em' }}>
          {displayed.length} señales
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '32px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Cargando…</div>
        ) : displayed.length === 0 ? (
          <div style={{ padding: '32px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
            {signals.length === 0
              ? 'Sin señales. Ejecuta un scan para buscar nuevas propiedades.'
              : 'Sin resultados con los filtros actuales.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <th style={{ ...TH, textAlign: 'center', width: '52px' }} onClick={() => toggleSort('score')}>
                  SCORE <SortMark col="score" sort={sort} />
                </th>
                <th style={{ ...TH, textAlign: 'left' }} onClick={() => toggleSort('portal')}>
                  PORTAL <SortMark col="portal" sort={sort} />
                </th>
                <th style={{ ...TH, textAlign: 'left' }} onClick={() => toggleSort('title')}>
                  PROPIEDAD <SortMark col="title" sort={sort} />
                </th>
                <th style={{ ...TH, textAlign: 'right' }} onClick={() => toggleSort('price')}>
                  PRECIO <SortMark col="price" sort={sort} />
                </th>
                <th style={{ ...TH, textAlign: 'right' }} onClick={() => toggleSort('sqmLand')}>
                  M² <SortMark col="sqmLand" sort={sort} />
                </th>
                <th style={{ ...TH, textAlign: 'right' }} onClick={() => toggleSort('ppsqm')}>
                  $/M² <SortMark col="ppsqm" sort={sort} />
                </th>
                <th style={{ ...TH, textAlign: 'right' }} onClick={() => toggleSort('scrapedAt')}>
                  FECHA <SortMark col="scrapedAt" sort={sort} />
                </th>
                <th style={{ padding: '6px 10px', width: '120px' }} />
              </tr>
            </thead>
            <tbody>
              {displayed.map(s => {
                const isDismissed = s.status === 'dismissed'
                const isImported  = s.status === 'imported'
                return (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${colors.border}`, opacity: isDismissed ? 0.4 : 1 }}>
                    {/* Score */}
                    <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                      <ScoreBadge score={s.score} />
                    </td>
                    {/* Portal */}
                    <td style={{ padding: '5px 10px' }}>
                      <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.portal}</span>
                    </td>
                    {/* Title + address */}
                    <td style={{ padding: '5px 10px', maxWidth: '260px' }}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{s.title}</a>
                      {s.address && <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '10px', marginTop: '1px' }}>{s.address}</div>}
                    </td>
                    {/* Precio */}
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.neutral, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(s.price)}</td>
                    {/* M² */}
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{s.sqmLand > 0 ? s.sqmLand.toLocaleString('es-MX') : '—'}</td>
                    {/* $/M² */}
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{s.ppsqm > 0 ? fmtK(s.ppsqm) : '—'}</td>
                    {/* Fecha */}
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '10px' }}>{s.scrapedAt ? s.scrapedAt.slice(0, 10) : '—'}</td>
                    {/* Actions */}
                    <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                      {!isDismissed && !isImported && (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button onClick={() => handleImport(s)} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '3px 8px' }}>
                            AGREGAR A PROSPECTOS
                          </button>
                          <button onClick={() => handleDismiss(s)} style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', padding: '3px 6px', lineHeight: 1 }}>
                            ✕
                          </button>
                        </div>
                      )}
                      {isImported && (
                        <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.primary, letterSpacing: '0.08em' }}>IMPORTADA</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
