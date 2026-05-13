import { useEffect, useMemo, useState } from 'react'
import { streamSonarRun, importSonarSignal, fetchSonarSignals, fetchZoneMedians, fetchProspects, fetchSonarZones } from '../lib/api'
import type { SonarRunEvent } from '../lib/api'
import type { SonarSignal, SonarState } from '../lib/types'
import { colors, fonts } from '../lib/theme'
import { fmtM } from '../lib/fmt'

function fmtPpsqm(n: number) {
  if (!n) return '—'
  return n >= 1_000 ? `$${(n / 1_000).toFixed(0)}k` : `$${Math.round(n)}`
}

function deduplicateSignals(signals: SonarSignal[]): { signals: SonarSignal[]; removed: number } {
  const dedupable: SonarSignal[] = []
  const passthrough: SonarSignal[] = []

  for (const s of signals) {
    if (s.municipioName && s.price > 0 && s.sqmLand > 0) {
      dedupable.push(s)
    } else {
      passthrough.push(s)
    }
  }

  // Group by municipioName, then cluster within group by price ±5% and sqmLand ±10%
  const byZone = new Map<string, SonarSignal[]>()
  for (const s of dedupable) {
    const g = byZone.get(s.municipioName!) ?? []
    g.push(s)
    byZone.set(s.municipioName!, g)
  }

  const result: SonarSignal[] = [...passthrough]
  for (const group of byZone.values()) {
    const clusters: SonarSignal[][] = []
    for (const sig of group) {
      let placed = false
      for (const cluster of clusters) {
        const rep = cluster[0]
        const priceAvg = (sig.price + rep.price) / 2
        const sqmAvg   = (sig.sqmLand + rep.sqmLand) / 2
        if (Math.abs(sig.price - rep.price) / priceAvg <= 0.05 &&
            Math.abs(sig.sqmLand - rep.sqmLand) / sqmAvg <= 0.10) {
          cluster.push(sig)
          placed = true
          break
        }
      }
      if (!placed) clusters.push([sig])
    }
    for (const cluster of clusters) {
      // Keep signal with best (lowest) $/m²
      result.push(cluster.reduce((a, b) =>
        (a.price / a.sqmLand) <= (b.price / b.sqmLand) ? a : b
      ))
    }
  }

  return { signals: result, removed: signals.length - result.length }
}

type SortCol = 'score' | 'portal' | 'title' | 'price' | 'sqmLand' | 'ppsqm'
type SortDir = 'asc' | 'desc'
type DisplaySignal = SonarSignal & { ppsqm: number; score: number | null }

function percentileRank(value: number, all: number[]): number {
  if (all.length <= 1) return 0.5
  const below = all.filter(v => v < value).length
  const ties  = all.filter(v => v === value).length
  return (below + 0.5 * ties) / all.length
}
function computeScores(signals: (SonarSignal & { ppsqm: number })[]): DisplaySignal[] {
  const valid = signals.filter(s => s.ppsqm > 0).map(s => s.ppsqm)
  return signals.map(s => ({
    ...s,
    score: s.ppsqm > 0
      ? Math.round((1 - percentileRank(s.ppsqm, valid)) * 100)
      : null,
  }))
}

const MIN_PRICE_OPTS = [
  { label: 'Sin mínimo', value: 0 },
  { label: '> $500k',    value: 500_000 },
  { label: '> $1M',      value: 1_000_000 },
  { label: '> $2M',      value: 2_000_000 },
  { label: '> $5M',      value: 5_000_000 },
]
const MAX_PRICE_OPTS = [
  { label: 'Sin límite', value: 0 },
  { label: '< $2M',      value: 2_000_000 },
  { label: '< $5M',      value: 5_000_000 },
  { label: '< $10M',     value: 10_000_000 },
  { label: '< $20M',     value: 20_000_000 },
]
const MAX_PPSQM_OPTS = [
  { label: 'Sin límite',  value: 0 },
  { label: '< $5k/m²',   value: 5_000 },
  { label: '< $10k/m²',  value: 10_000 },
  { label: '< $20k/m²',  value: 20_000 },
  { label: '< $35k/m²',  value: 35_000 },
]

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

