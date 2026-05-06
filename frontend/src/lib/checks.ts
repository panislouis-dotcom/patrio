import type { Issue, Prospect } from './types'

export function runChecks(p: Prospect): Issue[] {
  const issues: Issue[] = []
  const today = new Date().toISOString().slice(0, 10)

  // Errors
  if (!p.latitude) issues.push({ field: 'latitude', message: 'Latitud es 0 o faltante', severity: 'error' })
  if (!p.longitude) issues.push({ field: 'longitude', message: 'Longitud es 0 o faltante', severity: 'error' })
  if (!p.landPrice) issues.push({ field: 'landPrice', message: 'Precio de terreno es 0', severity: 'error' })
  if (!p.sqmLand) issues.push({ field: 'sqmLand', message: 'Superficie terreno es 0', severity: 'error' })
  if (p.roi < 0) issues.push({ field: 'roi', message: `ROI negativo (${(p.roi * 100).toFixed(1)}%)`, severity: 'error' })
  if (p.saleDate && p.investmentDate && p.saleDate <= p.investmentDate)
    issues.push({ field: 'saleDate', message: `Fecha venta ≤ fecha inversión`, severity: 'error' })
  if (p.constructionOverhead < 1.0)
    issues.push({ field: 'constructionOverhead', message: `Overhead ${p.constructionOverhead} < 1.0`, severity: 'error' })

  // Warnings
  if (!p.constructionCostPerSqm)
    issues.push({ field: 'constructionCostPerSqm', message: 'Costo construcción/m² es 0', severity: 'warning' })
  if (!p.rentMonthly)
    issues.push({ field: 'rentMonthly', message: 'Renta mensual proyectada es 0', severity: 'warning' })
  if (p.acquisitionCostPct > 0.10)
    issues.push({ field: 'acquisitionCostPct', message: `Costos adquisición altos (${(p.acquisitionCostPct * 100).toFixed(1)}%)`, severity: 'warning' })
  if (p.investmentDate && p.investmentDate < today)
    issues.push({ field: 'investmentDate', message: `Fecha inversión ya pasó (${p.investmentDate})`, severity: 'warning' })
  if (p.profit < 500_000)
    issues.push({ field: 'profit', message: `Profit < $500k (${p.profit.toLocaleString('es-MX')} MXN)`, severity: 'warning' })

  return issues
}
