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

/** A property as the tests read it back — the raw columns they set, plus status. */
export interface PropertyRow {
  id: number
  name: string
  status: string
}

/**
 * A property is born a `prospecto`: POST cannot set a status, so a fixture that
 * needs a later stage walks there through `transitionProperty`.
 */
export async function createProperty(
  request: APIRequestContext,
  data: Record<string, unknown>,
  token: string,
): Promise<PropertyRow> {
  const res = await request.post(`${API_BASE}/api/properties`, {
    headers: await authHeaders(token),
    data,
  })
  if (!res.ok()) throw new Error(`createProperty failed: ${res.status()} ${await res.text()}`)
  return res.json() as Promise<PropertyRow>
}

export async function deleteProperty(
  request: APIRequestContext,
  id: number,
  token: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/properties/${id}`, {
    headers: await authHeaders(token),
  })
}

/**
 * Deletes every match, so a retried worker never trips over its own leftovers.
 * Archived rows are included: a lifecycle test can park a fixture there, and a
 * leftover nobody lists is a leftover nobody cleans.
 */
export async function deletePropertyByName(
  request: APIRequestContext,
  name: string,
  token: string,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/properties?include_archived=true`, {
    headers: await authHeaders(token),
  })
  const list = await res.json() as PropertyRow[]
  for (const target of list.filter(p => p.name === name)) {
    await deleteProperty(request, target.id, token)
  }
}

/**
 * Empties allowlisted fields. It is the only way a value goes away, which is
 * how a fixture can be given an *incomplete* underwriting breakdown — the state
 * that makes its capital base a manual figure.
 */
export async function clearPropertyFields(
  request: APIRequestContext,
  id: number,
  fields: string[],
  token: string,
): Promise<PropertyRow> {
  const res = await request.post(`${API_BASE}/api/properties/${id}/clear-fields`, {
    headers: await authHeaders(token),
    data: { fields },
  })
  if (!res.ok()) throw new Error(`clearFields failed: ${res.status()} ${await res.text()}`)
  return res.json() as Promise<PropertyRow>
}

/**
 * Raises values on a property — the PATCH door of the three.
 *
 * It only ever sets: an absent key means "leave it", and emptying has its own
 * door (`clearPropertyFields`). Use it to arrange a precondition that the test
 * is not itself exercising; when the capture IS the subject, drive the UI.
 */
export async function patchProperty(
  request: APIRequestContext,
  id: number,
  fields: Record<string, unknown>,
  token: string,
): Promise<PropertyRow> {
  const res = await request.patch(`${API_BASE}/api/properties/${id}`, {
    headers: await authHeaders(token),
    data: fields,
  })
  if (!res.ok()) throw new Error(`patch failed: ${res.status()} ${await res.text()}`)
  return res.json() as Promise<PropertyRow>
}

/**
 * Moves a property one stage forward. `body.to` names the destination and the
 * rest of the body is what that stage demands — the same typed contract the
 * AVANZAR A ▸ modal posts.
 */
export async function transitionProperty(
  request: APIRequestContext,
  id: number,
  body: Record<string, unknown>,
  token: string,
): Promise<PropertyRow> {
  const res = await request.post(`${API_BASE}/api/properties/${id}/transition`, {
    headers: await authHeaders(token),
    data: body,
  })
  if (!res.ok()) throw new Error(`transition to ${body.to} failed: ${res.status()} ${await res.text()}`)
  return res.json() as Promise<PropertyRow>
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

/**
 * Points a tarea at a property, creating it the first time and reusing it ever
 * after. Its FK is ON DELETE NO ACTION, so while it points there the property
 * cannot be deleted — which is the only way to reach that refusal from the UI.
 *
 * Reuse rather than create-per-run because the API has no DELETE for instances
 * (see `deleteInstance`): a fresh one each time would pile up forever, and a
 * pile of stray tareas is a landmine for any spec that reads the list.
 */
export async function attachInstanceToProperty(
  request: APIRequestContext,
  name: string,
  propertyId: number,
  token: string,
): Promise<{ id: number }> {
  const list = await request.get(`${API_BASE}/api/process/instances`, {
    headers: await authHeaders(token),
  })
  const existing = (await list.json() as Array<{ name: string; id: number }>).find(i => i.name === name)
  const res = existing
    ? await request.patch(`${API_BASE}/api/process/instances/${existing.id}`, {
        headers: await authHeaders(token),
        data: { propertyId },
      })
    : await request.post(`${API_BASE}/api/process/instances`, {
        headers: await authHeaders(token),
        data: { name, startDate: new Date().toISOString().slice(0, 10), status: 'active', propertyId },
      })
  if (!res.ok()) throw new Error(`attachInstanceToProperty failed: ${res.status()} ${await res.text()}`)
  const body = await res.json() as { id?: number; instance?: { id: number } }
  return { id: body.instance?.id ?? body.id ?? existing!.id }
}

/**
 * Frees the property a tarea is attached to. It is the closest thing to a
 * cleanup available: the tarea itself survives, because it cannot be removed.
 */
export async function detachInstance(
  request: APIRequestContext,
  id: number,
  token: string,
): Promise<void> {
  const res = await request.patch(`${API_BASE}/api/process/instances/${id}`, {
    headers: await authHeaders(token),
    data: { propertyId: null },
  })
  if (!res.ok()) throw new Error(`detachInstance failed: ${res.status()} ${await res.text()}`)
}

/**
 * NO-OP — kept because specs call it, but the API has no DELETE for instances:
 * `/api/process/instances/{id}` answers 405, and this swallows it. A tarea
 * created by a test therefore outlives the test. Use `detachInstance` when what
 * you need is to free the property it points at.
 */
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
