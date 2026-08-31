import type { Property, PropertyCreate, PropertyPatch, ClearableField, Transition, PropertyStatus, QualityEntry, SonarSignal, SonarState, TeamMember, MemberRole, ProcessTemplate, TemplateNode, GanttNode, ProcessInstance, NodeState, InstanceDetail, InstanceFile, NodeFile, NodeComment, NodeDetail, ProfitSplitConfig, ProfitWaterfall, Investor, PropertyInvestor, User, ParsedProperty, Zone, Comparable, PropertyImage, ImageType, Proveedor, ProveedorCategory, ProveedorPhoto, Cotizacion, RenderPrompt, RenderPromptKind, PropertyRender, Budget, BudgetLineCreate, BudgetLinePatch, BudgetPaymentCreate, BudgetWrite, BudgetSource, FeeTier } from './types'
import type { FloorPlanModel, PlanKey } from './floorplan/types'
import { getToken, clearToken } from './auth'

export const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('Session expired')
  }
  return res
}

/** El detalle del servidor, que viene escrito para leerse, gana a `API error: N`.
 *
 * El API envuelve todo error en `{error: {code, message, request_id}}` (ver
 * `_error` en api/main.py), así que ahí vive la frase: "La primera renta no
 * puede ser anterior a la adquisición" en vez de un 422 mudo. Se conserva
 * `detail` como respaldo por si algo responde con la forma cruda de FastAPI. */
async function detail(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as
    { error?: { message?: string }; detail?: string } | null
  return body?.error?.message ?? body?.detail ?? `API error: ${res.status}`
}

/** EL ritual de este archivo, una sola vez: authFetch → error legible → JSON.
 *
 * Antes vivía copiado en ~110 llamadas, con dos dialectos de error (`detail`
 * vs `API error: N`) según la antigüedad de la función — ahora el mensaje del
 * servidor gana siempre. `json` serializa el body con su Content-Type; un
 * FormData viaja tal cual en `body`. La respuesta se parsea por contenido, no
 * por fe: un 204 o un body vacío regresan undefined en vez de tronar. */
async function request<T>(
  url: string, init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init
  const res = await authFetch(url, json === undefined ? rest : {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(rest.headers ?? {}) },
    body: JSON.stringify(json),
  })
  if (!res.ok) throw new Error(await detail(res))
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

// ─── Propiedades ──────────────────────────────────────────────────────────────

export interface PropertyFilters {
  status?: PropertyStatus
  city?: string
  isFavorite?: boolean
  minRoi?: number
  maxRoi?: number
  /** Las archivadas están fuera del inventario salvo que se pidan a propósito. */
  includeArchived?: boolean
}

export async function fetchProperties(filters: PropertyFilters = {}): Promise<Property[]> {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.city) params.set('city', filters.city)
  if (filters.isFavorite !== undefined) params.set('is_favorite', String(filters.isFavorite))
  if (filters.minRoi !== undefined) params.set('min_roi', String(filters.minRoi))
  if (filters.maxRoi !== undefined) params.set('max_roi', String(filters.maxRoi))
  if (filters.includeArchived) params.set('include_archived', 'true')
  return request(`${BASE}/api/properties${params.size ? `?${params}` : ''}`)
}

export async function fetchProperty(id: number): Promise<Property> {
  return request(`${BASE}/api/properties/${id}`)
}

export async function createProperty(data: PropertyCreate): Promise<Property> {
  return request(`${BASE}/api/properties`, { method: 'POST', json: data })
}

/**
 * Sube o cambia valores. Nunca los quita: las claves nulas se filtran aquí, en
 * el único lugar por donde pasa todo PATCH, porque vaciar un campo es otra
 * operación (clearPropertyFields) y mover el status es otra más (transition).
 */
export async function updateProperty(id: number, data: PropertyPatch): Promise<Property> {
  const payload = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== null && value !== undefined),
  )
  return request(`${BASE}/api/properties/${id}`, { method: 'PATCH', json: payload })
}

export async function deleteProperty(id: number): Promise<void> {
  await request<void>(`${BASE}/api/properties/${id}`, { method: 'DELETE' })
}

/** La única forma de mover el status: con los insumos que pide la etapa destino. */
export async function transitionProperty(id: number, body: Transition): Promise<Property> {
  return request(`${BASE}/api/properties/${id}/transition`, { method: 'POST', json: body })
}

/** La única forma de dejar un campo vacío — y solo los que el servidor permite. */
export async function clearPropertyFields(id: number, fields: ClearableField[]): Promise<Property> {
  return request(`${BASE}/api/properties/${id}/clear-fields`, { method: 'POST', json: { fields } })
}

export async function fetchQuality(): Promise<QualityEntry[]> {
  return request(`${BASE}/api/quality`)
}

export async function parseProperty(url: string, text: string, image?: Blob): Promise<ParsedProperty> {
  const form = new FormData()
  form.append('url', url)
  form.append('text', text)
  if (image) form.append('file', image, 'screenshot.png')
  return request(`${BASE}/api/properties/parse`, { method: 'POST', body: form })
}

