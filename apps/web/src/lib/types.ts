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

export type MemberRole = 'director' | 'responsable_proyecto' | 'lider_proyecto' | 'maestro' | 'ayudante'

export interface TeamMember {
  id: number
  name: string
  role: MemberRole
  managerId: number | null
  notes: string
  createdAt: string
}

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
  createdAt: string
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
