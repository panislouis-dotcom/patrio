import type { Prospect, ScoreWeights } from './types'

function percentileRank(value: number, allValues: number[]): number {
  if (allValues.length <= 1) return 0.5
  const below = allValues.filter(v => v < value).length
  const ties = allValues.filter(v => v === value).length
  return (below + 0.5 * ties) / allValues.length
}

export function computeScores(
  prospects: Prospect[],
  weights: ScoreWeights
): Prospect[] {
  const rois = prospects.map(p => p.roi)
  const capRates = prospects.map(p => p.capRate)
  const profits = prospects.map(p => p.profit)

  return prospects.map(p => {
    const score =
      percentileRank(p.roi, rois) * weights.roi +
      percentileRank(p.capRate, capRates) * weights.capRate +
      percentileRank(p.profit, profits) * weights.profit
    return { ...p, score: Math.round(score * 100) }
  })
}

export const DEFAULT_WEIGHTS: ScoreWeights = { roi: 0.5, capRate: 0.3, profit: 0.2 }
