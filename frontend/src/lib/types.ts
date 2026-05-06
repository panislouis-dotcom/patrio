export interface Issue {
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface Prospect {
  id: number
  name: string
  address: string
  city: string
  status: string
  url: string
  latitude: number
  longitude: number
  sqmLand: number
  sqmConstruction: number
  landPrice: number
  acquisitionCostPct: number
  acquisitionCosts: number
  acquisitionTotal: number
  permitsCost: number
  subdivisionCost: number
  constructionBase: number
  constructionTotal: number
  constructionCostPerSqm: number
  constructionOverhead: number
  totalInvestment: number
  projectedSale: number
  profit: number
  roi: number
  capRate: number
  landPricePerSqm: number
  salePerSqm: number
  investmentPerSqm: number
  rentMonthly: number
  rentAnnual: number
  investmentDate: string
  saleDate: string
  notes: string
  score: number
  issues: Issue[]
}

export interface ScoreWeights {
  roi: number       // 0-1
  capRate: number   // 0-1
  profit: number    // 0-1
}

export interface QualityEntry {
  id: number
  name: string
  issues: Issue[]
}
