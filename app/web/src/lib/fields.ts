/**
 * El nombre de cada campo del API, dicho como lo dice `docs/glosario.md`.
 *
 * CALIDAD DE DATOS imprimía el identificador en mayúsculas — `VALUATIONDATE`,
 * `RENTMONTHLYACTUAL` —, lo único en inglés de una ficha en español, y encima
 * pegado: hay que despegar «valuation date» mentalmente antes de entender qué
 * falta. El mensaje del issue ya viene en español desde `checks.py`; lo que le
 * faltaba era que su etiqueta también lo estuviera.
 *
 * La lista cubre todos los `field` que `checks.py` puede emitir. Un test lo
 * verifica contra el propio `checks.py`, así que un issue nuevo sin etiqueta
 * rompe la suite en vez de publicar un identificador.
 */
export const FIELD_LABEL: Record<string, string> = {
  // Ubicación
  latitude: 'Latitud',
  longitude: 'Longitud',

  // Insumos de captura
  purchasePrice: 'Precio de compra',
  sqmLand: 'Superficie de terreno',
  constructionCostPerSqm: 'Costo por m² de la obra a ejecutar',
  projectedSale: 'Venta proyectada',
  rentMonthlyProjected: 'Renta mensual estimada',
  rentMonthlyActual: 'Renta mensual cobrada',

  // Supuestos
  acquisitionCostPct: 'Costos de adquisición (%)',
  constructionOverhead: 'Overhead de obra',
  holdMonths: 'Plazo proyectado',

  // Inversión
  totalInvestmentCaptured: 'Inversión capturada',

  // Hechos posteriores a la compra
  totalUnits: 'Unidades',
  acquisitionDate: 'Fecha de adquisición',
  firstRentDate: 'Fecha de la primera renta',
  valuationDate: 'Fecha de valuación',
  currentValuation: 'Valuación',
  saleDate: 'Fecha de venta',
  salePrice: 'Precio de venta',

  // Métricas
  projectedRoi: 'ROI proy. anual',
  projectedProfit: 'Ganancia proyectada',
  capRateActual: 'Cap rate real sobre inversión',
}

/** La etiqueta del campo, o el identificador si alguien agregó uno sin nombre. */
export const fieldLabel = (field: string): string => FIELD_LABEL[field] ?? field
