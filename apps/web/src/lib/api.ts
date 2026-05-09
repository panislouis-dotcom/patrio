import type { Prospect, QualityEntry, RawFields, Project, RawProjectFields, Signal, TeamMember, MemberRole, ProcessTemplate, TemplateNode, GanttNode, ProcessInstance, NodeState, InstanceDetail, InstanceFile, NodeFile, NodeComment, NodeDetail, ProfitSplitConfig, ProfitWaterfall, Investor, ProjectInvestor, User } from './types'
import { getToken, clearToken } from './auth'

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

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

export async function fetchProspects(): Promise<Prospect[]> {
  const res = await authFetch(`${BASE}/api/prospects`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchProspect(id: number): Promise<Prospect> {
  const res = await authFetch(`${BASE}/api/prospects/${id}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchQuality(): Promise<QualityEntry[]> {
  const res = await authFetch(`${BASE}/api/quality`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateProspect(id: number, data: Partial<RawFields>): Promise<Prospect> {
  const res = await authFetch(`${BASE}/api/prospects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createProspect(data: Omit<RawFields, 'url' | 'notes'> & { url?: string; notes?: string }): Promise<Prospect> {
  const res = await authFetch(`${BASE}/api/prospects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await authFetch(`${BASE}/api/projects`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchProject(id: number): Promise<Project> {
  const res = await authFetch(`${BASE}/api/projects/${id}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateProject(id: number, data: Partial<RawProjectFields>): Promise<Project> {
  const res = await authFetch(`${BASE}/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function runSonarScan(): Promise<{ scanned: number; new: number; errors: { portal: string; error: string }[] }> {
  const res = await authFetch(`${BASE}/api/sonar/scan`, { method: 'POST' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchSignals(status?: string, portal?: string): Promise<Signal[]> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (portal) params.set('portal', portal)
  const url = `${BASE}/api/sonar/signals${params.size ? `?${params}` : ''}`
  const res = await authFetch(url)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function dismissSignal(id: number): Promise<Signal> {
  const res = await authFetch(`${BASE}/api/sonar/signals/${id}`, { method: 'PATCH' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function importSignal(id: number): Promise<{ signal: Signal; prospect: unknown }> {
  const res = await authFetch(`${BASE}/api/sonar/signals/${id}/import`, { method: 'POST' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function deleteTeamMember(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/team/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
}

export async function updateTeamMember(id: number, data: { name?: string; role?: MemberRole; managerId?: number | null; email?: string; notes?: string }): Promise<TeamMember> {
  const res = await authFetch(`${BASE}/api/team/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateTemplate(id: number, data: Partial<Pick<ProcessTemplate, 'name' | 'description'>>): Promise<ProcessTemplate> {
  const res = await authFetch(`${BASE}/api/process/templates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function deleteTemplate(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/process/templates/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateNode(nid: number, data: {
  name?: string
  description?: string
  sortOrder?: number
  dependsOnId?: number | null
  durationDays?: number | null
}): Promise<TemplateNode> {
  const res = await authFetch(`${BASE}/api/process/nodes/${nid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function deleteNode(nid: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/process/nodes/${nid}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
}

// ─── Process instances ────────────────────────────

export async function fetchInstances(projectId?: number): Promise<ProcessInstance[]> {
  const params = new URLSearchParams()
  if (projectId !== undefined) params.set('project_id', String(projectId))
  const url = `${BASE}/api/process/instances${params.size ? `?${params}` : ''}`
  const res = await authFetch(url)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createInstance(data: {
  name: string
  startDate: string
  templateId?: number | null
  projectId?: number | null
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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateInstance(iid: number, data: Partial<{
  name: string
  startDate: string
  status: string
  notes: string
  projectId: number | null
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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
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
  if (!res.ok) throw new Error('Upload failed')
  return res.json()
}

export async function deleteNodeFile(fid: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/process/files/${fid}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Delete failed')
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
  if (!res.ok) throw new Error('Failed to create comment')
  return res.json()
}

export async function deleteNodeComment(cid: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/process/comments/${cid}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Delete failed')
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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchProjectProfit(pid: number): Promise<{ config: ProfitSplitConfig; waterfall: ProfitWaterfall }> {
  const res = await authFetch(`${BASE}/api/projects/${pid}/profit`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateProjectProfit(pid: number, data: Partial<ProfitSplitConfig>): Promise<{ config: ProfitSplitConfig; waterfall: ProfitWaterfall }> {
  const res = await authFetch(`${BASE}/api/projects/${pid}/profit`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// ─── Investors ────────────────────────────────────────────────────────────────

export async function fetchInvestors(): Promise<Investor[]> {
  const res = await authFetch(`${BASE}/api/investors`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchInvestor(id: number): Promise<Investor & { positions: ProjectInvestor[] }> {
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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateInvestor(id: number, data: Partial<Pick<Investor, 'name' | 'apellidos' | 'email' | 'phone' | 'notes'>>): Promise<Investor> {
  const res = await authFetch(`${BASE}/api/investors/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function deleteInvestor(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/investors/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
}

export async function fetchProjectInvestors(projectId: number): Promise<ProjectInvestor[]> {
  const res = await authFetch(`${BASE}/api/projects/${projectId}/investors`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function addProjectInvestor(
  projectId: number,
  data: { investorId: number; status: string; interestedAmount: number; committedAmount: number; fundedAmount: number; interestRateAnnual: number; investmentDate: string | null; notes: string }
): Promise<ProjectInvestor> {
  const res = await authFetch(`${BASE}/api/projects/${projectId}/investors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateProjectInvestment(
  projectId: number,
  investmentId: number,
  data: Partial<{ status: string; interestedAmount: number; committedAmount: number; fundedAmount: number; interestRateAnnual: number; investmentDate: string | null; returnAmount: number | null; returnDate: string | null; notes: string }>
): Promise<ProjectInvestor> {
  const res = await authFetch(`${BASE}/api/projects/${projectId}/investors/${investmentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function deleteProjectInvestment(projectId: number, investmentId: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/projects/${projectId}/investors/${investmentId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
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
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string }
    throw new Error(err.detail ?? `API error: ${res.status}`)
  }
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
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string }
    throw new Error(err.detail ?? `API error: ${res.status}`)
  }
  return res.json()
}

export async function updateUser(id: number, data: { isActive?: boolean; password?: string }): Promise<User> {
  const res = await authFetch(`${BASE}/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string }
    throw new Error(err.detail ?? `API error: ${res.status}`)
  }
  return res.json()
}

export async function deleteUser(id: number): Promise<void> {
  const res = await authFetch(`${BASE}/api/users/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string }
    throw new Error(err.detail ?? `API error: ${res.status}`)
  }
}
