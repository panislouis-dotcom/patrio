import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { BudgetCatalogChapter, BudgetPromotionGroup } from '../../lib/types'
import { PromocionQueuePage } from './PromocionQueuePage'
import * as api from '../../lib/api'

vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    fetchPromotionQueue: vi.fn(),
    fetchBudgetCatalog: vi.fn(),
    promoteBudgetLine: vi.fn(),
  }
})

const group = (over: Partial<BudgetPromotionGroup>): BudgetPromotionGroup => ({
  lineId: 77, normalized: 'piso cerámico 60×60', name: 'Piso cerámico 60×60', unit: 'm²',
  chapterName: 'Acabados', chapters: ['Acabados'],
  usedInLines: 4, properties: 3,
  medianBudgetedUnitPrice: 1_000, medianPaidUnitPrice: 1_180, paidObservations: 2, ...over,
})

const catalogChapter = (
  id: number, name: string, items: BudgetCatalogChapter['items'] = [],
): BudgetCatalogChapter => ({ id, name, sortOrder: 0, isActive: true, items })

const catalogItem = (id: number, chapterId: number, name: string) =>
  ({ id, chapterId, name, unit: 'm²', sortOrder: 0, isActive: true, usedInLines: 0 })

async function renderCola(
  groups: BudgetPromotionGroup[], catalog: BudgetCatalogChapter[] = [],
) {
  vi.mocked(api.fetchPromotionQueue).mockResolvedValue(groups)
  vi.mocked(api.fetchBudgetCatalog).mockResolvedValue(catalog)
  render(<PromocionQueuePage />)
  await screen.findByText('POR PROMOVER AL CATÁLOGO')
}

const promocion = (name: string, relinked: number, created = true) => ({
  item: { id: 99, chapterId: 1, name, unit: 'm²', sortOrder: 0, isActive: true, usedInLines: relinked },
  created,
  relinked,
})

