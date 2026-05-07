import { describe, it, expect } from 'vitest'
import { runChecks } from './checks'

const valid = {
  latitude: 25.68, longitude: -100.33, landPrice: 3000000, sqmLand: 100,
  roi: 0.25, saleDate: '2028-01-01', investmentDate: '2027-01-01',
  constructionOverhead: 1.3, constructionCostPerSqm: 6000,
  rentMonthly: 20000, acquisitionCostPct: 0.06, profit: 1000000,
}

describe('runChecks', () => {
  it('returns empty array for valid prospect', () => {
    expect(runChecks(valid as any)).toHaveLength(0)
  })

  it('errors on zero latitude', () => {
    const issues = runChecks({ ...valid, latitude: 0 } as any)
    expect(issues.some(i => i.field === 'latitude' && i.severity === 'error')).toBe(true)
  })

  it('errors on negative roi', () => {
    const issues = runChecks({ ...valid, roi: -0.1 } as any)
    expect(issues.some(i => i.field === 'roi' && i.severity === 'error')).toBe(true)
  })

  it('warns on zero rent', () => {
    const issues = runChecks({ ...valid, rentMonthly: 0 } as any)
    expect(issues.some(i => i.field === 'rentMonthly' && i.severity === 'warning')).toBe(true)
  })
})
