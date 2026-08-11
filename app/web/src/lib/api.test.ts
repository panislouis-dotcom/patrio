import { describe, it, expect, vi } from 'vitest'
import { updateProperty, clearPropertyFields, generatePropertyRenderFromPlan } from './api'

// La sesión no es lo que se está probando: aquí importa qué sale por el cable.
vi.mock('./auth', () => ({ getToken: () => 'test-token', clearToken: () => {} }))

function stubFetch(payload: unknown = { id: 1 }) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    ({ ok: true, status: 200, json: async () => payload }))
  vi.stubGlobal('fetch', fn)
  return fn
}

const bodyOf = (fn: ReturnType<typeof stubFetch>, call = 0) =>
  JSON.parse(fn.mock.calls[call][1]!.body as string)

describe('updateProperty', () => {
  it('deja fuera los nulls: un PATCH sube valores, nunca los quita', async () => {
    const fetchMock = stubFetch()
    // rentMonthlyProjected viene en null porque el lector lo leyó vacío de la propiedad;
    // eso no es una orden de borrarlo.
    await updateProperty(1, { city: 'Saltillo', rentMonthlyProjected: null, totalUnits: undefined })

    expect(bodyOf(fetchMock)).toEqual({ city: 'Saltillo' })
  })

  it('manda un cuerpo vacío antes que inventar una escritura', async () => {
    const fetchMock = stubFetch()
    await updateProperty(1, { purchasePrice: null })

    expect(bodyOf(fetchMock)).toEqual({})
  })

  it('respeta el 0, que sí es un valor', async () => {
    const fetchMock = stubFetch()
    await updateProperty(1, { permitsCost: 0 })

    expect(bodyOf(fetchMock)).toEqual({ permitsCost: 0 })
  })
})

describe('clearPropertyFields', () => {
  it('es la única puerta para vaciar, y lo dice por su nombre', async () => {
    const fetchMock = stubFetch()
    await clearPropertyFields(1, ['rentMonthlyProjected', 'currentValuation'])

    expect(fetchMock.mock.calls[0][0]).toContain('/api/properties/1/clear-fields')
    expect(bodyOf(fetchMock)).toEqual({ fields: ['rentMonthlyProjected', 'currentValuation'] })
  })
})

describe('generatePropertyRenderFromPlan', () => {
  it('manda `variant` en el FormData — el servidor la exige (Tarea 14) y sin ella contesta 422', async () => {
    const fetchMock = stubFetch()
    const plan = new Blob(['x'], { type: 'image/png' })
    await generatePropertyRenderFromPlan(1, { promptText: 'Amuebla', promptId: null, plan, variant: 'planned' })

    const form = fetchMock.mock.calls[0][1]!.body as FormData
    expect(form.get('variant')).toBe('planned')
    expect(form.get('promptText')).toBe('Amuebla')
  })
})
