// Espeja el CHECK de properties.asset_type en la migración 024.
export const ASSET_TYPES = ['casa', 'departamento', 'local', 'edificio', 'lote', 'bodega'] as const
export const ASSET_TYPE_LABEL: Record<string, string> = {
  casa: 'Casa', departamento: 'Departamento', local: 'Local',
  edificio: 'Edificio', lote: 'Lote', bodega: 'Bodega',
}

// Espeja el CHECK de properties.strategy_type.
export const STRATEGY_TYPES = ['adaptive_reuse', 'ground_up', 'flip', 'hold'] as const
export const STRATEGY_TYPE_LABEL: Record<string, string> = {
  adaptive_reuse: 'Reconversión', ground_up: 'Obra nueva',
  flip: 'Flip', hold: 'Renta',
}

import type { PropertyStatus } from './status'
export type { PropertyStatus }

export interface PropertyImage {
  id: number
  filePath: string
  fileName: string
  contentType: string
  sortOrder: number
  uploadedAt: string
  imageType: ImageType
}

// 'general' es la foto de cualquier etapa; antes/despues solo cobran sentido
// cuando hubo obra.
export type ImageType = 'general' | 'antes' | 'despues'

export interface Issue {
  field: string
  message: string
  severity: 'error' | 'warning'
}

// Una propiedad recorre un ciclo de vida (ver lib/status.ts). Los campos
// existen según la etapa: los CRUDOS siempre se devuelven tal como están en la
// base — nunca se blanquean, porque en pasos posteriores quieres ver todo lo de
// antes. Las métricas DERIVADAS sí se apagan (null) cuando su insumo ya no
// aplica: proyectar el futuro de algo vendido es mentir.
export interface Property {
  id: number
  status: PropertyStatus
  name: string
  assetType: string          // qué es: casa, departamento, local, edificio, lote, bodega
  strategyType: string | null // cómo se gana: adaptive_reuse, ground_up, flip, hold
  address: string
  city: string
  url: string
  latitude: number
  longitude: number
  notes: string
  isFavorite: boolean
  createdAt: string
  updatedAt: string
  images: PropertyImage[]
  geometry: Record<string, unknown>
  milestones: Record<string, string>   // {"YYYY-MM": "label"}

  // --- Insumos de underwriting (capturables desde prospecto) ---
  sqmLand: number | null
  sqmConstruction: number | null
  landPrice: number | null
  acquisitionCostPct: number | null
  permitsCost: number | null
  subdivisionCost: number | null
  constructionCostPerSqm: number | null
  constructionOverhead: number | null
  projectedSale: number | null
  holdMonths: number | null
  rentMonthly: number | null

  // --- Base de capital (viva en toda etapa: es historia, no proyección) ---
  totalInvestment: number | null
  investmentBasis: 'underwriting' | 'manual' | null

  // --- Datos que solo existen tras comprar ---
  totalUnits: number | null
  acquisitionDate: string | null   // YYYY-MM-DD
  firstRentDate: string | null     // primera renta REAL, nunca planeada
  valuationDate: string | null
  currentValuation: number | null
  saleDate: string | null
  salePrice: number | null

  // --- Métricas de proyección (prospecto → en_renta; null al vender) ---
  acquisitionCosts: number | null
  acquisitionTotal: number | null
  constructionBase: number | null
  constructionTotal: number | null
  landPricePerSqm: number | null
  salePerSqm: number | null
  investmentPerSqm: number | null
  projectedProfit: number | null
  projectedRoi: number | null
  projectedRoiTotal: number | null
  capRate: number | null      // yield on cost — vive desde prospecto
  rentAnnual: number | null

  // --- Métricas realizadas (desde desarrollo; null al vender) ---
  unrealizedGain: number | null
  unrealizedGainPct: number | null
  roi: number | null                // CAGR contra la valuación actual
  holdMonthsActual: number | null   // congelado al vender

  // --- Resultado final (solo vendida) ---
  realizedGain: number | null
  realizedGainPct: number | null
  realizedRoi: number | null

