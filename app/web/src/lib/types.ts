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

// De dónde salió un supuesto: 'captured' lo eligió una persona, 'default' lo
// puso el modelo. Nada se calcula con un número que no se pueda ver ni cambiar,
// y nada se presenta como decisión si fue una suposición.
export type AssumptionSource = 'captured' | 'default'

export interface Assumption {
  value: number
  source: AssumptionSource
}

export type AssumptionField = 'acquisitionCostPct' | 'constructionOverhead' | 'holdMonths'

export type Assumptions = Record<AssumptionField, Assumption>

// Una propiedad recorre un ciclo de vida (ver lib/status.ts). Los campos CRUDOS
// siempre se devuelven tal como están en la base — nunca se blanquean, porque en
// pasos posteriores quieres ver todo lo de antes.
//
// De las DERIVADAS, la etapa solo apaga las que AFIRMAN PROPIEDAD: la marca viva
// (algo tuyo que alguien valuó) y el resultado de la venta. Todo lo demás se
// computa siempre y sale null cuando le faltan insumos — misma respuesta, pero
// derivada del dato. Espeja las ventanas de api/properties_db.py.
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
  // purchasePrice es lo que cuesta ADQUIRIR el inmueble como está —lote o casa
  // terminada, sin casos especiales—; sqmConstruction y constructionCostPerSqm
  // son la obra que TÚ vas a ejecutar encima. Lo que ya está construido y ya
  // está pagado dentro del precio no vuelve a aparecer.
  sqmLand: number | null
  sqmConstruction: number | null
  purchasePrice: number | null
  constructionCostPerSqm: number | null
  permitsCost: number | null
  subdivisionCost: number | null
  projectedSale: number | null
  // Renta estimada por el underwriting frente a renta efectivamente cobrada.
  // Son dos columnas para que se puedan comparar: la segunda no pisa a la
  // primera al entrar en renta.
  rentMonthlyProjected: number | null
  rentMonthlyActual: number | null

  // --- Supuestos: el valor VIGENTE, venga de captura o del modelo ---
  // Nunca son null: si nadie eligió, vale el default del modelo. `assumptions`
  // dice cuál de los dos casos es, que es lo único que la ficha necesita para
  // no volver a computar dinero con un número invisible.
  acquisitionCostPct: number
  constructionOverhead: number
  holdMonths: number
  assumptions: Assumptions

  // --- Base de capital (viva en toda etapa: es historia, no proyección) ---
  // La capturada a mano y la que el modelo resolvió son dos hechos distintos:
  // totalInvestmentCaptured es lo tecleado tal cual y sobrevive aunque el
  // desglose esté completo; totalInvestment es la base con la que se divide.
  totalInvestmentCaptured: number | null
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

  // --- El expediente: en qué se fue el dinero y qué prometió (toda etapa) ---
  // Sobrevive a la venta a propósito: es el plan contra el que se lee el
  // resultado, y apagarlo ahí lo apagaba justo cuando se volvía comprobable.
  // Los cinco primeros son además las barras del DESGLOSE, que tienen que sumar
  // el total en cualquier etapa.
  acquisitionCosts: number | null
  acquisitionTotal: number | null
  constructionBase: number | null
  constructionTotal: number | null
  purchasePricePerSqm: number | null
  salePerSqm: number | null
  investmentPerSqm: number | null
  projectedProfit: number | null
  projectedRoi: number | null
  projectedRoiTotal: number | null
  capRate: number | null      // yield on cost de la renta ESTIMADA
  rentAnnual: number | null   // 12 × renta estimada
  capRateActual: number | null      // las mismas dos fórmulas, con la renta
  rentAnnualActual: number | null   // que de verdad se cobra

  // --- La marca viva (desarrollo, en_renta, archivada; null al vender) ---
  // Una vendida no tiene ganancia «no realizada»: la realizó.
  unrealizedGain: number | null
  unrealizedGainPct: number | null
  // CAGR contra la valuación, anualizado de la compra a la FECHA DE VALUACIÓN.
  // No usa holdMonthsActual: un numerador de hace meses sobre un reloj que corre
  // hasta hoy baja solo cada mes sin que cambie ningún dato.
  roi: number | null
  holdMonthsActual: number | null   // el plazo real, corriendo; congelado al vender

  // --- Resultado final (solo vendida) ---
  realizedGain: number | null
  realizedGainPct: number | null
  realizedRoi: number | null

  // --- Calculados por el servidor (única casa) ---
  score: number | null    // solo prospecto/oferta
  issues: Issue[]
}

