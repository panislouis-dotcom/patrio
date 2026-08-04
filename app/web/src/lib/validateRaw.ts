import type { Issue, PropertyCreate } from './types'

/**
 * Lo que le falta a una captura ANTES de que exista la fila. Espeja las reglas
 * de pre-compra de checks.py: una propiedad recién dada de alta nace prospecto,
 * así que el formulario avisa exactamente de lo mismo que el servidor le va a
 * marcar en cuanto se guarde — nada de dos definiciones de "bien capturado".
 *
 * La venta proyectada no es error aquí: se vuelve obligatoria al pasar a oferta,
 * y ese gate lo cobra la transición. La renta vacía tampoco: vacía significa
 * "sin capturar", que es una advertencia, no una mentira.
 */
export function validateRaw(fields: Partial<PropertyCreate>): Issue[] {
  const issues: Issue[] = []

  if (!fields.latitude) {
    issues.push({ field: 'latitude', message: 'Latitud requerida', severity: 'error' })
  }
  if (!fields.longitude) {
    issues.push({ field: 'longitude', message: 'Longitud requerida', severity: 'error' })
  }
  if (!fields.purchasePrice) {
    issues.push({ field: 'purchasePrice', message: 'Precio de compra requerido', severity: 'error' })
  }
  if (!fields.sqmLand) {
    issues.push({ field: 'sqmLand', message: 'Superficie de terreno (m²) requerida', severity: 'error' })
  }
  if (fields.constructionOverhead !== undefined && fields.constructionOverhead < 1.0) {
    issues.push({ field: 'constructionOverhead', message: 'Factor de overhead debe ser ≥ 1.0', severity: 'error' })
  }

  if (!fields.constructionCostPerSqm) {
    issues.push({ field: 'constructionCostPerSqm', message: 'Costo de la obra a ejecutar por m² sin capturar', severity: 'warning' })
  }
  if (!fields.projectedSale) {
    issues.push({ field: 'projectedSale', message: 'Venta proyectada sin capturar: sin ella no hay ROI ni ganancia', severity: 'warning' })
  }
  if (!fields.rentMonthlyProjected) {
    issues.push({ field: 'rentMonthlyProjected', message: 'Renta mensual estimada sin capturar: sin ella no hay cap rate', severity: 'warning' })
  }
  return issues
}
