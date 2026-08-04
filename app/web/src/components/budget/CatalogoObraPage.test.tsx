import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { BudgetCatalogChapter, BudgetCatalogItem } from '../../lib/types'
import { CatalogoObraPage } from './CatalogoObraPage'
import * as api from '../../lib/api'

vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    fetchBudgetCatalog: vi.fn(),
    createCatalogChapter: vi.fn(),
    updateCatalogChapter: vi.fn(),
    deactivateCatalogChapter: vi.fn(),
    createCatalogItem: vi.fn(),
    updateCatalogItem: vi.fn(),
    deactivateCatalogItem: vi.fn(),
  }
})

const item = (over: Partial<BudgetCatalogItem>): BudgetCatalogItem => ({
  id: 1, chapterId: 1, name: 'Piso cerámico 60×60', unit: 'm²',
  sortOrder: 0, isActive: true, usedInLines: 0, ...over,
})

const chapter = (over: Partial<BudgetCatalogChapter>): BudgetCatalogChapter => ({
  id: 1, name: 'Acabados', sortOrder: 0, isActive: true, items: [], ...over,
})

const CATALOGO: BudgetCatalogChapter[] = [
  chapter({
    id: 1, name: 'Acabados',
    items: [
      item({ id: 11, name: 'Piso cerámico 60×60', unit: 'm²', usedInLines: 4 }),
      item({ id: 12, name: 'Pintura vinílica', unit: 'm²', isActive: false }),
    ],
  }),
  chapter({ id: 2, name: 'Cimentación vieja', isActive: false, items: [] }),
]

async function renderCatalogo(catalogo = CATALOGO) {
  vi.mocked(api.fetchBudgetCatalog).mockResolvedValue(catalogo)
  render(<CatalogoObraPage />)
  await screen.findByText('CATÁLOGO DE OBRA')
}

describe('CatalogoObraPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('la baja es la ÚNICA baja: apagar, nunca borrar', async () => {
    // Borrar una partida es la única operación capaz de cortar la trazabilidad
    // de un presupuesto ya cerrado —el que un inversionista ya vio— así que no
    // existe: el `DELETE` del servidor ES esta baja lógica y contesta la fila
    // apagada, y la pantalla la llama por lo que hace.
    await renderCatalogo()
    vi.mocked(api.deactivateCatalogItem).mockResolvedValue(item({ id: 11, isActive: false }))

    expect(screen.queryByText('BORRAR')).toBeNull()
    expect(screen.queryByText('ELIMINAR')).toBeNull()

    const fila = screen.getByLabelText('Partida Piso cerámico 60×60').closest('div')!
    fireEvent.click(within(fila).getByText('DESACTIVAR'))

    await waitFor(() => expect(api.deactivateCatalogItem).toHaveBeenCalledWith(11))
    // Y la pantalla se relee: la verdad del catálogo es del servidor
    await waitFor(() => expect(api.fetchBudgetCatalog).toHaveBeenCalledTimes(2))
  })

  it('antes de dar de baja dice cuántos renglones la usan y que no se tocan', async () => {
    // Ese número es exactamente la procedencia que un borrado destruiría.
    // Enseñarlo convierte «confía en que no borramos» en algo que se puede leer.
    await renderCatalogo()
    vi.mocked(api.deactivateCatalogItem).mockResolvedValue(item({ id: 11, isActive: false }))

    expect(screen.getByText('EN 4 RENGLONES')).not.toBeNull()

    const fila = screen.getByLabelText('Partida Piso cerámico 60×60').closest('div')!
    fireEvent.click(within(fila).getByText('DESACTIVAR'))

    const aviso = vi.mocked(window.confirm).mock.calls[0][0]
    expect(aviso).toMatch(/los 4 renglones que ya la usan la conservan/i)
    expect(aviso).toMatch(/Nada de lo capturado se toca/i)
  })

  it('lo dado de baja se puede ver y reactivar, no queda enterrado', async () => {
    // Una baja que no se puede deshacer sin entrar a la base es una baja que
    // nadie se atreve a usar, y entonces se «borra» renombrando encima — que sí
    // destruye historia.
    await renderCatalogo()

    // Por omisión no estorban
    expect(screen.queryByLabelText('Partida Pintura vinílica')).toBeNull()
    expect(screen.queryByLabelText('Capítulo Cimentación vieja')).toBeNull()

    fireEvent.click(screen.getByLabelText('VER LAS DADAS DE BAJA'))

    expect(screen.getByLabelText('Partida Pintura vinílica')).not.toBeNull()
    const fila = screen.getByLabelText('Partida Pintura vinílica').closest('div')!
    expect(within(fila).getByText('REACTIVAR')).not.toBeNull()

    vi.mocked(api.updateCatalogItem).mockResolvedValue(item({ id: 12, isActive: true }))
    fireEvent.click(within(fila).getByText('REACTIVAR'))
    // Revivir es un PATCH, no una resurrección: la fila nunca se fue
    await waitFor(() => expect(api.updateCatalogItem).toHaveBeenCalledWith(12, { isActive: true }))
    // Reactivar no pregunta nada: no hay nada que perder
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('una partida se agrega con nombre y unidad, y nunca con precio', async () => {
    // El catálogo NO guarda precio a propósito: sugerir desde un precio guardado
    // es repetir para siempre una suposición que nadie volvió a mirar.
    await renderCatalogo()
    vi.mocked(api.createCatalogItem).mockResolvedValue(item({ id: 13 }))

    fireEvent.click(screen.getByText('+ PARTIDA'))
    fireEvent.change(screen.getByLabelText('Nombre de la partida nueva'), { target: { value: 'Firme de concreto' } })
    fireEvent.change(screen.getByLabelText('Unidad de la partida nueva'), { target: { value: 'm²' } })
    fireEvent.click(screen.getByText('AGREGAR'))

    await waitFor(() => expect(api.createCatalogItem).toHaveBeenCalledWith({
      chapterId: 1, name: 'Firme de concreto', unit: 'm²',
    }))
    // Ni una caja donde escribir un precio en toda la pantalla
    expect(screen.queryByLabelText(/precio/i)).toBeNull()
  })

  it('renombrar en su lugar, y una caja vacía no manda nada', async () => {
    await renderCatalogo()

    const caja = screen.getByLabelText('Partida Piso cerámico 60×60')
    fireEvent.change(caja, { target: { value: '   ' } })
    fireEvent.blur(caja)
    expect(api.updateCatalogItem).not.toHaveBeenCalled()

    // Y soltar sin haber cambiado nada tampoco escribe
    fireEvent.blur(screen.getByLabelText('Capítulo Acabados'))
    expect(api.updateCatalogChapter).not.toHaveBeenCalled()
  })

  it('el catálogo vacío dice cómo se llena, en vez de quedarse en blanco', async () => {
    // Arranca vacío por diseño: no hay presupuestos viejos que importar.
    await renderCatalogo([])
    expect(screen.getByText(/la cola de promoción irá proponiendo los que se repiten/)).not.toBeNull()
  })
})
