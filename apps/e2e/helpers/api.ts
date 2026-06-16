import type { APIRequestContext } from '@playwright/test'

const API = 'http://localhost:8000'

async function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

export async function getToken(request: APIRequestContext): Promise<string> {
  const email = process.env.E2E_USER
  const password = process.env.E2E_PASS
  if (!email || !password) throw new Error('E2E_USER and E2E_PASS env vars must be set')
  const res = await request.post(`${API}/api/auth/login`, {
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
  const res = await request.get(`${API}/api/prospects`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(p => p.name === name)
  if (target) {
    await request.delete(`${API}/api/prospects/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteInvestorByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API}/api/investors`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(i => i.name === name)
  if (target) {
    await request.delete(`${API}/api/investors/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteTeamMemberByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API}/api/team`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(m => m.name === name)
  if (target) {
    await request.delete(`${API}/api/team/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteTemplateByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API}/api/process/templates`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(t => t.name === name)
  if (target) {
    await request.delete(`${API}/api/process/templates/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteUserByEmail(
  request: APIRequestContext,
  email: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API}/api/users`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ email: string; id: number }>
  const target = list.find(u => u.email === email)
  if (target) {
    await request.delete(`${API}/api/users/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteProveedorByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API}/api/proveedores`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(p => p.name === name)
  if (target) {
    await request.delete(`${API}/api/proveedores/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}

export async function deleteProveedorCategoryByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API}/api/proveedor-categories`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as Array<{ name: string; id: number }>
  const target = list.find(c => c.name === name)
  if (target) {
    await request.delete(`${API}/api/proveedor-categories/${target.id}`, {
      headers: await authHeaders(token),
    })
  }
}