  // --- Calculados por el servidor (única casa) ---
  score: number | null    // solo prospecto/oferta
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

// Lo que un PATCH puede escribir: nunca `status` (eso es una transición) y
// nunca un null (vaciar es clear-fields).
export type RawPropertyFields = Pick<Property,
  | 'name' | 'assetType' | 'strategyType' | 'address' | 'city' | 'url'
  | 'latitude' | 'longitude' | 'notes'
  | 'sqmLand' | 'sqmConstruction' | 'landPrice' | 'acquisitionCostPct'
  | 'permitsCost' | 'subdivisionCost' | 'constructionCostPerSqm'
  | 'constructionOverhead' | 'projectedSale' | 'holdMonths' | 'rentMonthly'
  | 'totalUnits' | 'acquisitionDate' | 'firstRentDate' | 'valuationDate'
  | 'totalInvestment' | 'currentValuation' | 'saleDate' | 'salePrice'
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

export interface ParsedProperty {
  name:             string
  address:          string
  city:             string
  type:             string
  price:            number   // total asking price → maps to landPrice on save
  sqmLand:          number
  sqmConstruction:  number
  notes:            string
  url:              string
  status:           string
  latitude:         number
  longitude:        number
  municipioCve:     string
  municipioName:    string
  colonia:          string
  stateName:        string
}

export interface SonarZone  { cve: string; name: string }
export interface SonarState { name: string; municipios: SonarZone[] }

export interface SonarSignal {
  id:            number
  url:           string
  portal:        string
  title:         string
  address:       string
  municipioCve:  string
  municipioName: string
  colonia:       string
  stateName:     string
  lat:           number | null
  lon:           number | null
  price:         number
  sqmLand:       number
  lastPrice:     number | null
  firstSeen:     string | null
  lastSeen:      string | null
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
  supplierCategoryId: number | null
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
  propertyId: number | null
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
  supplierId: number | null
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
  propertyId: number | null
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

export type InvestorTemperatura = 'caliente' | 'tibio' | 'frio'
export type InvestorCapacidad = '<500k' | '500k-2M' | '2M-5M' | '5M+'
export type InvestorFuente = 'red_personal' | 'referido' | 'red_negocios' | 'linkedin' | 'otro'
export type InvestorConfianza = 'bajo' | 'medio' | 'alto'

export interface Investor {
  id: number
  name: string
  apellidos: string
  email: string
  phone: string
  notes: string
  temperatura: InvestorTemperatura | null
  capacidad: InvestorCapacidad | null
  fuente: InvestorFuente | null
  confianza: InvestorConfianza | null
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

export interface PropertyInvestor {
  id: number
  propertyId: number
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

export interface Zone {
  id: number
  name: string
  cities: string[]
}

export interface Comparable {
  id: number
  address: string
  zoneId: number
  m2: number
  price: number
  pricePerM2: number
  listingUrl: string
  sourcePortal: string
  listedAt: string
  capturedAt: string
  neighborhood: string
  city: string
  lat: number | null
  lng: number | null
  bedrooms: number | null
  bathrooms: number | null
  parkingSpots: number | null
  propertyType: string
  condition: string
  styleTags: string[]
  status: 'active' | 'sold' | 'withdrawn' | 'expired'
  lastCheckedAt: string | null
  lastSeenActive: string
  soldAt: string | null
  checkFailureCount: number
  notes: string
  createdAt: string
}

export interface AnalysisSnapshot {
  id: number
  propertyId: number
  generatedAt: string
  purchasePrice: number
  remodelCostEstimate: number
  remodelCostPerM2: number
  interventionLevel: string
  transactionCosts: number
  financingCosts: number
  totalCost: number
  holdingPeriodMonths: number
  exitPriceManual: number | null
  exitPriceCalculatedLow: number | null
  exitPriceCalculatedMid: number | null
  exitPriceCalculatedHigh: number | null
  exitPriceSource: 'manual' | 'calculated' | 'blended'
  exitPriceUsed: number
  manualVsMarketDeltaPct: number | null
  arvManualOverride: number | null
  comparableCount: number
  comparableIds: number[]
  avgCompDistanceKm: number | null
  grossMargin: number | null
  roiPct: number | null
  irrPct: number | null
  capRatePct: number | null
  confidenceScore: number
  confidenceNotes: string
  dataQualityWarnings: string[]
  rentaMensualEstimada: number | null
  tasaInteresCredito: number | null
  plazoCreditoMeses: number | null
  financiamientoPct: number | null
  gastosOperativosPct: number | null
  noiAnual: number | null
  debtServiceAnual: number | null
  cashFlowAnual: number | null
  cashOnCashYr1Pct: number | null
  breakEvenMonths: number | null
  npv10yr: number | null
  irr10yrPct: number | null
}

export interface AnalysisRequest {
  propertyId: number
  interventionLevel?: string
  holdingPeriodMonths?: number
  transactionCostPct?: number
  exitPriceSource?: 'manual' | 'calculated' | 'blended'
  arvManualOverride?: number | null
  rentaMensualEstimada?: number | null
  financiamientoPct?: number
  tasaInteresCredito?: number
  plazoCreditoMeses?: number
  gastosOperativosPct?: number
}

// ── Proveedores ───────────────────────────────────────────────────────────────

export type ProveedorStatus = 'activo' | 'inactivo' | 'vetado'

export interface ProveedorCategory {
  id: number
  name: string
  description: string
  createdAt: string
}

export interface ProveedorPhoto {
  id: number
  proveedorId: number
  filePath: string
  fileName: string
  contentType: string
  uploadedAt: string
}

export interface Proveedor {
  id: number
  name: string
  phone: string
  email: string
  website: string
  zona: string
  status: ProveedorStatus
  vetoReason: string | null
  ratingCalidad: number | null
  ratingPuntualidad: number | null
  ratingPrecio: number | null
  notes: string
  categories: ProveedorCategory[]
  photos: ProveedorPhoto[]
  createdAt: string
  updatedAt: string
}

export interface Cotizacion {
  id: number
  instanceNodeStateId: number
  proveedorId: number | null
  proveedorNameOverride: string
  proveedorName: string | null
  monto: number
  moneda: 'MXN' | 'USD'
  descripcion: string
  notes: string
  fechaCotizacion: string | null
  validezDias: number | null
  isSelected: boolean
  createdAt: string
  updatedAt: string
}

export interface ProveedorAssignment {
  stateId: number
  instanceId: number
  instanceName: string
  nodeId: number
  nodeName: string
  status: string
}
