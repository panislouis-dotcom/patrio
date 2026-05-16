import type { Issue, RawFields } from './types'

export function validateRaw(fields: Partial<RawFields>): Issue[] {
  const issues: Issue[] = []

  if (!fields.latitude || fields.latitude === 0) {
    issues.push({ field: 'latitude', message: 'Latitud requerida', severity: 'error' })
  }
  if (!fields.longitude || fields.longitude === 0) {
    issues.push({ field: 'longitude', message: 'Longitud requerida', severity: 'error' })
  }
  if (!fields.landPrice || fields.landPrice === 0) {
    issues.push({ field: 'landPrice', message: 'Precio de terreno requerido', severity: 'error' })
  }
  if (!fields.sqmLand || fields.sqmLand === 0) {
    issues.push({ field: 'sqmLand', message: 'Metros cuadrados de terreno requeridos', severity: 'error' })
  }
  if (!fields.sqmConstruction || fields.sqmConstruction === 0) {
    issues.push({ field: 'sqmConstruction', message: 'Metros cuadrados de construcción requeridos', severity: 'warning' })
  }
  if ((fields.sqmConstruction ?? 0) > 0 && (!fields.constructionCostPerSqm || fields.constructionCostPerSqm === 0)) {
    issues.push({ field: 'constructionCostPerSqm', message: 'Costo/m² de construcción requerido para calcular inversión', severity: 'error' })
  }
  if (!fields.projectedSale || fields.projectedSale === 0) {
    issues.push({ field: 'projectedSale', message: 'Venta proyectada requerida para calcular ROI y profit', severity: 'error' })
  }
  if (!fields.rentMonthly || fields.rentMonthly === 0) {
    issues.push({ field: 'rentMonthly', message: 'Renta mensual requerida para calcular cap rate', severity: 'error' })
  }
  if (fields.constructionOverhead !== undefined && fields.constructionOverhead < 1.0) {
    issues.push({ field: 'constructionOverhead', message: 'Factor de overhead debe ser ≥ 1.0', severity: 'error' })
  }
  return issues
}
