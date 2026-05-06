import type { Prospect, QualityEntry, RawFields, Project, RawProjectFields, Signal } from './types'

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
