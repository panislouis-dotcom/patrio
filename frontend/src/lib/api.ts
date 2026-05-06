import type { Prospect, QualityEntry } from './types'

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
