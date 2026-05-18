import { describe, it, expect } from 'vitest'
import { computeScores } from './scoring'
import type { Prospect, ScoreWeights } from './types'

const weights: ScoreWeights = { roi: 0.5, capRate: 0.3, profit: 0.2 }

function makeProspect(overrides: Partial<Prospect>): Prospect {
  return {
    id: 1, name: 'Test', address: '', city: '', status: 'evaluating', type: '', url: '',
    latitude: 25.68, longitude: -100.33, sqmLand: 100, sqmConstruction: 100,
    landPrice: 3000000, acquisitionCostPct: 0.06, acquisitionCosts: 0,
    acquisitionTotal: 0, permitsCost: 0, subdivisionCost: 0, constructionBase: 0,
    constructionTotal: 0, constructionCostPerSqm: 6000, constructionOverhead: 1.3,
    totalInvestment: 0, projectedSale: 0, profit: 1000000, roi: 0.25,
    capRate: 0.07, landPricePerSqm: 0, salePerSqm: 0, investmentPerSqm: 0,
    rentMonthly: 20000, rentAnnual: 0, holdMonths: 18,
    notes: '', isFavorite: false, images: [], score: 0, issues: [],
    ...overrides,
  }
}

describe('computeScores', () => {
  it('returns a score for each prospect', () => {
    const prospects = [makeProspect({ id: 1 }), makeProspect({ id: 2 })]
    const result = computeScores(prospects, weights)
    expect(result).toHaveLength(2)
    expect(result[0].score).toBeGreaterThanOrEqual(0)
    expect(result[0].score).toBeLessThanOrEqual(100)
  })

  it('higher ROI gets higher score when roi weight is 1', () => {
    const low = makeProspect({ id: 1, roi: 0.1, capRate: 0.05, profit: 500000 })
    const high = makeProspect({ id: 2, roi: 0.5, capRate: 0.05, profit: 500000 })
    const result = computeScores([low, high], { roi: 1, capRate: 0, profit: 0 })
    const lowScore = result.find(p => p.id === 1)!.score
    const highScore = result.find(p => p.id === 2)!.score
    expect(highScore).toBeGreaterThan(lowScore)
  })

  it('single prospect gets score of 50', () => {
    const result = computeScores([makeProspect({ id: 1 })], weights)
    expect(result[0].score).toBe(50)
  })
})
