import type { APIRequestContext } from '@playwright/test'

export const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:8000'

async function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

export async function getToken(request: APIRequestContext): Promise<string> {
  const email = process.env.E2E_USER
  const password = process.env.E2E_PASS
  if (!email || !password) throw new Error('E2E_USER and E2E_PASS env vars must be set')
  const res = await request.post(`${API_BASE}/api/auth/login`, {
    data: { email, password },
  })
  const data = await res.json() as { access_token: string }
  return data.access_token
}

export async function deleteProspectByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/prospects`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(p => p.name === name)
  if (target) {
    await request.delete(`${API_BASE}/api/prospects/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteInvestorByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/investors`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(i => i.name === name)
  if (target) {
    await request.delete(`${API_BASE}/api/investors/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteTeamMemberByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/team`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(m => m.name === name)
  if (target) {
    await request.delete(`${API_BASE}/api/team/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteTemplateByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/process/templates`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(t => t.name === name)
  if (target) {
    await request.delete(`${API_BASE}/api/process/templates/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteUserByEmail(
  request: APIRequestContext,
  email: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/users`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ email: string; id: number }>
  const target = list.find(u => u.email === email)
  if (target) {
    await request.delete(`${API_BASE}/api/users/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function createTemplate(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<{ id: number; name: string }> {
  const res = await request.post(`${API_BASE}/api/process/templates`, {
    headers: await authHeaders(token),
    data: { name },
  })
  return res.json() as Promise<{ id: number; name: string }>
}

export async function deleteTemplate(
  request: APIRequestContext,
  id: number,
  token: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/process/templates/${id}`, {
    headers: await authHeaders(token),
  })
}

export async function getTemplates(
  request: APIRequestContext,
  token: string,
): Promise<Array<{ id: number; name: string }>> {
  const res = await request.get(`${API_BASE}/api/process/templates`, {
    headers: await authHeaders(token),
  })
  return res.json() as Promise<Array<{ id: number; name: string }>>
}

export async function createTemplateNode(
  request: APIRequestContext,
  templateId: number,
  name: string,
  token: string,
  extras?: { durationDays?: number; parentId?: number },
): Promise<{ id: number; name: string }> {
  const res = await request.post(`${API_BASE}/api/process/templates/${templateId}/nodes`, {
    headers: await authHeaders(token),
    data: { name, sortOrder: 0, ...extras },
  })
  return res.json() as Promise<{ id: number; name: string }>
}

export async function deleteTemplateNode(
  request: APIRequestContext,
  nodeId: number,
  token: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/process/nodes/${nodeId}`, {
    headers: await authHeaders(token),
  })
}

export async function createInstance(
  request: APIRequestContext,
  name: string,
  templateId: number,
  token: string,
): Promise<{ id: number; name: string }> {
  const res = await request.post(`${API_BASE}/api/process/instances`, {
    headers: await authHeaders(token),
    data: {
      name,
      startDate: new Date().toISOString().slice(0, 10),
      templateId,
      status: 'active',
    },
  })
  return res.json() as Promise<{ id: number; name: string }>
}

export async function deleteInstance(
  request: APIRequestContext,
  id: number,
  token: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/process/instances/${id}`, {
    headers: await authHeaders(token),
  })
}

export async function deleteInstanceByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/process/instances`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  for (const item of list.filter(i => i.name === name)) {
    await request.delete(`${API_BASE}/api/process/instances/${item.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function getInstances(
  request: APIRequestContext,
  token: string,
): Promise<Array<{ id: number; name: string; templateId: number | null }>> {
  const res = await request.get(`${API_BASE}/api/process/instances`, {
    headers: await authHeaders(token),
  })
  return res.json() as Promise<Array<{ id: number; name: string; templateId: number | null }>>
}

export async function deleteComparableByAddress(
  request: APIRequestContext,
  address: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/comparables`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ address: string; id: number }>
  const targets = list.filter(c => c.address === address)
  for (const target of targets) {
    await request.delete(`${API_BASE}/api/comparables/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteComparableById(
  request: APIRequestContext,
  id: number,
  token: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/comparables/${id}`, {
    headers: await authHeaders(token),
  })
}

export async function deleteProveedorByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/proveedores`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(p => p.name === name)
  if (target) {
    await request.delete(`${API_BASE}/api/proveedores/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteProveedorCategoryByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/proveedor-categories`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(c => c.name === name)
  if (target) {
    await request.delete(`${API_BASE}/api/proveedor-categories/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}