// ── run progress types ────────────────────────────────────────────────────────
type PortalPhase =
  | { phase: 'pending' }
  | { phase: 'scanning' }
  | { phase: 'done';  fetched: number; skipped: number }
  | { phase: 'error'; error: string }

type EnrichPhase =
  | { phase: 'idle' }
  | { phase: 'running'; total: number; done: number }
  | { phase: 'done';    total: number; enriched: number }

type DedupPhase =
  | { phase: 'idle' }
  | { phase: 'done'; removed: number }

function PortalRow({ name, state, pulse }: { name: string; state: PortalPhase; pulse: boolean }) {
  const lbl: React.CSSProperties = { fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase' as const }
  const icon      = state.phase === 'done' ? '✓' : state.phase === 'error' ? '✕' : state.phase === 'scanning' ? '●' : '·'
  const iconColor = state.phase === 'done' ? colors.tertiary : state.phase === 'error' ? 'tomato' : state.phase === 'scanning' ? colors.primary : colors.border
  const nameColor = state.phase === 'pending' ? colors.border : colors.secondary
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '5px 0' }}>
      <span style={{ ...lbl, color: iconColor, width: '12px', textAlign: 'center',
        opacity: state.phase === 'scanning' && pulse ? 1 : state.phase === 'scanning' ? 0.3 : 1,
        transition: 'opacity 0.3s' }}>{icon}</span>
      <span style={{ ...lbl, color: nameColor, width: '120px' }}>{name}</span>
      {state.phase === 'scanning' && <span style={{ ...lbl, color: colors.secondary, opacity: 0.6 }}>escaneando...</span>}
      {state.phase === 'done' && (
        <span style={{ ...lbl, color: colors.secondary }}>
          {state.fetched} encontrados
          {state.skipped > 0 && <span style={{ opacity: 0.5 }}> · {state.skipped} descartadas</span>}
        </span>
      )}
      {state.phase === 'error' && <span style={{ ...lbl, color: 'tomato', opacity: 0.8 }}>error</span>}
    </div>
  )
}

