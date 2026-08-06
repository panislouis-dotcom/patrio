import type { Property, PropertyCreate, PropertyPatch, ClearableField, Transition, PropertyStatus, QualityEntry, SonarSignal, SonarState, TeamMember, MemberRole, ProcessTemplate, TemplateNode, GanttNode, ProcessInstance, NodeState, InstanceDetail, InstanceFile, NodeFile, NodeComment, NodeDetail, ProfitSplitConfig, ProfitWaterfall, Investor, PropertyInvestor, User, ParsedProperty, Zone, Comparable, PropertyImage, ImageType, Proveedor, ProveedorCategory, ProveedorPhoto, Cotizacion, RenderPrompt, PropertyRender, Budget, BudgetLineCreate, BudgetLinePatch, BudgetPaymentCreate, BudgetWrite, BudgetCatalogChapter, BudgetCatalogItem, BudgetItemSuggestion, BudgetPromotionGroup, BudgetPromotion, BudgetTemplate, BudgetTemplateDetail, BudgetCatalogChapterRow, BudgetSource } from './types'
import type { FloorPlanModel } from './floorplan/types'
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
  const res = await authFetch(`${BASE}/api/properties${params.size ? `?${params}` : ''}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchProperty(id: number): Promise<Property> {
  const res = await authFetch(`${BASE}/api/properties/${id}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createProperty(data: PropertyCreate): Promise<Property> {
  const res = await authFetch(`${BASE}/api/properties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
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
  const res = await authFetch(`${BASE}/api/properties/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteProperty(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/properties/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

/** La única forma de mover el status: con los insumos que pide la etapa destino. */
export async function transitionProperty(id: number, body: Transition): Promise<Property> {
  const res = await authFetch(`${BASE}/api/properties/${id}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

/** La única forma de dejar un campo vacío — y solo los que el servidor permite. */
export async function clearPropertyFields(id: number, fields: ClearableField[]): Promise<Property> {
  const res = await authFetch(`${BASE}/api/properties/${id}/clear-fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function fetchQuality(): Promise<QualityEntry[]> {
  const res = await authFetch(`${BASE}/api/quality`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function parseProperty(url: string, text: string, image?: Blob): Promise<ParsedProperty> {
  const form = new FormData()
  form.append('url', url)
  form.append('text', text)
  if (image) form.append('file', image, 'screenshot.png')
  const res = await authFetch(`${BASE}/api/properties/parse`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function generateProspectus(): Promise<Blob> {
  const res = await authFetch(`${BASE}/api/documents/prospectus`, { method: 'POST' })
  if (!res.ok) throw new Error(await detail(res))
  return res.blob()
}

// ─── Fotos de la propiedad ────────────────────────────────────────────────────

export async function uploadPropertyImage(id: number, file: File, imageType: ImageType = 'general'): Promise<PropertyImage> {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('image_type', imageType)
  const res = await authFetch(`${BASE}/api/properties/${id}/images`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function updatePropertyImageType(id: number, imageId: number, imageType: ImageType): Promise<PropertyImage> {
  const res = await authFetch(`${BASE}/api/properties/${id}/images/${imageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_type: imageType }),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deletePropertyImage(id: number, imageId: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/properties/${id}/images/${imageId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

// ─── Renders y su biblioteca de prompts ──────────────────────────────────────

export async function listRenderPrompts(): Promise<RenderPrompt[]> {
  const res = await authFetch(`${BASE}/api/render-prompts`)
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function createRenderPrompt(name: string, body: string): Promise<RenderPrompt> {
  const res = await authFetch(`${BASE}/api/render-prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, body }),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteRenderPrompt(promptId: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/render-prompts/${promptId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

export async function listPropertyRenders(id: number): Promise<PropertyRender[]> {
  const res = await authFetch(`${BASE}/api/properties/${id}/renders`)
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function generatePropertyRender(
  id: number,
  req: { sourceImageId: number; promptText: string; promptId: number | null },
): Promise<PropertyRender> {
  const res = await authFetch(`${BASE}/api/properties/${id}/renders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function generatePropertyRenderFromPlan(
  id: number,
  req: { promptText: string; promptId: number | null; plan: Blob },
): Promise<PropertyRender> {
  const form = new FormData()
  form.append('file', req.plan, 'plano.png')
  form.append('promptText', req.promptText)
  if (req.promptId != null) form.append('promptId', String(req.promptId))
  const res = await authFetch(`${BASE}/api/properties/${id}/renders/from-plan`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deletePropertyRender(id: number, renderId: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/properties/${id}/renders/${renderId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
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
  const res = await authFetch(`${BASE}/api/sonar/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const res = await authFetch(`${BASE}/api/sonar/import`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signal),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function importSonarToComparables(signalIds: number[], zoneId: number): Promise<{ created: number; skipped: number }> {
  const res = await authFetch(`${BASE}/api/sonar/to-comparables`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signal_ids: signalIds, zone_id: zoneId }),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function fetchSonarSignals(): Promise<SonarSignal[]> {
  const res = await authFetch(`${BASE}/api/sonar/signals`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const data = await res.json()
  return data.signals
}

export async function fetchZoneMedians(): Promise<Record<string, number>> {
  const res = await authFetch(`${BASE}/api/sonar/zone-medians`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const data = await res.json()
  return data.medians
}

export async function reGeocodeSonarSignals(): Promise<{ queued: number }> {
  const res = await authFetch(`${BASE}/api/sonar/re-geocode`, { method: 'POST' })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function fetchSonarZones(): Promise<SonarState[]> {
  const res = await authFetch(`${BASE}/api/sonar/zones`)
  if (!res.ok) return []
  const data = await res.json()
  return data.states ?? []
}

export async function fetchTeam(): Promise<TeamMember[]> {
  const res = await authFetch(`${BASE}/api/team`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createTeamMember(data: { name: string; role: MemberRole; managerId?: number | null; email?: string; notes?: string }): Promise<TeamMember> {
  const res = await authFetch(`${BASE}/api/team`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteTeamMember(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/team/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

export async function updateTeamMember(id: number, data: { name?: string; role?: MemberRole; managerId?: number | null; email?: string; notes?: string }): Promise<TeamMember> {
  const res = await authFetch(`${BASE}/api/team/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

// ─── Process templates ────────────────────────────

export async function fetchTemplates(): Promise<ProcessTemplate[]> {
  const res = await authFetch(`${BASE}/api/process/templates`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createTemplate(data: { name: string; description?: string }): Promise<ProcessTemplate> {
  const res = await authFetch(`${BASE}/api/process/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function updateTemplate(id: number, data: Partial<Pick<ProcessTemplate, 'name' | 'description'>>): Promise<ProcessTemplate> {
  const res = await authFetch(`${BASE}/api/process/templates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteTemplate(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/process/templates/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

export async function fetchTemplatePreview(tid: number): Promise<{ template: ProcessTemplate; nodes: GanttNode[] }> {
  const res = await authFetch(`${BASE}/api/process/templates/${tid}/preview`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// ─── Template nodes ───────────────────────────────

export async function fetchTemplateNodes(tid: number): Promise<TemplateNode[]> {
  const res = await authFetch(`${BASE}/api/process/templates/${tid}/nodes`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
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
  const res = await authFetch(`${BASE}/api/process/templates/${tid}/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function updateNode(nid: number, data: {
  name?: string
  description?: string
  sortOrder?: number
  dependsOnId?: number | null
  durationDays?: number | null
  supplierCategoryId?: number | null
}): Promise<TemplateNode> {
  const res = await authFetch(`${BASE}/api/process/nodes/${nid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteNode(nid: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/process/nodes/${nid}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

// ─── Process instances ────────────────────────────

export async function fetchInstances(propertyId?: number): Promise<ProcessInstance[]> {
  const params = new URLSearchParams()
  if (propertyId !== undefined) params.set('property_id', String(propertyId))
  const url = `${BASE}/api/process/instances${params.size ? `?${params}` : ''}`
  const res = await authFetch(url)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
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
  const res = await authFetch(`${BASE}/api/process/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
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
  const res = await authFetch(`${BASE}/api/process/instances/${iid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function fetchInstanceDetail(iid: number): Promise<InstanceDetail & { files: InstanceFile[] }> {
  const res = await authFetch(`${BASE}/api/process/instances/${iid}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// ─── Instance files ───────────────────────────────────────────────────────────

export async function fetchInstanceFiles(iid: number): Promise<InstanceFile[]> {
  const res = await authFetch(`${BASE}/api/process/instances/${iid}/files`)
  if (!res.ok) throw new Error(`fetchInstanceFiles: ${res.status}`)
  return res.json()
}

export async function uploadInstanceFile(iid: number, file: File): Promise<InstanceFile> {
  const form = new FormData()
  form.append('file', file)
  const res = await authFetch(`${BASE}/api/process/instances/${iid}/files`, { method: 'POST', body: form })
  return res.json()
}

export async function deleteInstanceFile(fid: number): Promise<void> {
  await authFetch(`${BASE}/api/process/instance-files/${fid}`, { method: 'DELETE' })
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
  const res = await authFetch(`${BASE}/api/process/instances/${iid}/nodes/${nid}/state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

// ─── Node files ──────────────────────────────────────────────────────────────

export async function fetchNodeFiles(nid: number, instanceId?: number): Promise<NodeFile[]> {
  const qs = instanceId != null ? `?instance_id=${instanceId}` : ''
  const res = await authFetch(`${BASE}/api/process/nodes/${nid}/files${qs}`)
  if (!res.ok) throw new Error('Failed to fetch files')
  return res.json()
}

export async function uploadNodeFile(
  nid: number,
  file: File,
  instanceId?: number,
): Promise<NodeFile> {
  const form = new FormData()
  form.append('file', file)
  if (instanceId != null) form.append('instance_id', String(instanceId))
  const res = await authFetch(`${BASE}/api/process/nodes/${nid}/files`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteNodeFile(fid: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/process/files/${fid}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

// ─── Node comments ───────────────────────────────────────────────────────────

export async function fetchNodeComments(iid: number, nid: number): Promise<NodeComment[]> {
  const res = await authFetch(`${BASE}/api/process/instances/${iid}/nodes/${nid}/comments`)
  if (!res.ok) throw new Error('Failed to fetch comments')
  return res.json()
}

export async function createNodeComment(
  iid: number,
  nid: number,
  body: string,
  author: string,
): Promise<NodeComment> {
  const res = await authFetch(`${BASE}/api/process/instances/${iid}/nodes/${nid}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, author }),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteNodeComment(cid: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/process/comments/${cid}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

// ─── Node detail ─────────────────────────────────────────────────────────────

export async function fetchNodeDetail(iid: number, nid: number): Promise<NodeDetail> {
  const res = await authFetch(`${BASE}/api/process/instances/${iid}/nodes/${nid}`)
  if (!res.ok) throw new Error('Failed to fetch node detail')
  return res.json()
}

// ─── Profit split ─────────────────────────────────────────────────────────────

export async function fetchProfitTemplate(): Promise<ProfitSplitConfig> {
  const res = await authFetch(`${BASE}/api/profit/template`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateProfitTemplate(data: Partial<ProfitSplitConfig>): Promise<ProfitSplitConfig> {
  const res = await authFetch(`${BASE}/api/profit/template`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function fetchPropertyProfit(id: number): Promise<{ config: ProfitSplitConfig; waterfall: ProfitWaterfall }> {
  const res = await authFetch(`${BASE}/api/properties/${id}/profit`)
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function updatePropertyProfit(id: number, data: Partial<ProfitSplitConfig>): Promise<{ config: ProfitSplitConfig; waterfall: ProfitWaterfall }> {
  const res = await authFetch(`${BASE}/api/properties/${id}/profit`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

// ─── Investors ────────────────────────────────────────────────────────────────

export async function fetchInvestors(): Promise<Investor[]> {
  const res = await authFetch(`${BASE}/api/investors`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchInvestor(id: number): Promise<Investor & { positions: PropertyInvestor[] }> {
  const res = await authFetch(`${BASE}/api/investors/${id}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createInvestor(data: Omit<Investor, 'id' | 'createdAt' | 'totalInterested' | 'totalCommitted' | 'totalFunded'>): Promise<Investor> {
  const res = await authFetch(`${BASE}/api/investors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function updateInvestor(id: number, data: Partial<Pick<Investor, 'name' | 'apellidos' | 'email' | 'phone' | 'notes' | 'temperatura' | 'capacidad' | 'fuente' | 'confianza'>>): Promise<Investor> {
  const res = await authFetch(`${BASE}/api/investors/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteInvestor(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/investors/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

export async function fetchPropertyInvestors(propertyId: number): Promise<PropertyInvestor[]> {
  const res = await authFetch(`${BASE}/api/properties/${propertyId}/investors`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function addPropertyInvestor(
  propertyId: number,
  // Sin `status`: el embudo lo deriva el servidor de los montos en cada escritura.
  data: { investorId: number; interestedAmount: number; committedAmount: number; fundedAmount: number; interestRateAnnual: number; investmentDate: string | null; notes: string }
): Promise<PropertyInvestor> {
  const res = await authFetch(`${BASE}/api/properties/${propertyId}/investors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function updatePropertyInvestment(
  propertyId: number,
  investmentId: number,
  data: Partial<{ interestedAmount: number; committedAmount: number; fundedAmount: number; interestRateAnnual: number; investmentDate: string | null; returnAmount: number | null; returnDate: string | null; notes: string }>
): Promise<PropertyInvestor> {
  const res = await authFetch(`${BASE}/api/properties/${propertyId}/investors/${investmentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deletePropertyInvestment(propertyId: number, investmentId: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/properties/${propertyId}/investors/${investmentId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

// ─── Zones ───────────────────────────────────────────────────────────────────

export async function fetchZones(): Promise<Zone[]> {
  const res = await authFetch(`${BASE}/api/zones`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// ─── Comparables ─────────────────────────────────────────────────────────────

export async function fetchComparables(status?: string, zoneId?: number): Promise<Comparable[]> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (zoneId) params.set('zone_id', String(zoneId))
  const qs = params.size ? `?${params}` : ''
  const res = await authFetch(`${BASE}/api/comparables${qs}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createComparable(data: Partial<Comparable>): Promise<Comparable> {
  const res = await authFetch(`${BASE}/api/comparables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function updateComparable(id: number, data: Partial<Comparable>): Promise<Comparable> {
  const res = await authFetch(`${BASE}/api/comparables/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteComparable(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/comparables/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

// ─── Auth / Me ────────────────────────────────────────────────────────────────

export async function fetchMe(): Promise<{ email: string }> {
  const res = await authFetch(`${BASE}/api/auth/me`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await authFetch(`${BASE}/api/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  if (!res.ok) throw new Error(await detail(res))
}

// ─── User management ─────────────────────────────────────────────────────────

export async function fetchUsers(): Promise<User[]> {
  const res = await authFetch(`${BASE}/api/users`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createUser(email: string, password: string): Promise<User> {
  const res = await authFetch(`${BASE}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function updateUser(id: number, data: { isActive?: boolean; password?: string }): Promise<User> {
  const res = await authFetch(`${BASE}/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteUser(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/users/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

// ── Proveedor Categories ──────────────────────────────────────────────────────

export async function getCategories(): Promise<ProveedorCategory[]> {
  const res = await authFetch(`${BASE}/api/proveedor-categories`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function createCategory(data: { name: string; description?: string }): Promise<ProveedorCategory> {
  const res = await authFetch(`${BASE}/api/proveedor-categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function updateCategory(id: number, data: Partial<Pick<ProveedorCategory, 'name' | 'description'>>): Promise<ProveedorCategory> {
  const res = await authFetch(`${BASE}/api/proveedor-categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteCategory(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/proveedor-categories/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

// ── Proveedores ───────────────────────────────────────────────────────────────

export async function getProveedores(categoryId?: number): Promise<Proveedor[]> {
  const url = categoryId != null
    ? `${BASE}/api/proveedores?category_id=${categoryId}`
    : `${BASE}/api/proveedores`
  const res = await authFetch(url)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getProveedor(id: number): Promise<Proveedor> {
  const res = await authFetch(`${BASE}/api/proveedores/${id}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getProveedorAssignments(id: number): Promise<import('./types').ProveedorAssignment[]> {
  const res = await authFetch(`${BASE}/api/proveedores/${id}/assignments`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function createProveedor(data: Partial<Proveedor> & { name: string }): Promise<Proveedor> {
  const res = await authFetch(`${BASE}/api/proveedores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function updateProveedor(id: number, data: Partial<Proveedor>): Promise<Proveedor> {
  const res = await authFetch(`${BASE}/api/proveedores/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteProveedor(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/proveedores/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

export async function setProveedorCategories(id: number, categoryIds: number[]): Promise<Proveedor> {
  const res = await authFetch(`${BASE}/api/proveedores/${id}/categories`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryIds }),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function uploadProveedorPhoto(id: number, file: File): Promise<ProveedorPhoto> {
  const fd = new FormData()
  fd.append('file', file, file.name)
  const res = await authFetch(`${BASE}/api/proveedores/${id}/photos`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteProveedorPhoto(proveedorId: number, photoId: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/proveedores/${proveedorId}/photos/${photoId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

// ── Cotizaciones ──────────────────────────────────────────────────────────────

export async function getCotizaciones(stateId: number): Promise<Cotizacion[]> {
  const res = await authFetch(`${BASE}/api/instance-node-states/${stateId}/cotizaciones`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function createCotizacion(stateId: number, data: Partial<Cotizacion>): Promise<Cotizacion> {
  const res = await authFetch(`${BASE}/api/instance-node-states/${stateId}/cotizaciones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function updateCotizacion(id: number, data: Partial<Cotizacion>): Promise<Cotizacion> {
  const res = await authFetch(`${BASE}/api/cotizaciones/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function selectCotizacion(id: number, instanceNodeStateId: number): Promise<Cotizacion> {
  const res = await authFetch(`${BASE}/api/cotizaciones/${id}/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceNodeStateId }),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function deleteCotizacion(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/cotizaciones/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await detail(res))
}

// ── Floor-plan geometry ──

export async function fetchPropertyGeometry(id: number): Promise<FloorPlanModel | Record<string, never>> {
  const res = await authFetch(`${BASE}/api/properties/${id}/geometry`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function savePropertyGeometry(id: number, geometry: FloorPlanModel): Promise<FloorPlanModel> {
  const res = await authFetch(`${BASE}/api/properties/${id}/geometry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geometry }),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function uploadFloorplanImage(id: number, file: File): Promise<{ imageKey: string }> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await authFetch(`${BASE}/api/properties/${id}/floorplan-image`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

// ── Presupuesto de obra ───────────────────────────────────────────────────────
//
// Anidado bajo la propiedad porque eso es: el presupuesto no existe sin ella y
// no se comparte con ninguna otra. Y SIN VENTANA DE ETAPA — acompaña a la
// propiedad desde prospecto, como el desglose de costos, no como una
// herramienta que se abre en desarrollo. Hay que poder presupuestar antes de
// ofertar.

const budgetUrl = (propertyId: number, path = '') =>
  `${BASE}/api/properties/${propertyId}/budget${path}`

/**
 * Toda escritura del presupuesto responde lo mismo, así que se lee en un solo
 * lugar. Crear, editar, borrar, pagar, despagar, renombrar un capítulo y
 * ajustar el total son la misma forma: un camino de código, no siete.
 */
async function budgetWrite(url: string, method: string, body?: unknown): Promise<BudgetWrite> {
  const res = await authFetch(url, {
    method,
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export async function fetchBudget(propertyId: number): Promise<Budget> {
  const res = await authFetch(budgetUrl(propertyId))
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

export function createBudgetLine(propertyId: number, data: BudgetLineCreate): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, '/lines'), 'POST', data)
}

/**
 * A diferencia de `updateProperty`, aquí los `null` NO se filtran: van, y
 * significan vaciar. La ficha se edita con un botón GUARDAR y ahí una caja en
 * blanco quiere decir «no la toques»; una celda del presupuesto se guarda al
 * soltarla, y ahí dejarla vacía es justo lo que se está pidiendo. Por eso el
 * presupuesto no necesita el clear-fields que sí necesita la ficha.
 */
export function updateBudgetLine(
  propertyId: number, lineId: number, data: BudgetLinePatch,
): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, `/lines/${lineId}`), 'PATCH', data)
}

export function deleteBudgetLine(propertyId: number, lineId: number): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, `/lines/${lineId}`), 'DELETE')
}

/**
 * La operación que SÍ mueve cuánto va a costar la obra, moviendo el residuo.
 * Existe aparte de detallar precisamente para que las dos se distingan:
 * detallar reparte un total que no cambia, esto cambia el total sin tocar una
 * sola partida. Mezclarlas volvería imposible contestar si el presupuesto
 * creció o solo se abrió.
 */
export function setBudgetTotal(propertyId: number, amount: number): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, '/total'), 'PUT', { amount })
}

/**
 * Renombrar y borrar un capítulo son las dos únicas operaciones que tocan
 * varios renglones a la vez; hacerlas renglón por renglón dejaría el
 * presupuesto a medio renombrar si algo falla en medio.
 */
export function renameBudgetChapter(
  propertyId: number, chapter: string, name: string,
): Promise<BudgetWrite> {
  return budgetWrite(
    budgetUrl(propertyId, `/chapters/${encodeURIComponent(chapter)}`), 'PATCH', { name },
  )
}

export function deleteBudgetChapter(propertyId: number, chapter: string): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, `/chapters/${encodeURIComponent(chapter)}`), 'DELETE')
}

export function addBudgetPayment(
  propertyId: number, lineId: number, data: BudgetPaymentCreate,
): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, `/lines/${lineId}/payments`), 'POST', data)
}

export function deleteBudgetPayment(
  propertyId: number, lineId: number, paymentId: number,
): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, `/lines/${lineId}/payments/${paymentId}`), 'DELETE')
}

/**
 * Arrancar desde otra obra o desde una plantilla. **Es la misma llamada**, y no
 * por ahorro: una plantilla es un presupuesto sin propiedad, así que distinguir
 * el origen aquí sería inventar una diferencia que el modelo no tiene.
 *
 * Los renglones se SUMAN a lo que ya hubiera y el residuo baja lo que ellos
 * suben: el total no se mueve, igual que al detallar a mano.
 */
export function applyBudgetSource(propertyId: number, budgetId: number): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, '/apply'), 'POST', { budgetId })
}

/** Baja un capítulo entero del catálogo como esqueleto: cantidad 0 y precio 0. */
export function applyCatalogChapter(propertyId: number, chapterId: number): Promise<BudgetWrite> {
  return budgetWrite(budgetUrl(propertyId, '/apply-chapter'), 'POST', { chapterId })
}

// ── El catálogo de obra ───────────────────────────────────────────────────────
//
// NO va anidado bajo una propiedad, al revés que el presupuesto, y la diferencia
// dice lo que son: un presupuesto no existe sin su obra, mientras que el
// catálogo es lo que todas las obras COMPARTEN — la memoria de qué partidas
// existen y cómo se llaman.
//
// Que compartan memoria y no números es la línea que este módulo cuida: ninguna
// de estas funciones devuelve `property`, porque nada de lo que se hace en el
// catálogo puede mover un peso de ninguna obra. Las dos que sí lo hacen
// —aplicar una plantilla, bajar un capítulo— viven arriba, del lado de la
// propiedad, y devuelven `BudgetWrite` como toda escritura de presupuesto.

const catalogUrl = (path = '') => `${BASE}/api/budget/catalog${path}`

async function catalogRead<T>(url: string): Promise<T> {
  const res = await authFetch(url)
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

async function catalogWrite<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await authFetch(url, {
    method,
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })
  if (!res.ok) throw new Error(await detail(res))
  return res.json()
}

/**
 * El catálogo entero, capítulos con sus partidas.
 *
 * `includeInactive` es para la pantalla que lo CURA, que necesita ver lo apagado
 * para poder reactivarlo. Todo lo demás —el aviso de duplicado, bajar un
 * capítulo a una obra— lee solo lo vivo.
 */
export function fetchBudgetCatalog(
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<BudgetCatalogChapter[]> {
  return catalogRead(catalogUrl(includeInactive ? '?includeInactive=true' : ''))
}

/**
 * `supplierCategoryId` es el OFICIO del capítulo — el nivel donde de verdad
 * vive, porque se contrata al albañil y no a «colocación de piso 60×60». Se
 * omite al dar de alta: el catálogo se forma tecleando, y exigirlo aquí pondría
 * una aduana en la operación que tiene que ser barata.
 */
export function createCatalogChapter(
  name: string, data: { supplierCategoryId?: number | null } = {},
): Promise<BudgetCatalogChapterRow> {
  return catalogWrite(catalogUrl('/chapters'), 'POST', { name, ...data })
}

export function updateCatalogChapter(
  id: number,
  patch: {
    name?: string; sortOrder?: number; isActive?: boolean
    supplierCategoryId?: number | null
  },
): Promise<BudgetCatalogChapterRow> {
  return catalogWrite(catalogUrl(`/chapters/${id}`), 'PATCH', patch)
}

/**
 * **DA DE BAJA, NO BORRA**, y el verbo miente un poco a propósito para no
 * inventar una ruta paralela: el servidor pone `is_active = FALSE` y contesta la
 * fila apagada. Se llama por lo que hace y no por su verbo, porque quien lee
 * esta llamada necesita saber lo segundo. Revivirla es un PATCH con
 * `isActive: true` — por eso no hay un `reactivate` aparte.
 */
export function deactivateCatalogChapter(id: number): Promise<BudgetCatalogChapterRow> {
  return catalogWrite(catalogUrl(`/chapters/${id}`), 'DELETE')
}

/**
 * Sin `supplierCategoryId` la partida HEREDA el oficio de su capítulo, que es el
 * caso normal — se declara solo para la excepción real, como el
 * impermeabilizador dentro de azoteas.
 */
export function createCatalogItem(
  data: { chapterId: number; name: string; unit: string; supplierCategoryId?: number | null },
): Promise<BudgetCatalogItem> {
  return catalogWrite(catalogUrl('/items'), 'POST', data)
}

/**
 * Corregir el catálogo NO toca ningún presupuesto ya capturado, ni el texto ni
 * el importe: instanciar copia, y nada vuelve a leer esta fila. Es el invariante
 * central de la fase y no cuesta una línea de código sostenerlo.
 */
export function updateCatalogItem(
  id: number,
  patch: {
    name?: string; unit?: string; chapterId?: number; sortOrder?: number; isActive?: boolean
    /** `null` devuelve la partida a heredar el oficio de su capítulo. */
    supplierCategoryId?: number | null
  },
): Promise<BudgetCatalogItem> {
  return catalogWrite(catalogUrl(`/items/${id}`), 'PATCH', patch)
}

/** Da de baja la partida. Los renglones que ya la citan conservan su procedencia. */
export function deactivateCatalogItem(id: number): Promise<BudgetCatalogItem> {
  return catalogWrite(catalogUrl(`/items/${id}`), 'DELETE')
}

/**
 * «¿Es la misma que ésta?», contestado mientras alguien escribe.
 *
 * Es la única pieza que evita que el catálogo se pudra, y aquí pesa más que en
 * cualquier otro proyecto: no hay presupuestos viejos que importar, así que la
 * única fuente del catálogo es lo que se teclee de aquí en adelante. Un nombre
 * partido en tres variantes nunca junta tres observaciones de nada.
 *
 * `lineId` excluye el renglón que se está editando para que no se sugiera a sí
 * mismo. Al escribir uno nuevo no hace falta: todavía no existe.
 *
 * SUGIERE, no bloquea. La similitud ordena candidatos; quien decide que dos
 * nombres son la misma partida es una persona.
 */
export function suggestBudgetItems(
  name: string, { limit = 5, lineId }: { limit?: number; lineId?: number } = {},
): Promise<BudgetItemSuggestion[]> {
  const params = new URLSearchParams({ name, limit: String(limit) })
  if (lineId != null) params.set('lineId', String(lineId))
  return catalogRead(catalogUrl(`/suggest?${params}`))
}

/**
 * Los renglones sueltos agrupados por nombre normalizado. Lo que el catálogo
 * todavía no sabe y ya se escribió más de una vez, ordenado por en cuántas OBRAS
 * aparece: la máquina ordena, el humano decide.
 */
export function fetchPromotionQueue(limit = 20): Promise<BudgetPromotionGroup[]> {
  return catalogRead(catalogUrl(`/promotion-queue?limit=${limit}`))
}

/**
 * Sube un renglón suelto al catálogo y religa hacia atrás su grupo entero: la
 * partida nace **ya sabiendo lo que cuesta**, con toda la historia que ya existía
 * apuntándole en vez de empezar a contar desde cero.
 *
 * Se pide por el RENGLÓN y no por el nombre porque el renglón ya trae su texto,
 * su unidad y su capítulo: repetirlos en la petición sería darle al cliente la
 * oportunidad de mandar unos distintos de los que se van a religar.
 *
 * `itemId` fusiona con una partida que ya existe —la operación que de verdad
 * hacía falta, porque el problema del catálogo nunca fue agregar—; `chapterId`
 * la crea en otro capítulo. **Sin ninguno de los dos nace donde el renglón ya
 * decía, y el capítulo se crea si no existía**: por eso el catálogo vacío no
 * necesita un paso previo desde el cliente.
 *
 * Explícito y con un clic, nunca automático: un catálogo que crece solo se
 * llena de duplicados casi iguales, y el problema no es agregar, es fusionar.
 */
export function promoteBudgetLine(
  lineId: number, target: { chapterId?: number; itemId?: number } = {},
): Promise<BudgetPromotion> {
  return catalogWrite(catalogUrl('/promote'), 'POST', { lineId, ...target })
}

// ── Plantillas ────────────────────────────────────────────────────────────────
//
// Una plantilla es un presupuesto sin propiedad, así que su `id` es un id de
// presupuesto y se pasa tal cual a `applyBudgetSource`, igual que el de la obra
// de al lado. Ésa es toda la maquinaria detrás de «arrancar desde plantilla» y
// «arrancar desde otra obra».

/**
 * De dónde se puede copiar: plantillas Y obras, en una sola lista, porque son la
 * misma cosa. El servidor las manda ya ordenadas —plantillas primero, luego
 * obras, cada bloque alfabético— así que el selector las pinta tal cual.
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
export function fetchBudgetSources(excludePropertyId?: number): Promise<BudgetSource[]> {
  const query = excludePropertyId != null ? `?excludePropertyId=${excludePropertyId}` : ''
  return catalogRead(`${BASE}/api/budget/sources${query}`)
}

const templatesUrl = (path = '') => `${BASE}/api/budget/templates${path}`

export function fetchBudgetTemplates(): Promise<BudgetTemplate[]> {
  return catalogRead(templatesUrl())
}

/**
 * Nace vacía, o copiando cualquier presupuesto: el de una obra —«guarda ésta
 * como plantilla»— o el de otra plantilla. Un solo camino para las tres.
 */
export function createBudgetTemplate(
  data: { name: string; fromBudgetId?: number },
): Promise<BudgetTemplateDetail> {
  return catalogWrite(templatesUrl(), 'POST', data)
}

export function updateBudgetTemplate(
  id: number, patch: { name?: string; notes?: string },
): Promise<BudgetTemplateDetail> {
  return catalogWrite(templatesUrl(`/${id}`), 'PATCH', patch)
}

/**
 * Se borra de verdad, y no contradice la baja lógica del catálogo: después de
 * copiar, nada cita a una plantilla — los renglones que salieron de ella se
 * llevaron el texto. No hay procedencia que romper porque nunca la hubo.
 */
export function deleteBudgetTemplate(id: number): Promise<BudgetTemplateDetail> {
  return catalogWrite(templatesUrl(`/${id}`), 'DELETE')
}
