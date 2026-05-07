import type { Prospect, QualityEntry, RawFields, Project, RawProjectFields, Signal, TeamMember, MemberRole, ProcessTemplate, TemplateNode, ProcessInstance, NodeState, InstanceDetail } from './types'

const BASE = 'http://localhost:8000'

export async function fetchProspects(): Promise<Prospect[]> {
  const res = await fetch(`${BASE}/api/prospects`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchProspect(id: number): Promise<Prospect> {
  const res = await fetch(`${BASE}/api/prospects/${id}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchQuality(): Promise<QualityEntry[]> {
  const res = await fetch(`${BASE}/api/quality`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateProspect(id: number, data: Partial<RawFields>): Promise<Prospect> {
  const res = await fetch(`${BASE}/api/prospects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createProspect(data: Omit<RawFields, 'url' | 'notes'> & { url?: string; notes?: string }): Promise<Prospect> {
  const res = await fetch(`${BASE}/api/prospects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${BASE}/api/projects`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchProject(id: number): Promise<Project> {
  const res = await fetch(`${BASE}/api/projects/${id}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateProject(id: number, data: Partial<RawProjectFields>): Promise<Project> {
  const res = await fetch(`${BASE}/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function runSonarScan(): Promise<{ scanned: number; new: number; errors: { portal: string; error: string }[] }> {
  const res = await fetch(`${BASE}/api/sonar/scan`, { method: 'POST' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchSignals(status?: string, portal?: string): Promise<Signal[]> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (portal) params.set('portal', portal)
  const url = `${BASE}/api/sonar/signals${params.size ? `?${params}` : ''}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function dismissSignal(id: number): Promise<Signal> {
  const res = await fetch(`${BASE}/api/sonar/signals/${id}`, { method: 'PATCH' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function importSignal(id: number): Promise<{ signal: Signal; prospect: unknown }> {
  const res = await fetch(`${BASE}/api/sonar/signals/${id}/import`, { method: 'POST' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchTeam(): Promise<TeamMember[]> {
  const res = await fetch(`${BASE}/api/team`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createTeamMember(data: { name: string; role: MemberRole; managerId?: number | null; notes?: string }): Promise<TeamMember> {
  const res = await fetch(`${BASE}/api/team`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function deleteTeamMember(id: number): Promise<void> {
  const res = await fetch(`${BASE}/api/team/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
}

export async function updateTeamMember(id: number, data: { name?: string; role?: MemberRole; managerId?: number | null; notes?: string }): Promise<TeamMember> {
  const res = await fetch(`${BASE}/api/team/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// ─── Process templates ────────────────────────────

export async function fetchTemplates(): Promise<ProcessTemplate[]> {
  const res = await fetch(`${BASE}/api/process/templates`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createTemplate(data: { name: string; description?: string }): Promise<ProcessTemplate> {
  const res = await fetch(`${BASE}/api/process/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateTemplate(id: number, data: Partial<Pick<ProcessTemplate, 'name' | 'description'>>): Promise<ProcessTemplate> {
  const res = await fetch(`${BASE}/api/process/templates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function deleteTemplate(id: number): Promise<void> {
  const res = await fetch(`${BASE}/api/process/templates/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
}

// ─── Template nodes ───────────────────────────────

export async function fetchTemplateNodes(tid: number): Promise<TemplateNode[]> {
  const res = await fetch(`${BASE}/api/process/templates/${tid}/nodes`)
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
}): Promise<TemplateNode> {
  const res = await fetch(`${BASE}/api/process/templates/${tid}/nodes`, {
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
  const res = await fetch(`${BASE}/api/process/nodes/${nid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function deleteNode(nid: number): Promise<void> {
  const res = await fetch(`${BASE}/api/process/nodes/${nid}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
}

// ─── Process instances ────────────────────────────

export async function fetchInstances(projectId?: number): Promise<ProcessInstance[]> {
  const params = new URLSearchParams()
  if (projectId !== undefined) params.set('project_id', String(projectId))
  const url = `${BASE}/api/process/instances${params.size ? `?${params}` : ''}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function createInstance(data: {
  name: string
  templateId: number
  startDate: string
  projectId?: number | null
  notes?: string
  status?: string
}): Promise<ProcessInstance> {
  const res = await fetch(`${BASE}/api/process/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function updateInstance(iid: number, data: Partial<Pick<ProcessInstance, 'name' | 'startDate' | 'status' | 'notes'>>): Promise<ProcessInstance> {
  const res = await fetch(`${BASE}/api/process/instances/${iid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function fetchInstanceDetail(iid: number): Promise<InstanceDetail> {
  const res = await fetch(`${BASE}/api/process/instances/${iid}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// ─── Node states ──────────────────────────────────

export async function updateNodeState(iid: number, nid: number, data: {
  status?: string
  assigneeId?: number | null
  actualStart?: string | null
  actualEnd?: string | null
  notes?: string
}): Promise<NodeState> {
  const res = await fetch(`${BASE}/api/process/instances/${iid}/nodes/${nid}/state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}
