import { describe, it, expect } from 'vitest'
import { validateRaw } from './validateRaw'

const VALID: Parameters<typeof validateRaw>[0] = {
  latitude: 25.6866,
  longitude: -100.3161,
  purchasePrice: 5_000_000,
  sqmLand: 200,
  sqmConstruction: 180,
  constructionCostPerSqm: 15_000,
  constructionOverhead: 1.3,
  projectedSale: 9_000_000,
  rentMonthlyProjected: 25_000,
  holdMonths: 18,
}

describe('validateRaw', () => {
  it('returns no issues for valid input', () => {
    expect(validateRaw(VALID)).toHaveLength(0)
  })

  it('errors on zero latitude', () => {
    const issues = validateRaw({ ...VALID, latitude: 0 })
    expect(issues.some(i => i.field === 'latitude' && i.severity === 'error')).toBe(true)
  })

  it('errors on zero longitude', () => {
    const issues = validateRaw({ ...VALID, longitude: 0 })
    expect(issues.some(i => i.field === 'longitude' && i.severity === 'error')).toBe(true)
  })

  it('errors on zero purchasePrice', () => {
    const issues = validateRaw({ ...VALID, purchasePrice: 0 })
    expect(issues.some(i => i.field === 'purchasePrice' && i.severity === 'error')).toBe(true)
  })

  it('errors on zero sqmLand', () => {
    const issues = validateRaw({ ...VALID, sqmLand: 0 })
    expect(issues.some(i => i.field === 'sqmLand' && i.severity === 'error')).toBe(true)
  })

  it('el overhead ya no se valida: dejó de ser una regla que alguien pueda violar', () => {
    // Era un `error` que bloqueaba el alta, más estricto que el
    // `CHECK (construction_overhead >= 0)` de la base, y sin ninguna regla del
    // servidor detrás desde que el multiplicador salió del contrato: `checks.py`
    // lo retiró a propósito. Dos definiciones de «bien capturado» es lo que este
    // archivo existe para no tener.
    for (const overhead of [0.8, 1.0, undefined]) {
      expect(validateRaw({ ...VALID, constructionOverhead: overhead })).toHaveLength(0)
    }
  })

  it('avisa por la obra en cero, no por el campo que ya no se captura', () => {
    // El costo por m² es hoy un RESULTADO —presupuesto ÷ metraje—, así que
    // pedirlo era pedir que se tecleara un derivado. Lo que sí importa al dar de
    // alta es que la calculadora produzca algo: sin metraje o sin precio por m²
    // la propiedad nace con la obra en cero.
    for (const roto of [{ sqmConstruction: 0 }, { constructionCostPerSqm: 0 }]) {
      const issues = validateRaw({ ...VALID, ...roto })
      expect(issues).toEqual([{
        field: 'constructionBudgeted',
        message: 'La obra presupuestada está en 0',
        severity: 'warning',
      }])
    }
  })

  it('el aviso dice exactamente lo que dirá el servidor en cuanto la fila exista', () => {
    // Espeja `checks.py::_pre_purchase_warnings` al pie de la letra: mismo
    // `field` y misma frase. Si divergen, el formulario y la ficha nombran el
    // mismo problema de dos maneras y parecen dos problemas.
    const [aviso] = validateRaw({ ...VALID, constructionCostPerSqm: 0 })
    expect(aviso.field).toBe('constructionBudgeted')
    expect(aviso.message).toBe('La obra presupuestada está en 0')
    // Y el nombre viejo no sobrevive en ningún lado
    expect(validateRaw({}).some(i => i.field === 'constructionCostPerSqm')).toBe(false)
  })
})
