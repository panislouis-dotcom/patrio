import { describe, it, expect, vi } from 'vitest'
import { updateProperty, clearPropertyFields, generatePropertyRenderFromPlan, listRenderPrompts, createRenderPrompt, replaceFeeTiers } from './api'

// La sesión no es lo que se está probando: aquí importa qué sale por el cable.
vi.mock('./auth', () => ({ getToken: () => 'test-token', clearToken: () => {} }))

function stubFetch(payload: unknown = { id: 1 }) {
  // `request()` lee el body como texto y parsea él mismo (un 204/body vacío
  // regresa undefined en vez de tronar) — el stub imita Response de verdad.
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    ({ ok: true, status: 200, json: async () => payload,
       text: async () => JSON.stringify(payload) }))
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

describe('replaceFeeTiers', () => {
  it('pega al endpoint del kind correcto y envuelve la lista en `tiers` — así la espera FeeTiersReplaceRequest', async () => {
    const fetchMock = stubFetch([])
    await replaceFeeTiers(1, 'venta', [
      { threshold: 6_500_000, rate: 0.07 },
      { threshold: null, rate: 0.05 },
    ])

    expect(fetchMock.mock.calls[0][0]).toContain('/api/properties/1/fee-tiers/venta')
    expect(bodyOf(fetchMock)).toEqual({
      tiers: [{ threshold: 6_500_000, rate: 0.07 }, { threshold: null, rate: 0.05 }],
    })
  })
})

describe('generatePropertyRenderFromPlan', () => {
  it('manda `variant` en el FormData — el servidor la exige (Tarea 14) y sin ella contesta 422', async () => {
    const fetchMock = stubFetch()
    const plan = new Blob(['x'], { type: 'image/png' })
    await generatePropertyRenderFromPlan(1, {
      promptText: 'Amuebla', promptId: null, plan, variant: 'planned',
      floorId: 'floor-1', floorName: 'Planta Baja',
    })

    const form = fetchMock.mock.calls[0][1]!.body as FormData
    expect(form.get('variant')).toBe('planned')
    expect(form.get('promptText')).toBe('Amuebla')
  })

  it('manda `floorId`/`floorName` en el FormData — el servidor los exige (Tarea 29) y sin ellos contesta 422', async () => {
    const fetchMock = stubFetch()
    const plan = new Blob(['x'], { type: 'image/png' })
    await generatePropertyRenderFromPlan(1, {
      promptText: 'Amuebla', promptId: null, plan, variant: 'planned',
      floorId: 'floor-1', floorName: 'Planta Baja',
    })

    const form = fetchMock.mock.calls[0][1]!.body as FormData
    expect(form.get('floorId')).toBe('floor-1')
    expect(form.get('floorName')).toBe('Planta Baja')
  })
})

describe('listRenderPrompts', () => {
  it('agrega ?kind= cuando se filtra por tipo (Tarea 22, biblioteca partida por kind)', async () => {
    const fetchMock = stubFetch([])
    await listRenderPrompts('plan')

    expect(fetchMock.mock.calls[0][0]).toContain('?kind=plan')
  })

  it('sin kind no manda el filtro — la ficha pide la biblioteca completa y filtra ella misma', async () => {
    const fetchMock = stubFetch([])
    await listRenderPrompts()

    expect(fetchMock.mock.calls[0][0]).not.toContain('kind')
  })
})

describe('createRenderPrompt', () => {
  it('manda el kind explícito en el cuerpo', async () => {
    const fetchMock = stubFetch({ id: 1 })
    await createRenderPrompt('Cálido contemporáneo', 'Piso de madera, tonos cálidos.', 'plan')

    expect(bodyOf(fetchMock)).toEqual({
      name: 'Cálido contemporáneo', body: 'Piso de madera, tonos cálidos.', kind: 'plan',
    })
  })

  it('sin kind, default a "photo" — compat con el backend (Tarea 22)', async () => {
    const fetchMock = stubFetch({ id: 1 })
    await createRenderPrompt('Jardín regional', 'Mezquite y agaves.')

    expect(bodyOf(fetchMock)).toEqual({
      name: 'Jardín regional', body: 'Mezquite y agaves.', kind: 'photo',
    })
  })
})
