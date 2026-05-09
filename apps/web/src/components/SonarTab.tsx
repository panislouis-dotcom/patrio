import { useEffect, useMemo, useState } from 'react'
import { fetchSignals, runSonarScan, dismissSignal, importSignal } from '../lib/api'
import type { Signal } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fmtM } from '../lib/fmt'

function fmtK(n: number) { return n ? `$${(n / 1_000).toFixed(0)}k` : '—' }

type SortCol = 'portal' | 'title' | 'price' | 'sqmLand' | 'pricePerSqm' | 'scrapedAt'
type SortDir = 'asc' | 'desc'

const MAX_PRICE_OPTIONS = [
  { label: 'Sin límite', value: 0 },
  { label: '< $2M', value: 2_000_000 },
  { label: '< $5M', value: 5_000_000 },
  { label: '< $10M', value: 10_000_000 },
  { label: '< $20M', value: 20_000_000 },
]

const TH_BASE: React.CSSProperties = {
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

function SortIndicator({ col, sort }: { col: SortCol; sort: { col: SortCol; dir: SortDir } }) {
  if (sort.col !== col) return <span style={{ opacity: 0.2, marginLeft: '3px' }}>↕</span>
  return <span style={{ marginLeft: '3px', color: colors.neutral }}>{sort.dir === 'asc' ? '↑' : '↓'}</span>
}

export function SonarTab() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<{ new: number; scanned: number } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Filters
  const [statusFilter, setStatusFilter] = useState<'new' | 'all' | 'imported'>('new')
  const [portalFilter, setPortalFilter] = useState('all')
  const [maxPrice, setMaxPrice] = useState(0)

  // Sort
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({ col: 'scrapedAt', dir: 'desc' })

  function refresh() { setRefreshKey(k => k + 1) }

  useEffect(() => {
    setLoading(true)
    fetchSignals()
      .then(setSignals)
      .finally(() => setLoading(false))
  }, [refreshKey])

  function toggleSort(col: SortCol) {
    setSort(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: col === 'scrapedAt' ? 'desc' : 'asc' }
    )
  }

  // Derived portals list for filter dropdown
  const portals = useMemo(() => {
    const seen = new Set(signals.map(s => s.portal))
    return Array.from(seen).sort()
  }, [signals])

  // Filtered + sorted signals
  const displayed = useMemo(() => {
    let list = signals

    // Status filter
    if (statusFilter === 'new') list = list.filter(s => s.status === 'new')
    else if (statusFilter === 'imported') list = list.filter(s => s.status === 'imported')
    // 'all' shows everything including dismissed

    // Portal filter
    if (portalFilter !== 'all') list = list.filter(s => s.portal === portalFilter)

    // Max price
    if (maxPrice > 0) list = list.filter(s => s.price > 0 && s.price <= maxPrice)

    // Sort
    list = [...list].sort((a, b) => {
      let av: number | string = 0
      let bv: number | string = 0
      if (sort.col === 'portal') { av = a.portal; bv = b.portal }
      else if (sort.col === 'title') { av = a.title; bv = b.title }
      else if (sort.col === 'price') { av = a.price; bv = b.price }
      else if (sort.col === 'sqmLand') { av = a.sqmLand; bv = b.sqmLand }
      else if (sort.col === 'pricePerSqm') {
        av = a.price > 0 && a.sqmLand > 0 ? a.price / a.sqmLand : 0
        bv = b.price > 0 && b.sqmLand > 0 ? b.price / b.sqmLand : 0
      }
      else if (sort.col === 'scrapedAt') { av = a.scrapedAt ?? ''; bv = b.scrapedAt ?? '' }

      if (av < bv) return sort.dir === 'asc' ? -1 : 1
      if (av > bv) return sort.dir === 'asc' ? 1 : -1
      return 0
    })

    return list
  }, [signals, statusFilter, portalFilter, maxPrice, sort])

  async function handleScan() {
    setScanning(true)
    setScanResult(null)
    try {
      const result = await runSonarScan()
      setScanResult({ new: result.new, scanned: result.scanned })
      refresh()
    } catch (_e) {
      // errors shown per-portal in result
    } finally {
      setScanning(false)
    }
  }

  async function handleDismiss(signal: Signal) {
    try {
      await dismissSignal(signal.id)
      setSignals(prev => prev.filter(s => s.id !== signal.id))
    } catch {
      setActionError('Error al descartar la señal')
    }
  }

  async function handleImport(signal: Signal) {
    try {
      await importSignal(signal.id)
      refresh()
    } catch {
      setActionError('Error al importar la señal')
    }
  }

  const pillStyle = (active: boolean): React.CSSProperties => ({
    background: active ? colors.primary : 'transparent',
    border: `1px solid ${active ? colors.primary : colors.border}`,
    color: active ? colors.neutral : colors.secondary,
    cursor: 'pointer',
    fontFamily: fonts.label,
    fontSize: '9px',
    letterSpacing: '0.1em',
    padding: '3px 9px',
  })

  const selectStyle: React.CSSProperties = {
    background: colors.dark,
    border: `1px solid ${colors.border}`,
    color: colors.secondary,
    fontFamily: fonts.label,
    fontSize: '9px',
    letterSpacing: '0.08em',
    padding: '3px 6px',
    cursor: 'pointer',
  }

  const newCount = signals.filter(s => s.status === 'new').length

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header bar */}
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
        <button
          onClick={handleScan}
          disabled={scanning}
          style={{
            background: scanning ? colors.border : colors.primary,
            border: 'none',
            color: colors.neutral,
            cursor: scanning ? 'not-allowed' : 'pointer',
            fontFamily: fonts.label,
            fontSize: '10px',
            letterSpacing: '0.1em',
            padding: '6px 14px',
            opacity: scanning ? 0.6 : 1,
          }}
        >
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 16px', borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
        {/* Status pills */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button style={pillStyle(statusFilter === 'new')} onClick={() => setStatusFilter('new')}>
            NUEVAS{newCount > 0 ? ` (${newCount})` : ''}
          </button>
          <button style={pillStyle(statusFilter === 'all')} onClick={() => setStatusFilter('all')}>TODAS</button>
          <button style={pillStyle(statusFilter === 'imported')} onClick={() => setStatusFilter('imported')}>IMPORTADAS</button>
        </div>

        <div style={{ width: '1px', height: '16px', background: colors.border }} />

        {/* Portal filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.08em' }}>PORTAL</span>
          <select value={portalFilter} onChange={e => setPortalFilter(e.target.value)} style={selectStyle}>
            <option value="all">Todos</option>
            {portals.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {/* Max price filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.08em' }}>PRECIO MÁX</span>
          <select value={maxPrice} onChange={e => setMaxPrice(Number(e.target.value))} style={selectStyle}>
            {MAX_PRICE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div style={{ marginLeft: 'auto', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.06em' }}>
          {displayed.length} señales
        </div>
      </div>

      {/* Signals table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '32px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Cargando…</div>
        ) : displayed.length === 0 ? (
          <div style={{ padding: '32px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
            {signals.length === 0 ? 'Sin señales. Ejecuta un scan para buscar nuevas propiedades.' : 'Sin resultados con los filtros actuales.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <th style={{ ...TH_BASE, textAlign: 'left' }} onClick={() => toggleSort('portal')}>
                  PORTAL <SortIndicator col="portal" sort={sort} />
                </th>
                <th style={{ ...TH_BASE, textAlign: 'left' }} onClick={() => toggleSort('title')}>
                  PROPIEDAD <SortIndicator col="title" sort={sort} />
                </th>
                <th style={{ ...TH_BASE, textAlign: 'right' }} onClick={() => toggleSort('price')}>
                  PRECIO <SortIndicator col="price" sort={sort} />
                </th>
                <th style={{ ...TH_BASE, textAlign: 'right' }} onClick={() => toggleSort('sqmLand')}>
                  M² <SortIndicator col="sqmLand" sort={sort} />
                </th>
                <th style={{ ...TH_BASE, textAlign: 'right' }} onClick={() => toggleSort('pricePerSqm')}>
                  $/M² <SortIndicator col="pricePerSqm" sort={sort} />
                </th>
                <th style={{ ...TH_BASE, textAlign: 'right' }} onClick={() => toggleSort('scrapedAt')}>
                  FECHA <SortIndicator col="scrapedAt" sort={sort} />
                </th>
                <th style={{ padding: '6px 10px', width: '120px' }} />
              </tr>
            </thead>
            <tbody>
              {displayed.map(s => {
                const isDismissed = s.status === 'dismissed'
                const isImported = s.status === 'imported'
                const pricePerSqm = s.price > 0 && s.sqmLand > 0 ? s.price / s.sqmLand : 0

                return (
                  <tr
                    key={s.id}
                    style={{ borderBottom: `1px solid ${colors.border}`, opacity: isDismissed ? 0.4 : 1 }}
                  >
                    <td style={{ padding: '5px 10px' }}>
                      <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.portal}</span>
                    </td>
                    <td style={{ padding: '5px 10px', maxWidth: '280px' }}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{s.title}</a>
                      {s.address && <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '10px', marginTop: '1px' }}>{s.address}</div>}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.neutral, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(s.price)}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{s.sqmLand > 0 ? s.sqmLand.toLocaleString('es-MX') : '—'}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{pricePerSqm > 0 ? fmtK(pricePerSqm) : '—'}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '10px' }}>{s.scrapedAt ? s.scrapedAt.slice(0, 10) : '—'}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                      {!isDismissed && !isImported && (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleImport(s)}
                            style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '3px 8px' }}
                          >
                            AGREGAR A PROSPECTOS
                          </button>
                          <button
                            onClick={() => handleDismiss(s)}
                            style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '10px', padding: '3px 6px', lineHeight: 1 }}
                          >
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
