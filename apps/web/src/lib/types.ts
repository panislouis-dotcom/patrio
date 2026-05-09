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
  conclusionDate: string       // YYYY-MM (primera renta o venta)
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
  prospectId: number | null
}

export type RawProjectFields = Pick<Project,
  | 'name' | 'type' | 'address' | 'city' | 'status' | 'url'
  | 'latitude' | 'longitude' | 'totalUnits'
  | 'acquisitionDate' | 'conclusionDate'
  | 'totalInvestment' | 'currentValuation' | 'valuationDate'
  | 'notes'
>

export type MemberRole = 'director' | 'responsable_proyecto' | 'lider_proyecto' | 'maestro' | 'ayudante' | 'finder'

export interface TeamMember {
  id: number
  name: string
  role: MemberRole
  managerId: number | null
  email: string
  notes: string
  createdAt: string
}

export interface SonarSignal {
  url: string
  portal: string
  title: string
  address: string
  city: string
  price: number
  sqmLand: number
}

export interface ProcessTemplate {
  id: number
  name: string
  description: string
  createdAt: string
}

export interface TemplateNode {
  id: number
  templateId: number
  parentId: number | null
  name: string
  description: string
  sortOrder: number
  dependsOnId: number | null
  durationDays: number | null
  sourceTemplateId: number | null
  createdAt: string
}

export interface InstanceFile {
  id: number
  instanceId: number
  filePath: string
  fileName: string
  contentType: string
  uploadedAt: string
}

export interface ProcessInstance {
  id: number
  templateId: number | null
  templateName: string | null
  projectId: number | null
  projectName: string | null
  ownerId: number | null
  ownerName: string | null
  taskType: 'proyecto' | 'periodica' | 'one_time'
  name: string
  startDate: string
  dueDate: string | null
  frequencyDays: number | null
  completedAt: string | null
  originInstanceId: number | null
  durationLockedAt: string | null
  status: string
  notes: string
  createdAt: string
}

export interface NodeState {
  id: number
  instanceId: number
  templateNodeId: number
  status: 'pending' | 'in_progress' | 'done' | 'skipped'
  assigneeId: number | null
  actualStart: string | null
  actualEnd: string | null
  notes: string
  updatedAt: string
  durationOverrideDays: number | null
}

export interface GanttNode extends TemplateNode {
  ganttStart: number
  ganttDuration: number
  isDefinir: boolean
}

export interface InstanceDetail {
  instance: ProcessInstance
  nodes: GanttNode[]
  states: NodeState[]
}

export interface NodeFile {
  id: number
  templateNodeId: number
  instanceId: number | null
  filePath: string
  fileName: string
  contentType: string
  type: 'reference' | 'evidence'
  uploadedAt: string
}

export interface NodeComment {
  id: number
  instanceId: number
  templateNodeId: number
  body: string
  author: string
  createdAt: string
}

export interface NodeDetail {
  instance: ProcessInstance
  node: TemplateNode
  allNodes: GanttNode[]
  states: NodeState[]
  files: NodeFile[]
  comments: NodeComment[]
}

export interface ProfitSplitConfig {
  id: number | null
  projectId: number | null
  exitPrice: number | null
  investorCapital: number | null
  investorRateAnnual: number
  investorMonths: number | null
  isrRate: number
  finderFeePct: number
  directorPct: number
  responsablePct: number
  liderPct: number
  maestroPct: number
  ayudantePct: number
  finderMemberId: number | null
  responsableMemberId: number | null
  liderMemberId: number | null
  maestroMemberIds: number[]
  ayudanteMemberIds: number[]
  maestroCount: number | null
  ayudanteCount: number | null
  plannedEndDate: string | null
  actualEndDate: string | null
  bufferDays: number
  notes: string
}

export interface ProfitSplit {
  label: string
  id: number | null
  name: string
  role: string | null
  pct: number
  base: number
  bonus: number
  total: number
}

export interface ProfitScenario {
  splits: ProfitSplit[]
  companyResidual: number
}

export interface InvestorBreakdownEntry {
  investorId: number | null
  name: string
  fundedAmount: number
  interestRateAnnual: number
  cuota: number
  totalReturn: number
}

export interface ProfitWaterfall {
  exitPrice: number
  investment: number
  grossProfit: number
  investorCuota: number
  operatorGross: number
  isr: number
  netProfit: number
  distributable: number
  activeTier: number | null    // null = not concluded yet; 0 | 0.25 | 0.50 when concluded
  months: number
  investorBreakdown: InvestorBreakdownEntry[]
  scenarios: {
    sin_bono: ProfitScenario
    bono_25: ProfitScenario
    bono_50: ProfitScenario
  }
}

export interface Investor {
  id: number
  name: string
  apellidos: string
  email: string
  phone: string
  notes: string
  createdAt: string
  totalInterested: number
  totalCommitted: number
  totalFunded: number
}

export interface User {
  id: number
  email: string
  isActive: boolean
  createdAt: string
}

export interface ProjectInvestor {
  id: number
  projectId: number
  investorId: number
  investorName: string
  projectName: string
  status: 'interesado' | 'comprometido' | 'fondeado'
  interestedAmount: number
  committedAmount: number
  fundedAmount: number
  interestRateAnnual: number
  investmentDate: string | null
  returnAmount: number | null
  returnDate: string | null
  notes: string
  createdAt: string
  // Computed server-side by project_investor_metrics view
  holdMonths: number
  interestAmount: number
  expectedReturn: number
  returnPct: number
}
