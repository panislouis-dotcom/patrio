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
  // La obra ya no se captura por m²: se presupuesta por partidas, y el costo por
  // m² es hoy un RESULTADO —presupuesto ÷ metraje—. Pedirlo aquí era pedir que
  // se tecleara un derivado, la misma forma que «INVERSIÓN CAPTURADA · NO SE
  // USA» tenía en la ficha.
  //
  // Lo que sí importa al dar de alta es que la CALCULADORA produzca algo: sus
  // dos factores —metraje y precio por m²— arrancan el presupuesto, y sin
  // alguno de los dos la propiedad nace con la obra en cero. Así que el aviso
  // se queda, pero nombra la consecuencia en vez del campo, con el mismo
  // `field` y la misma frase que `checks.py` va a usar en cuanto la fila
  // exista. Dos definiciones de «bien capturado» es lo que este archivo evita.
  //
  // El overhead ya no se valida, y no es un descuido. Era un `error` que
  // bloqueaba el alta, más estricto que el `CHECK (construction_overhead >= 0)`
  // de la base y sin ninguna regla del servidor detrás desde que el
  // multiplicador dejó de vivir en el contrato.
  if (!fields.sqmConstruction || !fields.constructionCostPerSqm) {
    issues.push({ field: 'constructionBudgeted', message: 'La obra presupuestada está en 0', severity: 'warning' })
  }
  if (!fields.projectedSale) {
    issues.push({ field: 'projectedSale', message: 'Venta proyectada sin capturar: sin ella no hay ROI ni ganancia', severity: 'warning' })
  }
  if (!fields.rentMonthlyProjected) {
    issues.push({ field: 'rentMonthlyProjected', message: 'Renta mensual estimada sin capturar: sin ella no hay cap rate', severity: 'warning' })
  }
  return issues
}