describe('PromocionQueuePage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('promover se pide por el RENGLÓN y su destino, nunca con un importe', async () => {
    // El renglón ya trae su texto, su unidad y su capítulo. Repetirlos en la
    // petición sería darle al cliente la oportunidad de mandar unos distintos de
    // los que se van a religar — y mandar un precio podría reescribir el importe
    // de un presupuesto ya cerrado.
    await renderCola([group({})], [catalogChapter(1, 'Acabados')])
    vi.mocked(api.promoteBudgetLine).mockResolvedValue(promocion('Piso cerámico 60×60', 4))

    fireEvent.click(screen.getByText('AGREGAR AL CATÁLOGO ▸'))

    await waitFor(() => expect(api.promoteBudgetLine).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.promoteBudgetLine).mock.calls[0]).toEqual([77, { chapterId: 1 }])
  })

  it('dice cuántos renglones quedaron religados y que ningún importe se movió', async () => {
    await renderCola([group({})], [catalogChapter(1, 'Acabados')])
    vi.mocked(api.promoteBudgetLine).mockResolvedValue(promocion('Piso cerámico 60×60', 4))

    fireEvent.click(screen.getByText('AGREGAR AL CATÁLOGO ▸'))

    expect(await screen.findByText(/quedaron 4 renglones religados/)).not.toBeNull()
    expect(screen.getByText(/Ningún importe se movió/)).not.toBeNull()
  })

  it('con el catálogo vacío la cola se cura con UN clic y sin alta previa', async () => {
    // Es el estado del día uno. Sin destino explícito el servidor usa el
    // capítulo que el renglón ya traía y lo crea si hace falta, así que el
    // cliente no manda nada: crear el capítulo aquí antes sería un segundo
    // camino a lo mismo, con una ventana en medio donde el capítulo existe y la
    // partida no.
    await renderCola([group({})], [])
    vi.mocked(api.promoteBudgetLine).mockResolvedValue(promocion('Piso cerámico 60×60', 4))

    expect(screen.getByText('En su capítulo «Acabados» (se crea)')).not.toBeNull()
    fireEvent.click(screen.getByText('AGREGAR AL CATÁLOGO ▸'))

    await waitFor(() => expect(api.promoteBudgetLine).toHaveBeenCalledWith(77, {}))
  })

  it('fusionar con una partida que ya existe manda itemId, no capítulo', async () => {
    // Es la operación que de verdad hacía falta: el catálogo se pudre por tener
    // tres variantes de un nombre, no por que le falte una.
    await renderCola([group({})], [
      catalogChapter(1, 'Acabados', [catalogItem(11, 1, 'Piso cerámico')]),
    ])
    vi.mocked(api.promoteBudgetLine).mockResolvedValue(promocion('Piso cerámico', 6, false))

    fireEvent.change(screen.getByLabelText('Destino de Piso cerámico 60×60'), {
      target: { value: 'item:11' },
    })
    fireEvent.click(screen.getByText('AGREGAR AL CATÁLOGO ▸'))

    await waitFor(() => expect(api.promoteBudgetLine).toHaveBeenCalledWith(77, { itemId: 11 }))
    // Y se dice que fue una fusión, no un alta: son cosas distintas
    expect(await screen.findByText(/se fusionó con la del catálogo/)).not.toBeNull()
  })

  it('propone el capítulo donde el renglón ya vive: un clic y listo', async () => {
    await renderCola([group({ chapters: ['Acabados'] })], [
      catalogChapter(1, 'Cimentación'), catalogChapter(2, 'acabados'),
    ])

    // Empata sin importar mayúsculas, como el índice único del catálogo
    expect((screen.getByLabelText('Destino de Piso cerámico 60×60') as HTMLSelectElement).value)
      .toBe('cap:2')
  })

  it('las dos medianas se enseñan con su nombre, porque son cosas distintas', async () => {
    // La PAGADA sale de renglones cerrados y es la única que es historia; la
    // PRESUPUESTADA vale por su diferencia contra ella, nunca como precio. Una
    // sola cifra llamada «mediana» las volvería intercambiables, y la de arriba
    // se autoconfirma.
    await renderCola([group({})], [catalogChapter(1, 'Acabados')])

    const fila = screen.getByText(/4 RENGLONES/)
    expect(fila.textContent).toMatch(/PAGADO \$1,180 \(2\)/)
    expect(fila.textContent).toMatch(/PRESUPUESTADO \$1,000/)
  })

  it('sin renglones cerrados, el precio pagado es «—» y no un cero inventado', async () => {
    // La historia de precios solo lee renglones cerrados. Un $0 ahí diría que se
    // pagó cero, que es un hecho muy distinto de que todavía no se pague nada.
    await renderCola(
      [group({ medianPaidUnitPrice: null, paidObservations: 0 })],
      [catalogChapter(1, 'Acabados')],
    )

    expect(screen.getByText(/4 RENGLONES/).textContent).toMatch(/PAGADO —/)
  })

  it('enseña en cuántas OBRAS aparece, que es lo que decide si vale promoverla', async () => {
    // Cinco renglones en la misma obra son cinco veces un mismo criterio; tres
    // obras son tres observaciones independientes.
    await renderCola([group({ properties: 3, usedInLines: 4 })], [catalogChapter(1, 'Acabados')])
    expect(screen.getByText(/3 OBRAS · 4 RENGLONES/)).not.toBeNull()
  })

  it('sin destino elegido no se promueve: la máquina ordena, el humano decide', async () => {
    await renderCola([group({ chapters: [], chapterName: '' })], [catalogChapter(1, 'Acabados')])

    const boton = screen.getByText('AGREGAR AL CATÁLOGO ▸') as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.click(boton)
    expect(api.promoteBudgetLine).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Destino de Piso cerámico 60×60'), {
      target: { value: 'cap:1' },
    })
    expect((screen.getByText('AGREGAR AL CATÁLOGO ▸') as HTMLButtonElement).disabled).toBe(false)
  })

  it('la cola vacía dice que se llena sola, no que algo esté mal', async () => {
    await renderCola([], [])
    expect(screen.getByText(/Se llena sola conforme se capturan presupuestos/)).not.toBeNull()
  })

  it('el rechazo del servidor se lee tal como lo escribió', async () => {
    await renderCola([group({})], [catalogChapter(1, 'Acabados')])
    vi.mocked(api.promoteBudgetLine).mockRejectedValue(
      new Error('«Piso cerámico 60×60» ya está en el catálogo, en el capítulo Acabados.'),
    )

    fireEvent.click(screen.getByText('AGREGAR AL CATÁLOGO ▸'))

    expect(await screen.findByText(/ya está en el catálogo, en el capítulo Acabados/)).not.toBeNull()
  })

  it('los grupos se enseñan en el orden que llegaron, sin reordenar aquí', async () => {
    // El orden lo decide el servidor por número de obras. Reordenar en el
    // cliente sería una segunda definición de «cuál conviene fichar primero».
    await renderCola([
      group({ normalized: 'a', name: 'Muy repetida', properties: 9 }),
      group({ normalized: 'b', name: 'Poco repetida', properties: 2 }),
    ], [catalogChapter(1, 'Acabados')])

    const textos = screen.getAllByText(/repetida/).map(el => el.textContent)
    expect(textos[0]).toMatch(/Muy repetida/)
    expect(textos[1]).toMatch(/Poco repetida/)
  })
})
