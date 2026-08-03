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

  it('errors on constructionOverhead below 1.0', () => {
    const issues = validateRaw({ ...VALID, constructionOverhead: 0.8 })
    expect(issues.some(i => i.field === 'constructionOverhead' && i.severity === 'error')).toBe(true)
  })

  it('does not error on constructionOverhead exactly 1.0', () => {
    expect(validateRaw({ ...VALID, constructionOverhead: 1.0 })).toHaveLength(0)
  })

  it('does not error on missing optional fields', () => {
    expect(validateRaw({ ...VALID, constructionOverhead: undefined })).toHaveLength(0)
  })
})
