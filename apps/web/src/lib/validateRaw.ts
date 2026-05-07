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
    issues.push({ field: 'sqmLand', message: 'Metros cuadrados requeridos', severity: 'error' })
  }
  if (fields.constructionOverhead !== undefined && fields.constructionOverhead < 1.0) {
    issues.push({ field: 'constructionOverhead', message: 'Factor de overhead debe ser ≥ 1.0', severity: 'error' })
  }
  return issues
}