/**
 * Qué entra al prospecto. El menú lo arma propiedad por propiedad y bloque por
 * bloque, pero `propertyIds` ausente NO significa «ninguna»: significa «todas
 * las favoritas», y quien las resuelve es el servidor. Es deliberado — así una
 * propiedad marcada con ★ después de la última vez que alguien abrió el menú
 * entra sola, en vez de faltar en silencio porque no estaba en una lista vieja.
 */
export interface ProspectusOptions {
  propertyIds?: number[]
  /** Recorte por plan, por propiedad — mismo contrato que propertyIds: ausente =
   * todos los planes; una lista = solo esos (vacía = ninguno; el original se
   * imprime igual, es el ancla dimensional, no un plan). */
  planIds?: Record<number, string[]>
  cover: boolean
  portfolioSummary: boolean
  closing: boolean
  opportunityFees: boolean
  opportunityGallery: boolean
  opportunityPlans: boolean
  opportunityRenders: boolean
  opportunityBudget: boolean
}

export async function generateProspectus(options: ProspectusOptions): Promise<Blob> {
  // Binario: la ÚNICA respuesta no-JSON del API — se queda fuera de request().
  const res = await authFetch(`${BASE}/api/documents/prospectus`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.blob()
}

// ─── Fotos de la propiedad ────────────────────────────────────────────────────

export async function uploadPropertyImage(id: number, file: File, imageType: ImageType = 'antes'): Promise<PropertyImage> {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('image_type', imageType)
  return request(`${BASE}/api/properties/${id}/images`, { method: 'POST', body: form })
}

export async function updatePropertyImageType(id: number, imageId: number, imageType: ImageType): Promise<PropertyImage> {
  return request(`${BASE}/api/properties/${id}/images/${imageId}`, { method: 'PATCH', json: { image_type: imageType } })
}

export async function reorderPropertyImages(id: number, imageIds: number[]): Promise<PropertyImage[]> {
  return request(`${BASE}/api/properties/${id}/images/reorder`, { method: 'PUT', json: { image_ids: imageIds } })
}

export async function deletePropertyImage(id: number, imageId: number): Promise<void> {
  await request<void>(`${BASE}/api/properties/${id}/images/${imageId}`, { method: 'DELETE' })
}

// ─── Escalera de comisión de salida ──────────────────────────────────────────

/** Reemplazo atómico de la escalera de un lado (venta o renta) — nunca un PATCH
 * parcial de tramos. El servidor envuelve la lista en `tiers` (ver
 * `FeeTiersReplaceRequest` en routes/properties.py), igual que el reorder de
 * imágenes envuelve la suya en `image_ids`. */
export async function replaceFeeTiers(
  id: number, kind: 'venta' | 'renta', tiers: FeeTier[],
): Promise<FeeTier[]> {
  return request(`${BASE}/api/properties/${id}/fee-tiers/${kind}`, { method: 'PUT', json: { tiers } })
}

// ─── Renders y su biblioteca de prompts ──────────────────────────────────────

/**
 * `kind` filtra entre 'photo' y 'plan' (migración 041, Tarea 22) cuando se pasa;
 * sin él trae la biblioteca completa. La ficha (`PropertyDetailPage`) pide
 * SIEMPRE la completa una sola vez —son 11 filas, no vale la pena un segundo
 * viaje— y dos `RendersPanel` (fotos, plano) filtran cada quien la suya por
 * dentro; este filtro existe para quien SÍ necesite pedir un solo catálogo.
 */
export async function listRenderPrompts(kind?: RenderPromptKind): Promise<RenderPrompt[]> {
  const params = new URLSearchParams()
  if (kind) params.set('kind', kind)
  return request(`${BASE}/api/render-prompts${params.size ? `?${params}` : ''}`)
}

/** `kind` por defecto 'photo': mismo default que `renders_db.create_prompt`
 * (Tarea 22), por compatibilidad hacia atrás con cualquier llamador que no
 * sepa todavía de la biblioteca de plano. */
export async function createRenderPrompt(name: string, body: string, kind: RenderPromptKind = 'photo'): Promise<RenderPrompt> {
  return request(`${BASE}/api/render-prompts`, { method: 'POST', json: { name, body, kind } })
}

export async function deleteRenderPrompt(promptId: number): Promise<void> {
  await request<void>(`${BASE}/api/render-prompts/${promptId}`, { method: 'DELETE' })
}

export async function listPropertyRenders(id: number): Promise<PropertyRender[]> {
  return request(`${BASE}/api/properties/${id}/renders`)
}

export async function generatePropertyRender(
  id: number,
  req: { sourceImageId: number; promptText: string; promptId: number | null },
): Promise<PropertyRender> {
  return request(`${BASE}/api/properties/${id}/renders`, { method: 'POST', json: req })
}

export async function uploadPropertyRender(
  id: number,
  req: { sourceImageId: number; file: File },
): Promise<PropertyRender> {
  const form = new FormData()
  form.append('file', req.file)
  form.append('sourceImageId', String(req.sourceImageId))
  return request(`${BASE}/api/properties/${id}/renders/upload`, { method: 'POST', body: form })
}

export async function generatePropertyRenderFromPlan(
  id: number,
  req: {
    promptText: string; promptId: number | null; plan: Blob; variant: PlanKey
    floorId: string; floorName: string
  },
): Promise<PropertyRender> {
  const form = new FormData()
  form.append('file', req.plan, 'plano.png')
  form.append('promptText', req.promptText)
  // Obligatorio desde la Tarea 14 (`routes/renders.py`, `variant: str = Form(...)`): sin
  // él el servidor contesta 422. De qué levantamiento nació el render, no una preferencia
  // de estilo — así una edición encima puede heredarlo (renders_db.add_render).
  form.append('variant', req.variant)
  // Obligatorios desde la Tarea 29 (`routes/renders.py`, `floorId`/`floorName: str =
  // Form(...)`): sin ellos el servidor contesta 422. De qué PISO del levantamiento
  // nació el render — igual patrón dual que `promptId`/`promptText`: identidad +
  // nombre congelado, y una edición encima los hereda (renders_db.add_render).
  form.append('floorId', req.floorId)
  form.append('floorName', req.floorName)
  if (req.promptId != null) form.append('promptId', String(req.promptId))
  return request(`${BASE}/api/properties/${id}/renders/from-plan`, { method: 'POST', body: form })
}

export async function uploadPropertyRenderFromPlan(
  id: number,
  req: { file: File; variant: PlanKey; floorId: string; floorName: string },
): Promise<PropertyRender> {
  const form = new FormData()
  form.append('file', req.file)
  form.append('variant', req.variant)
  form.append('floorId', req.floorId)
  form.append('floorName', req.floorName)
  return request(`${BASE}/api/properties/${id}/renders/from-plan/upload`, { method: 'POST', body: form })
}

export async function editPropertyRender(
  id: number,
  renderId: number,
  req: { promptText: string },
): Promise<PropertyRender> {
  return request(`${BASE}/api/properties/${id}/renders/${renderId}/edit`, { method: 'POST', json: req })
}

export async function deletePropertyRender(id: number, renderId: number): Promise<void> {
  await request<void>(`${BASE}/api/properties/${id}/renders/${renderId}`, { method: 'DELETE' })
}

export async function choosePropertyRender(id: number, renderId: number): Promise<PropertyRender> {
  return request(`${BASE}/api/properties/${id}/renders/${renderId}/choose`, { method: 'PUT' })
}

export async function unchoosePropertyRender(id: number, renderId: number): Promise<PropertyRender> {
  return request(`${BASE}/api/properties/${id}/renders/${renderId}/choose`, { method: 'DELETE' })
}

export type SonarRunEvent =
  | { type: 'start';           portals: string[]; total: number; cves: string[] }
  | { type: 'portal_start';    portal: string }
  | { type: 'portal_done';     portal: string; fetched: number; skipped: number }
  | { type: 'portal_error';    portal: string; error: string }
  | { type: 'enriching';       total: number }
  | { type: 'enrich_progress'; total: number; done: number }
  | { type: 'complete';        found: number; skipped: number; enriched: number; signals: SonarSignal[] }

export async function* streamSonarRun(cves: string[]): AsyncGenerator<SonarRunEvent> {
  // SSE: se consume el stream crudo — fuera de request() a propósito.
  const res = await authFetch(`${BASE}/api/sonar/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cves }),
  })
  if (!res.ok) throw new Error(await detail(res))
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const chunks = buf.split('\n\n')
    buf = chunks.pop()!
    for (const chunk of chunks) {
      const line = chunk.trim()
      if (line.startsWith('data: ')) yield JSON.parse(line.slice(6)) as SonarRunEvent
    }
  }
}

export async function importSonarSignal(signal: SonarSignal): Promise<{ property: Property }> {
  return request(`${BASE}/api/sonar/import`, { method: 'POST', json: signal })
}

export async function importSonarToComparables(signalIds: number[], zoneId: number): Promise<{ created: number; skipped: number }> {
  return request(`${BASE}/api/sonar/to-comparables`, { method: 'POST', json: { signal_ids: signalIds, zone_id: zoneId } })
}

export async function fetchSonarSignals(): Promise<SonarSignal[]> {
  const data = await request<{ signals: SonarSignal[] }>(`${BASE}/api/sonar/signals`)
  return data.signals
}

export async function fetchZoneMedians(): Promise<Record<string, number>> {
  const data = await request<{ medians: Record<string, number> }>(`${BASE}/api/sonar/zone-medians`)
  return data.medians
}

export async function reGeocodeSonarSignals(): Promise<{ queued: number }> {
  return request(`${BASE}/api/sonar/re-geocode`, { method: 'POST' })
}

export async function fetchSonarZones(): Promise<SonarState[]> {
  const res = await authFetch(`${BASE}/api/sonar/zones`)
  if (!res.ok) return []
  const data = await res.json()
  return data.states ?? []
}

export async function fetchTeam(): Promise<TeamMember[]> {
  return request(`${BASE}/api/team`)
}

export async function createTeamMember(data: { name: string; role: MemberRole; managerId?: number | null; email?: string; notes?: string }): Promise<TeamMember> {
  return request(`${BASE}/api/team`, { method: 'POST', json: data })
}

export async function deleteTeamMember(id: number): Promise<void> {
  await request<void>(`${BASE}/api/team/${id}`, { method: 'DELETE' })
}

export async function updateTeamMember(id: number, data: { name?: string; role?: MemberRole; managerId?: number | null; email?: string; notes?: string }): Promise<TeamMember> {
  return request(`${BASE}/api/team/${id}`, { method: 'PATCH', json: data })
}

// ─── Process templates ────────────────────────────

export async function fetchTemplates(): Promise<ProcessTemplate[]> {
  return request(`${BASE}/api/process/templates`)
}

export async function createTemplate(data: { name: string; description?: string }): Promise<ProcessTemplate> {
  return request(`${BASE}/api/process/templates`, { method: 'POST', json: data })
}

export async function updateTemplate(id: number, data: Partial<Pick<ProcessTemplate, 'name' | 'description'>>): Promise<ProcessTemplate> {
  return request(`${BASE}/api/process/templates/${id}`, { method: 'PATCH', json: data })
}

export async function deleteTemplate(id: number): Promise<void> {
  await request<void>(`${BASE}/api/process/templates/${id}`, { method: 'DELETE' })
}

export async function fetchTemplatePreview(tid: number): Promise<{ template: ProcessTemplate; nodes: GanttNode[] }> {
  return request(`${BASE}/api/process/templates/${tid}/preview`)
}

// ─── Template nodes ───────────────────────────────

export async function fetchTemplateNodes(tid: number): Promise<TemplateNode[]> {
  return request(`${BASE}/api/process/templates/${tid}/nodes`)
}

export async function createNode(tid: number, data: {
  name: string
  description?: string
  sortOrder?: number
  parentId?: number | null
  dependsOnId?: number | null
  durationDays?: number | null
  sourceTemplateId?: number | null
}): Promise<TemplateNode> {
  return request(`${BASE}/api/process/templates/${tid}/nodes`, { method: 'POST', json: data })
}

export async function updateNode(nid: number, data: {
  name?: string
  description?: string
  sortOrder?: number
  dependsOnId?: number | null
  durationDays?: number | null
  supplierCategoryId?: number | null
}): Promise<TemplateNode> {
  return request(`${BASE}/api/process/nodes/${nid}`, { method: 'PATCH', json: data })
}

export async function deleteNode(nid: number): Promise<void> {
  await request<void>(`${BASE}/api/process/nodes/${nid}`, { method: 'DELETE' })
}

// ─── Process instances ────────────────────────────

export async function fetchInstances(propertyId?: number): Promise<ProcessInstance[]> {
  const params = new URLSearchParams()
  if (propertyId !== undefined) params.set('property_id', String(propertyId))
  return request(`${BASE}/api/process/instances${params.size ? `?${params}` : ''}`)
}

export async function createInstance(data: {
  name: string
  startDate: string
  templateId?: number | null
  propertyId?: number | null
  ownerId?: number | null
  frequencyDays?: number | null
  dueDate?: string | null
  notes?: string
}): Promise<ProcessInstance> {
  return request(`${BASE}/api/process/instances`, { method: 'POST', json: data })
}

export async function updateInstance(iid: number, data: Partial<{
  name: string
  startDate: string
  status: string
  notes: string
  propertyId: number | null
  ownerId: number | null
  taskType: string
  dueDate: string | null
  frequencyDays: number | null
  durationLockedAt: string | null
}>): Promise<{ instance: ProcessInstance; nextInstance: ProcessInstance | null }> {
  return request(`${BASE}/api/process/instances/${iid}`, { method: 'PATCH', json: data })
}

export async function fetchInstanceDetail(iid: number): Promise<InstanceDetail & { files: InstanceFile[] }> {
  return request(`${BASE}/api/process/instances/${iid}`)
}

// ─── Instance files ───────────────────────────────────────────────────────────

export async function fetchInstanceFiles(iid: number): Promise<InstanceFile[]> {
  return request(`${BASE}/api/process/instances/${iid}/files`)
}

export async function uploadInstanceFile(iid: number, file: File): Promise<InstanceFile> {
  const form = new FormData()
  form.append('file', file)
  return request(`${BASE}/api/process/instances/${iid}/files`, { method: 'POST', body: form })
}

export async function deleteInstanceFile(fid: number): Promise<void> {
  await request<void>(`${BASE}/api/process/instance-files/${fid}`, { method: 'DELETE' })
}

// ─── Node states ──────────────────────────────────

export async function updateNodeState(iid: number, nid: number, data: {
  status?: string
  assigneeId?: number | null
  supplierId?: number | null
  actualStart?: string | null
  actualEnd?: string | null
  notes?: string
  durationOverrideDays?: number | null
}): Promise<NodeState> {
  return request(`${BASE}/api/process/instances/${iid}/nodes/${nid}/state`, { method: 'PATCH', json: data })
}

// ─── Node files ──────────────────────────────────────────────────────────────

export async function fetchNodeFiles(nid: number, instanceId?: number): Promise<NodeFile[]> {
  const qs = instanceId != null ? `?instance_id=${instanceId}` : ''
  return request(`${BASE}/api/process/nodes/${nid}/files${qs}`)
}

export async function uploadNodeFile(
  nid: number,
  file: File,
  instanceId?: number,
): Promise<NodeFile> {
  const form = new FormData()
  form.append('file', file)
  if (instanceId != null) form.append('instance_id', String(instanceId))
  return request(`${BASE}/api/process/nodes/${nid}/files`, { method: 'POST', body: form })
}

export async function deleteNodeFile(fid: number): Promise<void> {
  await request<void>(`${BASE}/api/process/files/${fid}`, { method: 'DELETE' })
}

// ─── Node comments ───────────────────────────────────────────────────────────

export async function fetchNodeComments(iid: number, nid: number): Promise<NodeComment[]> {
  return request(`${BASE}/api/process/instances/${iid}/nodes/${nid}/comments`)
}

export async function createNodeComment(
  iid: number,
  nid: number,
  body: string,
  author: string,
): Promise<NodeComment> {
  return request(`${BASE}/api/process/instances/${iid}/nodes/${nid}/comments`, { method: 'POST', json: { body, author } })
}

export async function deleteNodeComment(cid: number): Promise<void> {
  await request<void>(`${BASE}/api/process/comments/${cid}`, { method: 'DELETE' })
}

// ─── Node detail ─────────────────────────────────────────────────────────────

export async function fetchNodeDetail(iid: number, nid: number): Promise<NodeDetail> {
  return request(`${BASE}/api/process/instances/${iid}/nodes/${nid}`)
}

// ─── Profit split ─────────────────────────────────────────────────────────────

export async function fetchProfitTemplate(): Promise<ProfitSplitConfig> {
  return request(`${BASE}/api/profit/template`)
}

export async function updateProfitTemplate(data: Partial<ProfitSplitConfig>): Promise<ProfitSplitConfig> {
  return request(`${BASE}/api/profit/template`, { method: 'PUT', json: data })
}

export async function fetchPropertyProfit(id: number): Promise<{ config: ProfitSplitConfig; waterfall: ProfitWaterfall }> {
  return request(`${BASE}/api/properties/${id}/profit`)
}

export async function updatePropertyProfit(id: number, data: Partial<ProfitSplitConfig>): Promise<{ config: ProfitSplitConfig; waterfall: ProfitWaterfall }> {
  return request(`${BASE}/api/properties/${id}/profit`, { method: 'PUT', json: data })
}

// ─── Investors ────────────────────────────────────────────────────────────────

export async function fetchInvestors(): Promise<Investor[]> {
  return request(`${BASE}/api/investors`)
}

export async function fetchInvestor(id: number): Promise<Investor & { positions: PropertyInvestor[] }> {
  return request(`${BASE}/api/investors/${id}`)
}

export async function createInvestor(data: Omit<Investor, 'id' | 'createdAt' | 'totalInterested' | 'totalCommitted' | 'totalFunded'>): Promise<Investor> {
  return request(`${BASE}/api/investors`, { method: 'POST', json: data })
}

export async function updateInvestor(id: number, data: Partial<Pick<Investor, 'name' | 'apellidos' | 'email' | 'phone' | 'notes' | 'temperatura' | 'capacidad' | 'fuente' | 'confianza'>>): Promise<Investor> {
  return request(`${BASE}/api/investors/${id}`, { method: 'PUT', json: data })
}

export async function deleteInvestor(id: number): Promise<void> {
  await request<void>(`${BASE}/api/investors/${id}`, { method: 'DELETE' })
}

export async function fetchPropertyInvestors(propertyId: number): Promise<PropertyInvestor[]> {
  return request(`${BASE}/api/properties/${propertyId}/investors`)
}

export async function addPropertyInvestor(
  propertyId: number,
  // Sin `status`: el embudo lo deriva el servidor de los montos en cada escritura.
  data: { investorId: number; interestedAmount: number; committedAmount: number; fundedAmount: number; interestRateAnnual: number; investmentDate: string | null; notes: string }
): Promise<PropertyInvestor> {
  return request(`${BASE}/api/properties/${propertyId}/investors`, { method: 'POST', json: data })
}

export async function updatePropertyInvestment(
  propertyId: number,
  investmentId: number,
  data: Partial<{ interestedAmount: number; committedAmount: number; fundedAmount: number; interestRateAnnual: number; investmentDate: string | null; returnAmount: number | null; returnDate: string | null; notes: string }>
): Promise<PropertyInvestor> {
  return request(`${BASE}/api/properties/${propertyId}/investors/${investmentId}`, { method: 'PUT', json: data })
}

export async function deletePropertyInvestment(propertyId: number, investmentId: number): Promise<void> {
  await request<void>(`${BASE}/api/properties/${propertyId}/investors/${investmentId}`, { method: 'DELETE' })
}

// ─── Zones ───────────────────────────────────────────────────────────────────

export async function fetchZones(): Promise<Zone[]> {
  return request(`${BASE}/api/zones`)
}

// ─── Comparables ─────────────────────────────────────────────────────────────

export async function fetchComparables(status?: string, zoneId?: number): Promise<Comparable[]> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (zoneId) params.set('zone_id', String(zoneId))
  const qs = params.size ? `?${params}` : ''
  return request(`${BASE}/api/comparables${qs}`)
}

export async function createComparable(data: Partial<Comparable>): Promise<Comparable> {
  return request(`${BASE}/api/comparables`, { method: 'POST', json: data })
}

export async function updateComparable(id: number, data: Partial<Comparable>): Promise<Comparable> {
  return request(`${BASE}/api/comparables/${id}`, { method: 'PATCH', json: data })
}

export async function deleteComparable(id: number): Promise<void> {
  await request<void>(`${BASE}/api/comparables/${id}`, { method: 'DELETE' })
}

// ─── Auth / Me ────────────────────────────────────────────────────────────────

export async function fetchMe(): Promise<{ email: string }> {
  return request(`${BASE}/api/auth/me`)
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request<void>(`${BASE}/api/auth/change-password`, { method: 'POST', json: { currentPassword, newPassword } })
}

// ─── User management ─────────────────────────────────────────────────────────

export async function fetchUsers(): Promise<User[]> {
  return request(`${BASE}/api/users`)
}

export async function createUser(email: string, password: string): Promise<User> {
  return request(`${BASE}/api/users`, { method: 'POST', json: { email, password } })
}

export async function updateUser(id: number, data: { isActive?: boolean; password?: string }): Promise<User> {
  return request(`${BASE}/api/users/${id}`, { method: 'PATCH', json: data })
}

export async function deleteUser(id: number): Promise<void> {
  await request<void>(`${BASE}/api/users/${id}`, { method: 'DELETE' })
}

// ── Proveedor Categories ──────────────────────────────────────────────────────

export async function getCategories(): Promise<ProveedorCategory[]> {
  return request(`${BASE}/api/proveedor-categories`)
}

export async function createCategory(data: { name: string; description?: string }): Promise<ProveedorCategory> {
  return request(`${BASE}/api/proveedor-categories`, { method: 'POST', json: data })
}

export async function updateCategory(id: number, data: Partial<Pick<ProveedorCategory, 'name' | 'description'>>): Promise<ProveedorCategory> {
  return request(`${BASE}/api/proveedor-categories/${id}`, { method: 'PATCH', json: data })
}

export async function deleteCategory(id: number): Promise<void> {
  await request<void>(`${BASE}/api/proveedor-categories/${id}`, { method: 'DELETE' })
}

// ── Proveedores ───────────────────────────────────────────────────────────────

export async function getProveedores(categoryId?: number): Promise<Proveedor[]> {
  const url = categoryId != null
    ? `${BASE}/api/proveedores?category_id=${categoryId}`
    : `${BASE}/api/proveedores`
  return request(url)
}

export async function getProveedor(id: number): Promise<Proveedor> {
  return request(`${BASE}/api/proveedores/${id}`)
}

export async function getProveedorAssignments(id: number): Promise<import('./types').ProveedorAssignment[]> {
  return request(`${BASE}/api/proveedores/${id}/assignments`)
}

export async function createProveedor(data: Partial<Proveedor> & { name: string }): Promise<Proveedor> {
  return request(`${BASE}/api/proveedores`, { method: 'POST', json: data })
}

export async function updateProveedor(id: number, data: Partial<Proveedor>): Promise<Proveedor> {
  return request(`${BASE}/api/proveedores/${id}`, { method: 'PATCH', json: data })
}

export async function deleteProveedor(id: number): Promise<void> {
  await request<void>(`${BASE}/api/proveedores/${id}`, { method: 'DELETE' })
}

export async function setProveedorCategories(id: number, categoryIds: number[]): Promise<Proveedor> {
  return request(`${BASE}/api/proveedores/${id}/categories`, { method: 'PUT', json: { categoryIds } })
}

export async function uploadProveedorPhoto(id: number, file: File): Promise<ProveedorPhoto> {
  const fd = new FormData()
  fd.append('file', file, file.name)
  return request(`${BASE}/api/proveedores/${id}/photos`, { method: 'POST', body: fd })
}

export async function deleteProveedorPhoto(proveedorId: number, photoId: number): Promise<void> {
  await request<void>(`${BASE}/api/proveedores/${proveedorId}/photos/${photoId}`, { method: 'DELETE' })
}

// ── Cotizaciones ──────────────────────────────────────────────────────────────

export async function getCotizaciones(stateId: number): Promise<Cotizacion[]> {
  return request(`${BASE}/api/instance-node-states/${stateId}/cotizaciones`)
}

export async function createCotizacion(stateId: number, data: Partial<Cotizacion>): Promise<Cotizacion> {
  return request(`${BASE}/api/instance-node-states/${stateId}/cotizaciones`, { method: 'POST', json: data })
}

export async function updateCotizacion(id: number, data: Partial<Cotizacion>): Promise<Cotizacion> {
  return request(`${BASE}/api/cotizaciones/${id}`, { method: 'PATCH', json: data })
}

export async function selectCotizacion(id: number, instanceNodeStateId: number): Promise<Cotizacion> {
  return request(`${BASE}/api/cotizaciones/${id}/select`, { method: 'POST', json: { instanceNodeStateId } })
}

export async function deleteCotizacion(id: number): Promise<void> {
  await request<void>(`${BASE}/api/cotizaciones/${id}`, { method: 'DELETE' })
}

// ── Floor-plan geometry ──

// El backend es un blob store sin esquema: el `geometry` que regresa puede ser v3,
// v2 viejo o {}, así que el caller lo pasa por migrateGeometry en vez de confiar en
// un tipo aquí. `revision` es el candado optimista (migración 052): guardar
// reemplaza el blob COMPLETO, así que cada guardado declara de qué revisión
// partió y el servidor contesta 409 si alguien más guardó en medio — nunca pisa.
export async function fetchPropertyGeometry(
  id: number,
): Promise<{ geometry: unknown; revision: number }> {
  return request(`${BASE}/api/properties/${id}/geometry`)
}

export async function savePropertyGeometry(
  id: number, geometry: FloorPlanModel, expectedRevision: number,
): Promise<{ geometry: FloorPlanModel; revision: number }> {
  return request(`${BASE}/api/properties/${id}/geometry`, { method: 'PUT', json: { geometry, expectedRevision } })
}

/** Borra un plan de proyecto Y sus renders (cascada deliberada, servidor).
 * Devuelve cuántos renders se llevó — la UI lo confirma en dos pasos ANTES con
 * el conteo local, y esto reporta lo que realmente pasó — y la nueva `revision`
 * del candado (borrar también muta el blob de geometría en el servidor). */
export async function deletePropertyPlan(
  id: number, planId: string,
): Promise<{ deletedRenders: number; revision: number }> {
  return request(`${BASE}/api/properties/${id}/plans/${encodeURIComponent(planId)}`, { method: 'DELETE' })
}

export async function uploadFloorplanImage(id: number, file: File): Promise<{ imageKey: string }> {
  const fd = new FormData()
  fd.append('file', file)
  return request(`${BASE}/api/properties/${id}/floorplan-image`, { method: 'POST', body: fd })
}

// ── Presupuesto de obra ───────────────────────────────────────────────────────
//
// Anidado bajo la propiedad porque eso es: el presupuesto no existe sin ella y
// no se comparte con ninguna otra. Y SIN VENTANA DE ETAPA — acompaña a la
// propiedad desde prospecto, como el desglose de costos, no como una
// herramienta que se abre en desarrollo. Hay que poder presupuestar antes de
// ofertar.

// `planId` cambia el ámbito al presupuesto-escenario de ese plan (addendum
// 2026-08-24); sin él, el de la propiedad — el único que alimenta finanzas.
const budgetUrl = (propertyId: number, path = '', planId?: string) =>
  `${BASE}/api/properties/${propertyId}/budget${path}`
  + (planId ? `?planId=${encodeURIComponent(planId)}` : '')

/**
 * Toda escritura del presupuesto responde lo mismo, así que se lee en un solo
 * lugar. Crear, editar, borrar, pagar, despagar, renombrar un capítulo y
 * ajustar el total son la misma forma: un camino de código, no siete.
 */
async function budgetWrite(url: string, method: string, body?: unknown): Promise<BudgetWrite> {
  return request(url, { method, ...(body !== undefined ? { json: body } : {}) })
}

export async function fetchBudget(propertyId: number, planId?: string): Promise<Budget> {
  return request(budgetUrl(propertyId, '', planId))
}

export function createBudgetLine(propertyId: number, data: BudgetLineCreate, planId?: string): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, '/lines', planId), 'POST', data)
}

/**
 * A diferencia de `updateProperty`, aquí los `null` NO se filtran: van, y
 * significan vaciar. La ficha se edita con un botón GUARDAR y ahí una caja en
 * blanco quiere decir «no la toques»; una celda del presupuesto se guarda al
 * soltarla, y ahí dejarla vacía es justo lo que se está pidiendo. Por eso el
 * presupuesto no necesita el clear-fields que sí necesita la ficha.
 */
export function updateBudgetLine(
  propertyId: number, lineId: number, data: BudgetLinePatch, planId?: string,
): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, `/lines/${lineId}`, planId), 'PATCH', data)
}

export function deleteBudgetLine(propertyId: number, lineId: number, planId?: string): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, `/lines/${lineId}`, planId), 'DELETE')
}

/** El escenario de un plan nace por acción explícita: copiado de CUALQUIER
 * presupuesto origen (`sourceBudgetId` — el de la propiedad, el escenario de
 * otro plan, el de otra obra), del de la propiedad (default), o vacío. Nunca
 * al leer. */
export async function createPlanBudget(
  propertyId: number, planId: string, copyFromProperty = true,
  sourceBudgetId?: number,
): Promise<{ budget: Budget; linesAdded: number; linesSkipped: number }> {
  return request(
    `${BASE}/api/properties/${propertyId}/budget/plans/${encodeURIComponent(planId)}`,
    { method: 'POST', json: { copyFromProperty, ...(sourceBudgetId != null ? { sourceBudgetId } : {}) } })
}

/** «Usar este plan»: sus renglones entran al presupuesto de la PROPIEDAD por la
 * misma puerta que copiar de otra obra — deduplicar es saltar, lo capturado no
 * se pisa, y se reporta cuánto entró y cuánto ya estaba. */
export function usePlanBudget(propertyId: number, planId: string): Promise<BudgetWrite> {
  return budgetWrite(
    `${BASE}/api/properties/${propertyId}/budget/plans/${encodeURIComponent(planId)}/use`, 'POST')
}

/**
 * La operación que SÍ mueve cuánto va a costar la obra, moviendo el residuo.
 * Existe aparte de detallar precisamente para que las dos se distingan:
 * detallar reparte un total que no cambia, esto cambia el total sin tocar una
 * sola partida. Mezclarlas volvería imposible contestar si el presupuesto
 * creció o solo se abrió.
 */
export function setBudgetTotal(propertyId: number, amount: number, planId?: string): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, '/total', planId), 'PUT', { amount })
}

/**
 * Renombrar y borrar un capítulo son las dos únicas operaciones que tocan
 * varios renglones a la vez; hacerlas renglón por renglón dejaría el
 * presupuesto a medio renombrar si algo falla en medio.
 */
export function renameBudgetChapter(
  propertyId: number, chapter: string, name: string, planId?: string,
): Promise<BudgetWrite> {
  return budgetWrite(
    budgetUrl(propertyId, `/chapters/${encodeURIComponent(chapter)}`, planId), 'PATCH', { name },
  )
}

export function deleteBudgetChapter(propertyId: number, chapter: string, planId?: string): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, `/chapters/${encodeURIComponent(chapter)}`, planId), 'DELETE')
}

export function addBudgetPayment(
  propertyId: number, lineId: number, data: BudgetPaymentCreate, planId?: string,
): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, `/lines/${lineId}/payments`, planId), 'POST', data)
}

export function deleteBudgetPayment(
  propertyId: number, lineId: number, paymentId: number, planId?: string,
): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, `/lines/${lineId}/payments/${paymentId}`, planId), 'DELETE')
}

/**
 * Arrancar desde el presupuesto de otra obra.
 *
 * Los renglones se SUMAN a lo que ya hubiera y el residuo baja lo que ellos
 * suben: el total no se mueve, igual que al detallar a mano.
 *
 * **`propertyId` es SIEMPRE el DESTINO.** Por eso las dos direcciones son esta
 * misma función: «arranco desde X» la llama con la obra que se está viendo, y
 * «me llevo esto a X, Y, Z» la llama una vez por cada obra de destino con el
 * `budgetId` de la que se está viendo. El servidor no distingue las dos, y no
 * hay ruta de reparto: cada presupuesto es independiente, así que si el tercer
 * destino falla los otros tienen que quedar aplicados.
 *
 * `chapters` acota QUÉ se copia. `null` —el caso por omisión— es el presupuesto
 * entero; una lista copia solo esos capítulos. Los renglones que el destino ya
 * tenga (mismo capítulo y mismo nombre) se SALTAN y jamás se sobrescriben:
 * podrían traer proveedor, comprometido o pagos ya capturados. Cuántos entraron
 * y cuántos se saltaron vienen en `linesAdded` y `linesSkipped`.
 *
 * `proportional` es lo que separa las DOS formas de copiar:
 *
 * - Omitido —el caso por omisión— es la copia DIRECTA: los renglones entran con
 *   los montos del origen, tal cual.
 * - `true` pide la copia PROPORCIONAL: copiar la FORMA del presupuesto,
 *   dimensionada al costo de obra DEL DESTINO. **Ese objetivo no viaja**: es el
 *   total del presupuesto que el destino ya tiene, y el servidor lo lee de ahí.
 *   Mandarlo desde la pantalla sería una segunda definición del mismo número, y
 *   la que se pudiera teclear encima. **El cliente tampoco manda el factor**: un
 *   multiplicador arbitrario volvería la garantía de que la suma da exactamente
 *   el objetivo imposible de verificar del lado que la sostiene.
 *
 * El modo va en un campo PROPIO y nada más: el cuerpo proporcional es el mismo
 * de la copia directa con `proportional: true` encima, sin un solo insumo extra.
 *
 * Las partidas marcadas como no proporcionales entran con su monto original; el
 * resto se escala. Si el destino no tiene costo de obra capturado, o si las
 * partidas fijas del origen ya no caben en él, contesta 422 con el motivo
 * escrito.
 */
export function applyBudgetSource(
  propertyId: number, budgetId: number, chapters: string[] | null = null,
  proportional = false, planId?: string,
): Promise<BudgetWrite> {
  // En directo el cuerpo es EXACTAMENTE el de siempre: la copia que ya
  // funcionaba no cambia de forma por existir la otra. `planId` cambia el
  // DESTINO al escenario de ese plan, igual que en el resto del presupuesto.
  return budgetWrite(budgetUrl(propertyId, '/apply', planId), 'POST', {
    budgetId, chapters,
    ...(proportional ? { proportional: true } : {}),
  })
}

/**
 * De dónde se puede copiar: los presupuestos de LAS OTRAS OBRAS, ya ordenados
 * alfabéticamente por el servidor, así que el selector los pinta tal cual.
 *
 * Dos comportamientos que no se deducen de la forma y que la pantalla tiene que
 * respetar: `lineCount` cuenta lo COPIABLE (el residuo nunca viaja, así que el
 * número se puede prometer), y **los presupuestos sin nada copiable no
 * aparecen** — que una obra no esté en la lista no es un defecto, es que no
 * tiene nada que dar.
 *
 * `excludePropertyId` saca a la obra que pregunta. `apply` ya rechaza copiarse
 * sobre sí mismo con un 422, y ofrecer una opción que solo puede dar error es
 * hacer que alguien descubra la regla chocando con ella.
 */
export async function fetchBudgetSources(
  excludeBudgetId?: number, includeEmpty = false,
): Promise<BudgetSource[]> {
  const params = new URLSearchParams()
  if (excludeBudgetId != null) params.set('excludeBudgetId', String(excludeBudgetId))
  if (includeEmpty) params.set('includeEmpty', 'true')
  return request(`${BASE}/api/budget/sources${params.size ? `?${params}` : ''}`)
}
