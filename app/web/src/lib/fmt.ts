export function fmtPct(n: number | null | undefined): string {
  return n != null && n !== 0 ? `${(n * 100).toFixed(1)}%` : '—'
}

export function fmtM(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`
  return `$${Math.round(n)}`
}

export function fmtMXN(n: number | null | undefined): string {
  if (n == null || n === 0) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
