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
  holdMonths: number
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

export type RawFields = Pick<Prospect,
  | 'name' | 'address' | 'city' | 'status' | 'url'
  | 'latitude' | 'longitude' | 'sqmLand' | 'sqmConstruction'
  | 'landPrice' | 'acquisitionCostPct' | 'permitsCost' | 'subdivisionCost'
  | 'constructionCostPerSqm' | 'constructionOverhead'
  | 'projectedSale' | 'rentMonthly' | 'holdMonths' | 'notes'
>

export interface Project {
  id: number
  name: string
  type: string
  address: string
  city: string
  status: string
  totalUnits: number
  acquisitionDate: string      // YYYY-MM
  firstRentDate: string        // YYYY-MM
  totalInvestment: number
  currentValuation: number
  valuationDate: string        // YYYY-MM
  url: string
  latitude: number
  longitude: number
  milestones: Record<string, string>   // {"YYYY-MM": "label"}
  budget: Record<string, number>       // {"category": amount}
  notes: string
  unrealizedGain: number
  unrealizedGainPct: number
  holdMonthsActual: number
}

export type RawProjectFields = Pick<Project,
  | 'name' | 'type' | 'address' | 'city' | 'status' | 'url'
  | 'latitude' | 'longitude' | 'totalUnits'
  | 'acquisitionDate' | 'firstRentDate'
  | 'totalInvestment' | 'currentValuation' | 'valuationDate'
  | 'notes'
>

export interface Signal {
  id: number
  portal: string
  url: string
  title: string
  address: string
  city: string
  price: number
  sqmLand: number
  rawData: string
  status: string       // new | dismissed | imported
  prospectId: number | null
  scrapedAt: string
}
