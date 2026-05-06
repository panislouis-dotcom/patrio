import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { fetchSignals, runSonarScan, dismissSignal, importSignal } from '../lib/api'
import type { Signal } from '../lib/types'
import { colors, fonts } from '../lib/theme'

// Status filter tabs
type StatusFilter = 'new' | 'dismissed' | 'imported' | 'all'

function fmtM(n: number) { return n ? `$${(n / 1_000_000).toFixed(1)}M` : '—' }
function fmtK(n: number) { return n ? `$${(n / 1_000).toFixed(0)}k` : '—' }

export function SonarTab() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('new')
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<{ new: number; scanned: number } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  function refresh() { setRefreshKey(k => k + 1) }

  useEffect(() => {
    setLoading(true)
    fetchSignals(statusFilter === 'all' ? undefined : statusFilter)
      .then(setSignals)
      .finally(() => setLoading(false))
  }, [statusFilter, refreshKey])

  async function handleScan() {
    setScanning(true)
    setScanResult(null)
    try {
      const result = await runSonarScan()
      setScanResult({ new: result.new, scanned: result.scanned })
      refresh()
    } catch (_e) {
      // scan errors are shown per-portal in the result — fail silently here
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

  // Status filter tabs
  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'new', label: 'NUEVAS' },
    { key: 'imported', label: 'IMPORTADAS' },
    { key: 'dismissed', label: 'DESCARTADAS' },
    { key: 'all', label: 'TODAS' },
  ]

  const tabStyle = (active: boolean): CSSProperties => ({
    padding: '8px 16px',
    fontFamily: fonts.label,
    fontSize: '10px',
    letterSpacing: '0.1em',
    color: active ? colors.neutral : colors.secondary,
    borderTop: 'none',
    borderLeft: 'none',
    borderRight: 'none',
    borderBottom: active ? `2px solid ${colors.tertiary}` : '2px solid transparent',
    cursor: 'pointer',
    background: 'none',
  })

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

      {/* Status filter tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}` }}>
        {STATUS_TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setStatusFilter(key)} style={tabStyle(statusFilter === key)}>
            {label}
          </button>
        ))}
      </div>

      {/* Signals table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '32px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Cargando…</div>
        ) : signals.length === 0 ? (
          <div style={{ padding: '32px', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>Sin señales{statusFilter !== 'all' ? ` en estado "${statusFilter}"` : ''}.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: colors.dark, zIndex: 10 }}>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'left' }}>PORTAL</th>
                <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'left' }}>PROPIEDAD</th>
                <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'right' }}>PRECIO</th>
                <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'right' }}>M²</th>
                <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'right' }}>$/M²</th>
                <th style={{ padding: '6px 10px', fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'right' }}>FECHA</th>
                <th style={{ padding: '6px 10px', width: '120px' }} />
              </tr>
            </thead>
            <tbody>
              {signals.map(s => {
                const isDismissed = s.status === 'dismissed'
                const isImported = s.status === 'imported'
                const pricePerSqm = s.price > 0 && s.sqmLand > 0 ? s.price / s.sqmLand : 0
                const dateLabel = s.scrapedAt ? s.scrapedAt.slice(0, 10) : '—'
                const rowOpacity = isDismissed ? 0.4 : 1

                return (
                  <tr
                    key={s.id}
                    style={{ borderBottom: `1px solid ${colors.border}`, opacity: rowOpacity }}
                  >
                    {/* Portal */}
                    <td style={{ padding: '5px 10px' }}>
                      <span style={{ fontFamily: fonts.label, fontSize: '9px', color: colors.secondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.portal}</span>
                    </td>
                    {/* Title + address */}
                    <td style={{ padding: '5px 10px', maxWidth: '280px' }}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: colors.neutral, fontFamily: fonts.sans, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{s.title}</a>
                      {s.address && <div style={{ color: colors.secondary, fontFamily: fonts.label, fontSize: '10px', marginTop: '1px' }}>{s.address}</div>}
                    </td>
                    {/* Precio */}
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.neutral, fontFamily: fonts.label, fontSize: '11px' }}>{fmtM(s.price)}</td>
                    {/* M² */}
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{s.sqmLand > 0 ? s.sqmLand.toLocaleString('es-MX') : '—'}</td>
                    {/* $/M² */}
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '11px' }}>{pricePerSqm > 0 ? fmtK(pricePerSqm) : '—'}</td>
                    {/* Fecha */}
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: colors.secondary, fontFamily: fonts.label, fontSize: '10px' }}>{dateLabel}</td>
                    {/* Actions */}
                    <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                      {!isDismissed && !isImported && (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleImport(s)}
                            style={{ background: colors.primary, border: 'none', color: colors.neutral, cursor: 'pointer', fontFamily: fonts.label, fontSize: '9px', letterSpacing: '0.08em', padding: '3px 8px' }}
                          >
                            IMPORTAR
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
