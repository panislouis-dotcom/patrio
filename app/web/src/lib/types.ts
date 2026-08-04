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

// Son DOS. `constructionOverhead` era el tercero y se retiró del contrato: dejó
// de multiplicar nada. Se aplica una sola vez, al calcular el primer renglón del
// presupuesto, y desde ahí vive dentro del importe. Un supuesto que no mueve
// dinero no es un supuesto — publicarlo dejaría en la ficha un número que se
// puede leer, comparar y editar sin que mueva un peso, que es el defecto «NO SE
// USA» otra vez y con otro nombre.
export type AssumptionField = 'acquisitionCostPct' | 'holdMonths'

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
  // DERIVADA, ya no capturada: presupuesto ÷ metraje de obra. Se publica para
  // mostrarse y nada la vuelve a leer para calcular dinero. Sigue siendo una
  // entrada de la CALCULADORA que produce el primer renglón al dar de alta una
  // propiedad (`PropertyCreate`), que es otra cosa: ahí se usa una vez y el
  // resultado vive en el presupuesto.
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
  //
  // Son DOS. `constructionOverhead` se retiró del contrato con la fórmula que
  // multiplicaba: ver AssumptionField.
  acquisitionCostPct: number
  holdMonths: number
  assumptions: Assumptions

  // --- Base de capital (viva en toda etapa: es historia, no proyección) ---
  // SIEMPRE la suma del desglose —un componente ausente vale 0—, y null cuando
  // no hay nada capturado. No se teclea: un total all-in se dice como
  // `purchasePrice` con `acquisitionCostPct` en 0, que es la misma cifra dicha
  // por su nombre. Había una segunda columna con el total a mano y con ella la
  // pregunta de cuál de los dos números creer.
  totalInvestment: number | null

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
  // Las cifras de obra son CUATRO y no una. `constructionBudgeted` es el plan
  // —la barra del desglose, lo único que alimenta la inversión total— y es la
  // suma del presupuesto, no una fórmula. Comprometida, pagada y sus variaciones
  // son el avance de obra EN DINERO contra ese plan, y ninguna redefine la
  // inversión: lo que la obra va a costar y lo que ya se pagó de ella son dos
  // preguntas distintas. Las tres de ejecución son null mientras nadie firme ni
  // pague — un 0 ahí se leería como un hecho.
  //
  // `constructionBase` y `constructionTotal` murieron con la fórmula que
  // nombraban: eran el mismo gasto con y sin overhead, y sin un overhead que
  // aplicar serían dos nombres para un número.
  constructionBudgeted: number | null
  constructionCommitted: number | null
  constructionPaid: number | null
  constructionCommittedVariance: number | null
  constructionPaidVariance: number | null
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
//
// `constructionCostPerSqm` NO está: desde que el costo de obra es la suma del
// presupuesto, ese precio por m² es un resultado —presupuesto ÷ metraje— y no
// un insumo. Sigue siendo una entrada de la CALCULADORA que produce el primer
// renglón al dar de alta una propiedad (`PropertyCreate`), que es otra cosa:
// ahí se usa una vez y el resultado vive en el presupuesto. Dejarlo capturable
// en la ficha daría un segundo lugar donde teclear el costo de obra, que es la
// contradicción que este feature existe para cerrar. `sqmConstruction` sí se
// queda: es metraje FÍSICO, y lo leen el analizador y el PDF.
export type RawPropertyFields = Pick<Property,
  | 'name' | 'assetType' | 'strategyType' | 'address' | 'city' | 'url'
  | 'latitude' | 'longitude' | 'notes'
  | 'sqmLand' | 'sqmConstruction' | 'purchasePrice' | 'acquisitionCostPct'
  | 'permitsCost' | 'subdivisionCost'
  | 'projectedSale' | 'holdMonths'
  | 'rentMonthlyProjected' | 'rentMonthlyActual'
  | 'totalUnits' | 'acquisitionDate' | 'firstRentDate' | 'valuationDate'
  | 'currentValuation' | 'saleDate' | 'salePrice'
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
  // Los dos insumos de la CALCULADORA con la que nace el presupuesto —junto a
  // sqmConstruction—, y por eso siguen aquí aunque un PATCH ya no los acepte:
  // se reciben una vez, producen el importe del primer renglón y se olvidan. El
  // resultado vive en el presupuesto, no en un campo paralelo que lo contradiga.
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
  'permitsCost', 'subdivisionCost',
  // Los dos de obra ya no están: vaciar solo tiene sentido sobre algo que se
  // captura, y ninguno de los dos se captura. El costo de obra se cambia
  // capturando partidas o ajustando el total del presupuesto.
  'projectedSale', 'holdMonths',
  'rentMonthlyProjected', 'rentMonthlyActual',
  'totalUnits', 'acquisitionDate', 'firstRentDate', 'saleDate', 'salePrice',
  'currentValuation', 'valuationDate',
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
  // Comprar no produce un avalúo ni una inversión tecleada: la valuación se
  // captura el día que exista una de verdad, y la inversión sale del desglose.
  | (TransitionCommon & {
      to: 'desarrollo'
      acquisitionDate: string
      totalUnits: number
      currentValuation?: number
      valuationDate?: string
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

// ── Presupuesto de obra ───────────────────────────────────────────────────────

/**
 * Un pago de un renglón. Append-only, como property_status_events: un pago mal
 * capturado se borra, no se reescribe — por eso no existe un PATCH de pago.
 */
export interface BudgetLinePayment {
  id: number
  amount: number
  paidOn: string    // YYYY-MM-DD
  notes: string
  createdAt: string
}

/**
 * Un renglón del presupuesto de obra.
 *
 * El capítulo va por NOMBRE y no por id porque es una COPIA, no una referencia
 * (migración 028): editar el catálogo nunca puede reescribir lo que ya se
 * capturó. Un capítulo, en la tabla, es lo que resulta de agrupar por este
 * texto — no hay una entidad aparte que pueda quedar vacía ni desincronizarse.
 *
 * **Ninguna cifra total se guarda ni se recalcula aquí.** `budgetedAmount` es
 * cantidad × precio unitario y `paidAmount` es la suma de los pagos, las dos
 * derivadas en el servidor. Dos maneras de calcular un número son dos números
 * (docs/glosario.md §4), y la de este vive del lado que además lo suma para
 * `totalInvestment`.
 */
export interface BudgetLine {
  id: number
  budgetId: number
  /** Procedencia hacia el catálogo, nunca dependencia. Null en un renglón suelto. */
  itemId: number | null
  chapterName: string
  name: string
  unit: string
  quantity: number
  unitPrice: number
  /** cantidad × precio unitario, derivado por el servidor. */
  budgetedAmount: number
  supplierId: number | null
  /** Lo que se firmó. Null es «no capturado»; un 0 capturado es un 0. */
  committedAmount: number | null
  committedOn: string | null
  /** Lo firmado contra lo planeado; null mientras no se haya firmado nada. */
  committedVariance: number | null
  actualQuantity: number | null
  /** SUM(pagos). Null —no 0— mientras no haya un solo pago: nadie pagó nada. */
  paidAmount: number | null
  /** Lo pagado contra lo planeado; null mientras no se haya pagado nada. */
  paidVariance: number | null
  payments: BudgetLinePayment[]
  closedAt: string | null
  sortOrder: number
  notes: string
  /**
   * «Otros, por detallar»: el remanente del estimado grueso que todavía no se
   * reparte. No se teclea — baja al detallar y sube al quitar detalle, y por eso
   * el total no se mueve. Lo marca el SERVIDOR con una columna suya: reconocerlo
   * por su nombre sería amarrar una regla de dinero a una cadena de texto.
   */
  isResidual: boolean
  createdAt: string
  updatedAt: string
}

/**
 * El presupuesto completo. `chapters` viene ya ordenado por el servidor: un
 * capítulo es el `chapterName` que copian sus renglones, no una fila, así que
 * deducir la lista en el cliente sería una segunda definición del mismo orden.
 */
export interface Budget {
  id: number
  propertyId: number
  lines: BudgetLine[]
  chapters: string[]
}

/**
 * Lo que un PATCH de renglón puede escribir.
 *
 * A diferencia de `PropertyPatch`, aquí un `null` SÍ viaja y significa vaciar:
 * la captura es celda por celda con autoguardado, y la regla «caja vacía = no
 * la toques» no tiene sentido en una celda de dinero — borrar el comprometido
 * de un renglón es justamente lo que se quiere decir al dejarla en blanco. Por
 * eso el presupuesto no necesita el clear-fields que sí necesita la ficha.
 */
export interface BudgetLinePatch {
  chapterName?: string
  name?: string
  unit?: string
  quantity?: number
  unitPrice?: number
  supplierId?: number | null
  committedAmount?: number | null
  committedOn?: string | null
  actualQuantity?: number | null
  notes?: string
}

/**
 * Un renglón nace con su capítulo y su nombre; la unidad, la cantidad y el
 * precio se llenan celda por celda con autoguardado, así que exigir la fila
 * completa de golpe convertiría un estado intermedio normal en un error.
 */
export interface BudgetLineCreate {
  chapterName: string
  name: string
  unit?: string
  quantity?: number
  unitPrice?: number
}

export interface BudgetPaymentCreate {
  amount: number
  paidOn: string
  notes?: string
}

/**
 * Lo que devuelve TODA escritura del presupuesto.
 *
 * El presupuesto ENTERO y no solo el renglón tocado, porque casi toda escritura
 * mueve DOS renglones: el que se editó y el residuo que lo absorbe. Con uno solo
 * la tabla enseñaría la mitad cierta de un presupuesto cuadrado, y la mitad que
 * falta es justo la que explica por qué el total no se movió.
 *
 * Y la propiedad, porque la suma presupuestada ES el costo de obra: tocar un
 * renglón mueve la inversión total, la ganancia proyectada, el ROI y el cap
 * rate. Llegan de la misma transacción, así que la suma de la tabla y
 * `totalInvestment` no pueden discrepar.
 */
export interface BudgetWrite {
  /** El renglón tocado. Null cuando la operación fue de capítulo. */
  line: BudgetLine | null
  budget: Budget
  property: Property
  /**
   * Cuánto CRECIÓ el presupuesto con esta escritura. Es 0 en el caso normal
   * —detallar reparte, no crea— y solo deja de serlo cuando el detalle rebasa
   * el total: ahí el residuo llega a 0 y la obra sí pasa a costar más. Aumentar
   * el presupuesto y detallarlo son dos operaciones distintas, y ésta es la
   * cifra que permite decir cuál de las dos acaba de pasar.
   */
  budgetIncrease: number
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