export interface QualityEntry {
  id: number
  name: string
  status: PropertyStatus
  issues: Issue[]
}

// Lo que un PATCH puede escribir: nunca `status` (eso es una transición) y
// nunca un null (vaciar es clear-fields).
export type RawPropertyFields = Pick<Property,
  | 'name' | 'assetType' | 'strategyType' | 'address' | 'city' | 'url'
  | 'latitude' | 'longitude' | 'notes'
  | 'sqmLand' | 'sqmConstruction' | 'purchasePrice' | 'acquisitionCostPct'
  | 'permitsCost' | 'subdivisionCost' | 'constructionCostPerSqm'
  | 'constructionOverhead' | 'projectedSale' | 'holdMonths'
  | 'rentMonthlyProjected' | 'rentMonthlyActual'
  | 'totalUnits' | 'acquisitionDate' | 'firstRentDate' | 'valuationDate'
  | 'totalInvestmentCaptured' | 'currentValuation' | 'saleDate' | 'salePrice'
>

// Lo que se le puede entregar a un PATCH. Los nulls que traiga se filtran en
// updateProperty antes de salir: escribir un null nunca es una edición — es un
// vaciado, y eso tiene su propio endpoint.
export type PropertyPatch = Partial<RawPropertyFields> & {
  isFavorite?: boolean
  milestones?: Record<string, string>
}

// Alta: la dirección y el nombre son lo mínimo para reconocer un inmueble; el
// resto lo completa CAPTURE_DEFAULTS del servidor. `status` no se pide porque
// toda propiedad nace prospecto.
export interface PropertyCreate {
  name: string
  address: string
  city: string
  url?: string
  latitude?: number
  longitude?: number
  assetType?: string
  strategyType?: string
  sqmLand?: number
  sqmConstruction?: number
  purchasePrice?: number
  acquisitionCostPct?: number
  permitsCost?: number
  subdivisionCost?: number
  constructionCostPerSqm?: number
  constructionOverhead?: number
  projectedSale?: number
  holdMonths?: number
  rentMonthlyProjected?: number
  notes?: string
  isFavorite?: boolean
}

// Espeja CLEARABLE_FIELDS de properties_db: las columnas que pueden quedar
// vacías. Que una fila concreta pueda perder un campo concreto lo decide el
// servidor según su etapa — esta lista solo dice qué es vaciable en principio.
export const CLEARABLE_FIELDS = [
  'assetType', 'strategyType',
  'sqmLand', 'sqmConstruction', 'purchasePrice', 'acquisitionCostPct',
  'permitsCost', 'subdivisionCost', 'constructionCostPerSqm',
  'constructionOverhead', 'projectedSale', 'holdMonths',
  'rentMonthlyProjected', 'rentMonthlyActual',
  'totalUnits', 'acquisitionDate', 'firstRentDate', 'saleDate', 'salePrice',
  'totalInvestmentCaptured', 'currentValuation', 'valuationDate',
] as const
export type ClearableField = typeof CLEARABLE_FIELDS[number]

// Cada transición pide exactamente los insumos que su etapa destino necesita —
// espejo de los cuerpos tipados de POST /api/properties/{id}/transition.
interface TransitionCommon {
  effectiveOn?: string   // YYYY-MM-DD; el servidor usa hoy si falta
  notes?: string
}