export function SonarTab() {
  const [signals, setSignals]         = useState<SonarSignal[]>([])
  const [importedUrls, setImportedUrls] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)

  // Pre-load saved prospect URLs so signals already imported show "GUARDADA" across sessions
  useEffect(() => {
    fetchProspects().then(ps => {
      const urls = new Set(ps.map(p => p.url).filter(Boolean))
      setImportedUrls(urls as Set<string>)
    }).catch(() => {})
  }, [])

  // municipio-level median $/m² from historical DB — {municipio_name: median}
  const [zoneMedians, setZoneMedians] = useState<Record<string, number>>({})

  // geographic zone data (loaded from API)
  const [states, setStates]               = useState<SonarState[]>([])
  const [selectedState, setSelectedState] = useState<string>('')

  // zone selection for scan (CVE codes)
  const [selectedCves, setSelectedCves] = useState<string[]>([])

  // filters
  const [portalFilter,  setPortalFilter]  = useState('all')
  const [zoneFilter,    setZoneFilter]    = useState('all')
  const [minPrice,      setMinPrice]      = useState(0)
  const [maxPrice,      setMaxPrice]      = useState(0)
  const [maxPpsqm,      setMaxPpsqm]      = useState(0)
  const [excludeLotes,  setExcludeLotes]  = useState(false)

  // sort
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({ col: 'score', dir: 'desc' })

  // run progress
  const [running, setRunning]           = useState(false)
  const [portalOrder, setPortalOrder]   = useState<string[]>([])
  const [portalStatus, setPortalStatus] = useState<Record<string, PortalPhase>>({})
  const [enrichPhase, setEnrichPhase]   = useState<EnrichPhase>({ phase: 'idle' })
  const [dedupPhase,  setDedupPhase]    = useState<DedupPhase>({ phase: 'idle' })
  const [runSummary, setRunSummary]     = useState<{ found: number; skipped: number; enriched: number } | null>(null)
  const [dedupRemoved, setDedupRemoved] = useState(0)

  // pulsing dot for scanning indicator
  const [pulse, setPulse] = useState(true)
  useMemo(() => {
    if (!running) return
    const id = setInterval(() => setPulse(p => !p), 600)
    return () => clearInterval(id)
  }, [running])

  // load last scan + zone config on mount
  useEffect(() => {
    fetchSonarSignals().then(sigs => {
      const { signals: deduped, removed } = deduplicateSignals(sigs)
      setSignals(deduped)
      setDedupRemoved(removed)
    }).catch(() => {})
    fetchZoneMedians().then(setZoneMedians).catch(() => {})
    fetchSonarZones().then(s => {
      setStates(s)
      if (s.length > 0) setSelectedState(s[0].name)
    }).catch(() => {})
  }, [])

  const portals = useMemo(() => Array.from(new Set(signals.map(s => s.portal))).sort(), [signals])

  const resultZones = useMemo(
    () => Array.from(new Set(signals.map(s => s.municipioName).filter(Boolean))).sort(),
    [signals],
  )

  const currentMunicipios = useMemo(
    () => states.find(s => s.name === selectedState)?.municipios ?? [],
    [states, selectedState],
  )

  function selectAllCities()  { setSelectedCves(currentMunicipios.map(m => m.cve)) }
  function clearAllCities()   { setSelectedCves([]) }
  function onStateChange(name: string) {
    setSelectedState(name)
    setSelectedCves([])
  }

  const displayed = useMemo((): DisplaySignal[] => {
    let list = signals
    if (portalFilter !== 'all') list = list.filter(s => s.portal === portalFilter)
    if (zoneFilter   !== 'all') list = list.filter(s => s.municipioName === zoneFilter)
    if (excludeLotes) list = list.filter(s => !/lote|terreno/i.test(s.title))
    if (minPrice > 0) list = list.filter(s => s.price >= minPrice)
    if (maxPrice > 0) list = list.filter(s => s.price > 0 && s.price <= maxPrice)
    const withPpsqm = list.map(s => ({ ...s, ppsqm: s.price > 0 && s.sqmLand > 0 ? s.price / s.sqmLand : 0 }))
    const afterPpsqm = maxPpsqm > 0 ? withPpsqm.filter(s => s.ppsqm === 0 || s.ppsqm <= maxPpsqm) : withPpsqm
    const scored = computeScores(afterPpsqm)
    return [...scored].sort((a, b) => {
      let av: number | string | null = 0, bv: number | string | null = 0
      switch (sort.col) {
        case 'score':   av = a.score ?? -1; bv = b.score ?? -1; break
        case 'portal':  av = a.portal;      bv = b.portal;      break
        case 'title':   av = a.title;       bv = b.title;       break
        case 'price':   av = a.price;       bv = b.price;       break
        case 'sqmLand': av = a.sqmLand;     bv = b.sqmLand;     break
        case 'ppsqm':   av = a.ppsqm;       bv = b.ppsqm;       break
      }
      if (av! < bv!) return sort.dir === 'asc' ? -1 : 1
      if (av! > bv!) return sort.dir === 'asc' ?  1 : -1
      return 0
    })
  }, [signals, portalFilter, zoneFilter, excludeLotes, minPrice, maxPrice, maxPpsqm, sort])

  function toggleSort(col: SortCol) {
    setSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' })
  }

  function toggleCve(cve: string) {
    setSelectedCves(prev =>
      prev.includes(cve) ? prev.filter(c => c !== cve) : [...prev, cve]
    )
  }

  function handleEvent(ev: SonarRunEvent) {
    switch (ev.type) {
      case 'start':
        setPortalOrder(ev.portals)
        setPortalStatus(Object.fromEntries(ev.portals.map(p => [p, { phase: 'pending' } as PortalPhase])))
        break
      case 'portal_start':
        setPortalStatus(prev => ({ ...prev, [ev.portal]: { phase: 'scanning' } }))
        break
      case 'portal_done':
        setPortalStatus(prev => ({ ...prev, [ev.portal]: { phase: 'done', fetched: ev.fetched, skipped: ev.skipped } }))
        break
      case 'portal_error':
        setPortalStatus(prev => ({ ...prev, [ev.portal]: { phase: 'error', error: ev.error } }))
        break
      case 'enriching':
        setEnrichPhase({ phase: 'running', total: ev.total, done: 0 })
        break
      case 'enrich_progress':
        setEnrichPhase({ phase: 'running', total: ev.total, done: ev.done })
        break
      case 'complete': {
        setEnrichPhase(prev => prev.phase === 'running'
          ? { phase: 'done', total: prev.total, enriched: ev.enriched }
          : { phase: 'done', total: ev.enriched, enriched: ev.enriched })
        const { signals: deduped, removed } = deduplicateSignals(ev.signals)
        setSignals(deduped)
        setDedupRemoved(removed)
        setDedupPhase({ phase: 'done', removed })
        setImportedUrls(new Set())
        setRunSummary({ found: ev.found, skipped: ev.skipped, enriched: ev.enriched })
        fetchZoneMedians().then(setZoneMedians).catch(() => {})
        break
      }
    }
  }

  async function handleRun() {
    setRunning(true)
    setPortalOrder([])
    setPortalStatus({})
    setEnrichPhase({ phase: 'idle' })
    setDedupPhase({ phase: 'idle' })
    setRunSummary(null)
    setSignals([])
    setZoneFilter('all')
    // importedUrls intentionally preserved — pre-loaded prospect URLs stay across scans
    try {
      for await (const ev of streamSonarRun(selectedCves)) handleEvent(ev)
    } catch (e) {
      setActionError(`Error durante el scan: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  async function handleImport(s: SonarSignal) {
    try {
      await importSonarSignal(s)
      setImportedUrls(prev => new Set([...prev, s.url]))
    } catch {
      setActionError('Error al importar')
    }
  }

  function handleDismiss(url: string) {
    setSignals(prev => prev.filter(s => s.url !== url))
  }

  const sep: React.CSSProperties = { width: '1px', height: '16px', background: colors.border, flexShrink: 0 }
  const lbl: React.CSSProperties = { fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.08em', whiteSpace: 'nowrap' }

  const hasSignals = signals.length > 0
  const hasRun     = runSummary !== null

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: `1px solid ${colors.border}`, gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontFamily: fonts.label, fontSize: '11px', color: colors.neutral, letterSpacing: '0.1em' }}>SONAR</span>
          <span style={{ fontFamily: fonts.sans, fontSize: '11px', color: colors.secondary }}>· Señales de mercado</span>
          {importedUrls.size > 0 && !running && (
            <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.primary, opacity: 0.8 }}>
              ↪ {importedUrls.size} guardada{importedUrls.size !== 1 ? 's' : ''}
            </span>
          )}
          {hasRun && !running && (
            <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.tertiary }}>
              ↑ {runSummary!.found} encontradas
              {runSummary!.enriched > 0 && <span style={{ color: colors.accent1 }}> · ◈ {runSummary!.enriched} m² enriquecidas</span>}
              {dedupRemoved > 0 && <span style={{ color: colors.secondary }}> · −{dedupRemoved} dupes</span>}
            </span>
          )}
        </div>

        {/* Geographic search selector — state dropdown + city chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', flexWrap: 'wrap' }}>
          {/* State dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.1em' }}>ESTADO</span>
            <select
              value={selectedState}
              onChange={e => onStateChange(e.target.value)}
              disabled={running}
              style={{ background: 'transparent', border: `1px solid ${colors.border}`, color: colors.secondary, fontFamily: fonts.label, fontSize: '9px', padding: '3px 5px', cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.5 : 1 }}
            >
              {states.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>

          {/* City chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.1em' }}>CIUDAD</span>
            {currentMunicipios.map(({ cve, name }) => {
              const active = selectedCves.includes(cve)
              const label  = name.split(' ').slice(0, 2).join(' ')
              return (
                <button key={cve} disabled={running} onClick={() => toggleCve(cve)}
                  title={name}
                  style={{
                    background: active ? colors.primary : 'transparent',
                    border: `1px solid ${active ? colors.primary : colors.border}`,
                    color: active ? colors.neutral : colors.secondary,
                    fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em',
                    padding: '3px 7px', cursor: running ? 'not-allowed' : 'pointer',
                    opacity: running ? 0.5 : 1,
                  }}>{label}</button>
              )
            })}
            <button disabled={running} onClick={selectAllCities} style={{
              background: 'none', border: `1px solid ${colors.border}`, color: colors.secondary,
              fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.06em',
              padding: '3px 6px', cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.5 : 0.6,
            }}>Todas</button>
            {selectedCves.length > 0 && (
              <button disabled={running} onClick={clearAllCities} style={{
                background: 'none', border: 'none', color: colors.secondary,
                fontFamily: fonts.label, fontSize: '10px', cursor: 'pointer', padding: '2px 4px', opacity: 0.6,
              }}>✕</button>
            )}
          </div>
        </div>

        <button onClick={handleRun} disabled={running} style={{
          background: running ? colors.border : colors.primary,
          border: 'none', color: colors.neutral,
          cursor: running ? 'not-allowed' : 'pointer',
          fontFamily: fonts.label, fontSize: '10px', letterSpacing: '0.1em',
          padding: '6px 14px', opacity: running ? 0.7 : 1,
        }}>
          {running ? 'EJECUTANDO…' : 'EJECUTAR SCAN ▸'}
        </button>
      </div>

      {actionError && (
        <div style={{ padding: '6px 16px', background: 'tomato', color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px' }}>
          {actionError}
          <button onClick={() => setActionError(null)} style={{ marginLeft: '8px', background: 'none', border: 'none', color: colors.neutral, cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Filter bar — only when results exist and not running */}
      {hasSignals && !running && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 16px', borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={lbl}>PORTAL</span>
            <select value={portalFilter} onChange={e => setPortalFilter(e.target.value)} style={SELECT}>
              <option value="all">Todos</option>
              {portals.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {resultZones.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={lbl}>ZONA</span>
              <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)} style={SELECT}>
                <option value="all">Todas</option>
                {resultZones.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
          )}
          <div style={sep} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={lbl}>PRECIO MÍN</span>
            <select value={minPrice} onChange={e => setMinPrice(Number(e.target.value))} style={SELECT}>
              {MIN_PRICE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={lbl}>MÁX</span>
            <select value={maxPrice} onChange={e => setMaxPrice(Number(e.target.value))} style={SELECT}>
              {MAX_PRICE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={sep} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={lbl}>$/M² MÁX</span>
            <select value={maxPpsqm} onChange={e => setMaxPpsqm(Number(e.target.value))} style={SELECT}>
              {MAX_PPSQM_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={sep} />
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={excludeLotes}
              onChange={e => setExcludeLotes(e.target.checked)}
              style={{ accentColor: colors.primary, cursor: 'pointer' }}
            />
            <span style={{ ...lbl, color: excludeLotes ? colors.neutral : colors.secondary }}>Sin lotes/terrenos</span>
          </label>
          <div style={{ marginLeft: 'auto', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.06em' }}>
            {displayed.length} señales
          </div>
        </div>
      )}

      {/* Progress panel — while running */}
      {running && (
        <div style={{ flex: 1, overflow: 'auto', padding: '36px 48px' }}>
          <div style={{ maxWidth: '480px' }}>
            <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '16px' }}>
              PORTALES · {portalOrder.length} total
            </div>
            <div style={{ marginBottom: '36px' }}>
              {portalOrder.map(name => (
                <PortalRow key={name} name={name} state={portalStatus[name] ?? { phase: 'pending' }} pulse={pulse} />
              ))}
            </div>

            <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginBottom: '12px' }}>
              ENRIQUECIMIENTO M²
            </div>
            {enrichPhase.phase === 'idle' && (
              <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.border, letterSpacing: '0.1em' }}>· pendiente...</div>
            )}
            {enrichPhase.phase === 'running' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontFamily: fonts.label, fontSize: '10px', color: colors.primary, opacity: pulse ? 1 : 0.3, transition: 'opacity 0.3s' }}>●</span>
                <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.08em' }}>
                  {enrichPhase.done}/{enrichPhase.total} enriquecidas...
                </span>
              </div>
            )}
            {enrichPhase.phase === 'done' && (
              <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.tertiary, letterSpacing: '0.08em' }}>
                ✓ {enrichPhase.enriched}/{enrichPhase.total} m² actualizadas
              </div>
            )}

            <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, letterSpacing: '0.12em', marginTop: '24px', marginBottom: '12px' }}>
              DEDUPLICACIÓN
            </div>
            {dedupPhase.phase === 'idle' && (
              <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.border, letterSpacing: '0.1em' }}>· pendiente...</div>
            )}
            {dedupPhase.phase === 'done' && (
              <div style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.tertiary, letterSpacing: '0.08em' }}>
                ✓ {dedupPhase.removed > 0 ? `${dedupPhase.removed} duplicados eliminados` : 'sin duplicados'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Results table — when not running */}
      {!running && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {!hasSignals ? (
            <div style={{ padding: '32px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
              Sin señales. Ejecuta un scan para buscar nuevas propiedades.
            </div>
          ) : displayed.length === 0 ? (
            <div style={{ padding: '32px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>
              Sin resultados con los filtros actuales.
            </div>
          ) : (
            <>
            {/* Zone summary bar — one chip per municipio */}
            {(() => {
              const byZone: Record<string, { count: number; ppsqms: number[] }> = {}
              for (const s of displayed) {
                const z = s.municipioName || 'Sin zona'
                if (!byZone[z]) byZone[z] = { count: 0, ppsqms: [] }
                byZone[z].count++
                if (s.ppsqm > 0) byZone[z].ppsqms.push(s.ppsqm)
              }
              const zones = Object.entries(byZone).sort((a, b) => b[1].count - a[1].count)
              if (zones.length <= 1) return null
              return (
                <div style={{ display: 'flex', gap: '8px', padding: '10px 16px', borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
                  {zones.map(([name, info]) => {
                    const sorted = [...info.ppsqms].sort((a, b) => a - b)
                    const med = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0
                    return (
                      <div key={name} style={{ fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.07em', color: colors.secondary, border: `1px solid ${colors.border}`, padding: '4px 8px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ color: colors.neutral }}>{name}</span>
                        <span style={{ color: colors.border }}>·</span>
                        <span>{info.count}</span>
                        {med > 0 && (
                          <>
                            <span style={{ color: colors.border }}>·</span>
                            <span>{fmtPpsqm(med)}/m²</span>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <th style={{ ...TH, textAlign: 'center', width: '52px' }} onClick={() => toggleSort('score')}>SCORE <SortMark col="score" sort={sort} /></th>
                  <th style={{ ...TH, textAlign: 'left' }}  onClick={() => toggleSort('portal')}>PORTAL <SortMark col="portal" sort={sort} /></th>
                  <th style={{ ...TH, textAlign: 'left' }}  onClick={() => toggleSort('title')}>PROPIEDAD <SortMark col="title" sort={sort} /></th>
                  <th style={{ ...TH, textAlign: 'left' }}>COLONIA</th>
                  <th style={{ ...TH, textAlign: 'right' }} onClick={() => toggleSort('price')}>PRECIO <SortMark col="price" sort={sort} /></th>
                  <th style={{ ...TH, textAlign: 'right' }} onClick={() => toggleSort('sqmLand')}>M² <SortMark col="sqmLand" sort={sort} /></th>
                  <th style={{ ...TH, textAlign: 'right' }} onClick={() => toggleSort('ppsqm')}>$/M² <SortMark col="ppsqm" sort={sort} /></th>
                  <th style={{ ...TH, textAlign: 'right' }}>VS MUN</th>
                  <th style={{ padding: '6px 10px', width: '160px' }} />
                </tr>
              </thead>
              <tbody>
                {displayed.map(s => {
                  const imported = importedUrls.has(s.url)
                  const priceChanged = s.lastPrice !== null && s.lastPrice !== s.price
                  const priceDrop    = priceChanged && s.lastPrice! > s.price
                  return (
                    <tr key={s.url} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '5px 10px', textAlign: 'center' }}><ScoreBadge score={s.score} /></td>
                      <td style={{ padding: '5px 10px' }}>
                        <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.portal}</span>
                        {s.municipioName && (
                          <div style={{ marginTop: '2px' }}>
                            <span style={{ fontFamily: fonts.label, fontSize: '8px', letterSpacing: '0.06em', color: colors.primary, border: `1px solid ${colors.primary}`, padding: '1px 4px', opacity: 0.7 }}>{s.municipioName}</span>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '5px 10px', maxWidth: '260px' }}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{s.title}</a>
                        {s.address && <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '10px', marginTop: '1px' }}>{s.address}</div>}
                      </td>
                      <td style={{ padding: '5px 10px', maxWidth: '140px' }}>
                        {s.colonia
                          ? <span style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                              {s.colonia.length > 20 ? `${s.colonia.slice(0, 20)}…` : s.colonia}
                            </span>
                          : <span style={{ color: colors.border, fontFamily: fonts.label, fontSize: '10px' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                        <span style={{ color: colors.neutral, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(s.price)}</span>
                        {priceChanged && (
                          <div style={{ marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px' }}>
                            <span style={{ fontSize: '9px', color: priceDrop ? colors.primary : 'tomato' }}>
                              {priceDrop ? '↓' : '↑'}
                            </span>
                            <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textDecoration: 'line-through', opacity: 0.7 }}>
                              {fmtM(s.lastPrice!)}
                            </span>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{s.sqmLand > 0 ? s.sqmLand.toLocaleString('es-MX') : '—'}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{fmtPpsqm(s.ppsqm)}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: fonts.label, fontSize: '11px' }}>
                        {(() => {
                          const median = s.municipioName ? zoneMedians[s.municipioName] : undefined
                          if (!median || !s.ppsqm) return <span style={{ color: colors.border }}>—</span>
                          const pct = ((s.ppsqm - median) / median) * 100
                          const cheaper = pct < 0
                          return (
                            <span style={{ color: cheaper ? colors.primary : 'tomato' }}>
                              {cheaper ? '' : '+'}{pct.toFixed(0)}%
                            </span>
                          )
                        })()}
                      </td>
                      <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                          <button onClick={() => handleDismiss(s.url)} title="Descartar" style={{ background: 'none', border: 'none', color: colors.secondary, cursor: 'pointer', fontFamily: fonts.label, fontSize: '13px', lineHeight: 1, padding: '2px 4px', opacity: 0.5 }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}>
                            ✕
                          </button>
                          {imported
                            ? <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.primary, letterSpacing: '0.08em' }}>GUARDADA</span>
                            : <button onClick={() => handleImport(s)} style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '3px 8px' }}>
                                GUARDAR OPORTUNIDAD
                              </button>
                          }
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </>
          )}
        </div>
      )}
    </div>
  )
}