export type Transition =
  | (TransitionCommon & { to: 'oferta'; projectedSale?: number })
  | (TransitionCommon & {
      to: 'desarrollo'
      acquisitionDate: string
      totalUnits: number
      currentValuation: number
      valuationDate?: string
      totalInvestmentCaptured?: number   // solo hace falta sin desglose completo
    })
  | (TransitionCommon & {
      to: 'en_renta'
      firstRentDate: string
      rentMonthlyActual: number   // la cobrada; la estimada no se toca
      currentValuation?: number
      valuationDate?: string
    })
  | (TransitionCommon & { to: 'vendida'; saleDate: string; salePrice: number })
  | (TransitionCommon & { to: 'archivada' })

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
  price:            number   // precio total del anuncio → purchasePrice al guardar
  sqmLand:          number
  // Metros YA construidos según el anuncio: un hecho del inmueble, no la obra a
  // ejecutar. No entra a sqmConstruction (ahí vive lo que se va a construir);
  // se conserva como contexto para que nadie lo confunda con presupuesto.
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
  propertyName: string | null
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
  // null cuando el reparto no se puede calcular: sin distribuible no hay parte,
  // y un 0 se leería como "a esta persona no le toca nada".
  base: number | null
  bonus: number | null
  total: number | null
}

export interface ProfitScenario {
  splits: ProfitSplit[]
  companyResidual: number | null
}

export interface InvestorBreakdownEntry {
  investorId: number | null
  name: string
  fundedAmount: number
  interestRateAnnual: number
  cuota: number
  totalReturn: number
}

/** De dónde salió el precio de salida. null = no hay ninguno de los tres. */
export type ExitPriceSource = 'capturado' | 'venta' | 'valuacion'
/** De dónde salió el plazo sobre el que corre la cuota del inversionista. */
export type MonthsSource = 'capturado' | 'real' | 'proyectado' | 'supuesto'
/** De dónde salió el capital de terceros. null = no hay ninguno registrado. */
export type InvestorCapitalSource = 'capturado' | 'fondeado'
/** Insumos del reparto que pueden faltar; sin ellos no se calcula ningún renglón. */
export type WaterfallInput = 'investment' | 'exitPrice' | 'investorCapital'

/**
 * El reparto, con la procedencia de cada insumo. Los renglones derivados valen
 * null cuando falta un insumo — antes se caía a 0 y el estado publicaba
 * "GANANCIA BRUTA = −inversión" como si fuera un hecho.
 */
export interface ProfitWaterfall {
  exitPrice: number | null
  exitPriceSource: ExitPriceSource | null
  investment: number | null
  grossProfit: number | null
  investorCapital: number
  investorCapitalSource: InvestorCapitalSource | null
  investorCuota: number
  operatorGross: number | null
  isrRate: number
  isr: number | null
  netProfit: number | null
  distributable: number | null
  activeTier: number | null    // null = not concluded yet; 0 | 0.25 | 0.50 when concluded
  bonusInputsMissing: string[]  // qué le falta al bono para poder encenderse
  months: number
  monthsSource: MonthsSource
  missingInputs: WaterfallInput[]
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
  propertyName: string
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
  // Derivadas en el servidor a partir de las fechas de la propiedad
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
  transactionCostPct: number | null
  transactionCosts: number
  financingCosts: number
  listingHaircut: number | null
  discountRate: number | null
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
  // El serializador del servidor titula cada tramo entre guiones bajos, así que
  // `npv_10yr` sale como `npv10Yr`. Escritos en minúscula, estos dos campos
  // llegaban siempre undefined y la vista publicaba "—" pasara lo que pasara.
  npv10Yr: number | null
  irr10YrPct: number | null
}

export interface AnalysisRequest {
  propertyId: number
  interventionLevel?: string
  holdingPeriodMonths?: number
  transactionCostPct?: number
  exitPriceSource?: 'manual' | 'calculated' | 'blended'
  arvManualOverride?: number | null
  listingHaircut?: number
  discountRate?: number
  rentaMensualEstimada?: number | null
  financiamientoPct?: number
  tasaInteresCredito?: number
  plazoCreditoMeses?: number
  gastosOperativosPct?: number
}

/**
 * Los supuestos con los que corre el analizador, en un solo lugar: el
 * formulario los prellena con esto y el snapshot guarda lo que se usó. Deben
 * coincidir con los DEFAULT_* de api/analyzer.py.
 */
export const ANALYSIS_DEFAULTS = {
  transactionCostPct: 0.08,
  listingHaircut: 0.06,
  discountRate: 0.10,
  financiamientoPct: 0.60,
  tasaInteresCredito: 0.13,
  plazoCreditoMeses: 240,
  gastosOperativosPct: 0.30,
} as const

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
