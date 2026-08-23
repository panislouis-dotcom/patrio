import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Property } from '../lib/types'
import type { PropertyStatus } from '../lib/status'
import { ProspectusMenu } from './ProspectusMenu'

const STORAGE_KEY = 'prospectoExclusiones'

/**
 * El menú lee cuatro campos de una propiedad —id, nombre, etapa y la ★— y nada
 * más. Escribir los ochenta que trae `Property` aquí no probaría nada extra y
 * haría que cualquier campo nuevo del modelo rompiera estas pruebas por un
 * motivo que no es el que miran.
 */
const prop = (id: number, name: string, status: PropertyStatus, isFavorite = true): Property =>
  ({ id, name, status, isFavorite }) as Property

const INVENTORY: Property[] = [
  prop(1, 'Casa Vendida', 'vendida'),
  prop(2, 'Depa Rentado', 'en_renta'),
  prop(3, 'Obra Contry', 'desarrollo'),
  prop(4, 'Oferta Valle', 'oferta'),
  prop(5, 'Prospecto Centro', 'prospecto'),
  // Sin ★: el menú no la enseña ni la manda.
  prop(6, 'Bodega Sin Estrella', 'oferta', false),
  // Con ★ pero archivada: ninguna sección del prospecto la recibe.
  prop(7, 'Terreno Archivado', 'archivada'),
]

function mount(properties: Property[] = INVENTORY) {
  const onGenerate = vi.fn()
  const view = render(
    <ProspectusMenu properties={properties} generating={false} onGenerate={onGenerate} />,
  )
  return { onGenerate, ...view }
}

function openMenu() {
  fireEvent.click(screen.getByText('📄 PROSPECTO'))
}

const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement

/**
 * El `localStorage` del entorno de pruebas es un objeto vacío, sin `getItem` ni
 * `setItem` (mismo motivo por el que TabBar.test.tsx lo sustituye). Aquí no
 * alcanza con acallarlo: la persistencia ES lo que se prueba, así que va uno de
 * verdad, en memoria, que se vacía entre pruebas.
 */
const memory = new Map<string, string>()
const stored = () => JSON.parse(memory.get(STORAGE_KEY) ?? 'null')

beforeEach(() => {
  memory.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => { memory.set(k, v) },
    removeItem: (k: string) => { memory.delete(k) },
    clear: () => memory.clear(),
  })
  vi.clearAllMocks()
})

describe('ProspectusMenu · qué se ofrece elegir', () => {
  it('enseña únicamente las propiedades marcadas con ★, cada una bajo la sección de su etapa', () => {
    mount()
    openMenu()

    expect(screen.queryByLabelText('Bodega Sin Estrella')).toBeNull()
    // Archivar es sacar del inventario: la ★ no la vuelve a meter al prospecto.
    expect(screen.queryByLabelText('Terreno Archivado')).toBeNull()

    // Vendida y en renta son la misma sección: las dos son track record.
    const track = within(screen.getByTestId('grupo-track'))
    expect(track.getByLabelText('Casa Vendida')).not.toBeNull()
    expect(track.getByLabelText('Depa Rentado')).not.toBeNull()

    expect(within(screen.getByTestId('grupo-desarrollo')).getByLabelText('Obra Contry')).not.toBeNull()

    // Oferta y prospecto son las dos que siguen abiertas a inversión.
    const opps = within(screen.getByTestId('grupo-oportunidades'))
    expect(opps.getByLabelText('Oferta Valle')).not.toBeNull()
    expect(opps.getByLabelText('Prospecto Centro')).not.toBeNull()
  })

  it('arranca con todo marcado: elegir es quitar, no armar la lista desde cero', () => {
    mount()
    openMenu()

    for (const label of ['Portada', 'Resumen de portafolio', 'Cierre', 'Casa Vendida', 'Obra Contry', 'Comisiones del fondo']) {
      expect(box(label).checked).toBe(true)
    }
  })

  it('los cinco bloques de contenido de una oportunidad viven bajo Oportunidades', () => {
    mount()
    openMenu()

    const opps = within(screen.getByTestId('grupo-oportunidades'))
    for (const label of ['Comisiones del fondo', 'Galería de fotos', 'Plano y propuesta', 'Fotos y propuesta', 'Presupuesto de obra']) {
      expect(opps.getByLabelText(label)).not.toBeNull()
    }
  })
})

describe('ProspectusMenu · la casilla de la sección manda sobre sus hijas', () => {
  it('apaga y prende de golpe a todas las propiedades de su sección', () => {
    mount()
    openMenu()

    fireEvent.click(box('Track Record'))
    expect(box('Casa Vendida').checked).toBe(false)
    expect(box('Depa Rentado').checked).toBe(false)
    // Y no toca a las de otra sección.
    expect(box('Obra Contry').checked).toBe(true)

    fireEvent.click(box('Track Record'))
    expect(box('Casa Vendida').checked).toBe(true)
    expect(box('Depa Rentado').checked).toBe(true)
  })

  it('se pinta indeterminada cuando sus hijas están a medias, no marcada como si estuvieran todas', () => {
    mount()
    openMenu()

    expect(box('Track Record').indeterminate).toBe(false)

    fireEvent.click(box('Casa Vendida'))

    expect(box('Track Record').checked).toBe(true)
    expect(box('Track Record').indeterminate).toBe(true)

    fireEvent.click(box('Depa Rentado'))

    // Ninguna hija adentro: la sección está apagada, no a medias.
    expect(box('Track Record').checked).toBe(false)
    expect(box('Track Record').indeterminate).toBe(false)
  })

  it('desde el estado a medias, un clic en la sección la completa', () => {
    mount()
    openMenu()

    fireEvent.click(box('Casa Vendida'))
    fireEvent.click(box('Track Record'))

    expect(box('Casa Vendida').checked).toBe(true)
    expect(box('Depa Rentado').checked).toBe(true)
  })
})

describe('ProspectusMenu · se guarda lo que se apagó, nunca lo que quedó prendido', () => {
  it('lo desmarcado se persiste y sigue desmarcado al volver a montar la pantalla', () => {
    const first = mount()
    openMenu()

    fireEvent.click(box('Obra Contry'))
    fireEvent.click(box('Cierre'))

    expect(stored()).toEqual({ propertyIds: [3], pages: ['closing'] })

    first.unmount()
    mount()
    openMenu()

    expect(box('Obra Contry').checked).toBe(false)
    expect(box('Cierre').checked).toBe(false)
    expect(box('Casa Vendida').checked).toBe(true)
    expect(box('Portada').checked).toBe(true)
  })

  it('una propiedad marcada con ★ DESPUÉS de guardar preferencias entra al prospecto', () => {
    // Ésta es la razón de guardar exclusiones y no inclusiones. Con una lista de
    // incluidas —[1,2,3,4,5]— la propiedad nueva no estaría en ella y se caería
    // del PDF sin que nadie la haya sacado y sin nada en pantalla que lo diga.
    memory.set(STORAGE_KEY, JSON.stringify({ propertyIds: [3], pages: [] }))

    mount([...INVENTORY, prop(9, 'Casa Recién Marcada', 'oferta')])
    openMenu()

    expect(box('Casa Recién Marcada').checked).toBe(true)
    // Y lo que sí se había apagado sigue apagado.
    expect(box('Obra Contry').checked).toBe(false)
  })

  it('quitar la ★ y volver a ponerla borra la exclusión vieja en vez de esconder la propiedad para siempre', () => {
    memory.set(STORAGE_KEY, JSON.stringify({ propertyIds: [3], pages: [] }))

    // Mientras no es favorita, su exclusión no tiene renglón donde enseñarse:
    // al abrir el menú se poda y se persiste podada.
    const sinEstrella = INVENTORY.map(p => (p.id === 3 ? { ...p, isFavorite: false } : p))
    const first = mount(sinEstrella)
    openMenu()

    expect(stored()).toEqual({ propertyIds: [], pages: [] })
    first.unmount()

    // La vuelven a marcar: entra al prospecto, no arrastra la exclusión muerta.
    mount(INVENTORY)
    openMenu()

    expect(box('Obra Contry').checked).toBe(true)
  })

  it('«Restaurar todo» vuelve a prender absolutamente todo y limpia lo guardado', () => {
    mount()
    openMenu()

    fireEvent.click(box('Portada'))
    fireEvent.click(box('Obra Contry'))
    fireEvent.click(box('Galería de fotos'))
    expect(box('Portada').checked).toBe(false)

    fireEvent.click(screen.getByText('RESTAURAR TODO'))

    expect(box('Portada').checked).toBe(true)
    expect(box('Obra Contry').checked).toBe(true)
    expect(box('Galería de fotos').checked).toBe(true)
    expect(stored()).toEqual({ propertyIds: [], pages: [] })
  })

  it('un localStorage con basura no tumba el menú: sale con todo incluido', () => {
    memory.set(STORAGE_KEY, '{no es json')

    mount()
    openMenu()

    expect(box('Portada').checked).toBe(true)
    expect(box('Casa Vendida').checked).toBe(true)
  })
})

describe('ProspectusMenu · generar', () => {
  it('sin propiedades ni páginas sueltas no hay documento que generar y el botón se apaga', () => {
    mount()
    openMenu()

    const generar = screen.getByText('GENERAR PDF') as HTMLButtonElement
    expect(generar.disabled).toBe(false)

    fireEvent.click(box('Portada'))
    fireEvent.click(box('Resumen de portafolio'))
    fireEvent.click(box('Cierre'))
    fireEvent.click(box('Track Record'))
    fireEvent.click(box('En Desarrollo'))
    fireEvent.click(box('Oportunidades'))

    expect((screen.getByText('GENERAR PDF') as HTMLButtonElement).disabled).toBe(true)
  })

  it('el resumen de portafolio solo no alcanza para habilitar: sin propiedades imprime en blanco', () => {
    /* El botón y el 400 del servidor tienen que opinar lo MISMO. El resumen
       resume el track record, así que sin propiedades no imprime nada — si
       contara como página, la pantalla habilitaría un PDF que
       `generate_prospectus` (routes/documents.py) rechaza con un 400. Este
       test es el que amarra las dos reglas: se dejó el resumen prendido y
       todo lo demás apagado, que es exactamente el caso donde divergían. */
    mount()
    openMenu()

    fireEvent.click(box('Portada'))
    fireEvent.click(box('Cierre'))
    fireEvent.click(box('Track Record'))
    fireEvent.click(box('En Desarrollo'))
    fireEvent.click(box('Oportunidades'))

    expect(box('Resumen de portafolio').checked).toBe(true)
    expect((screen.getByText('GENERAR PDF') as HTMLButtonElement).disabled).toBe(true)
  })

  it('con todo marcado se omite `propertyIds`: «todas las favoritas» lo resuelve el servidor', () => {
    const { onGenerate } = mount()
    openMenu()

    fireEvent.click(screen.getByText('GENERAR PDF'))

    expect(onGenerate).toHaveBeenCalledWith({
      cover: true,
      portfolioSummary: true,
      closing: true,
      opportunityFees: true,
      opportunityGallery: true,
      opportunityPlans: true,
      opportunityRenders: true,
      opportunityBudget: true,
    })
  })

  it('lo que viaja al API es exactamente lo que quedó marcado', () => {
    const { onGenerate } = mount()
    openMenu()

    fireEvent.click(box('Depa Rentado'))
    fireEvent.click(box('Portada'))
    fireEvent.click(box('Galería de fotos'))

    fireEvent.click(screen.getByText('GENERAR PDF'))

    expect(onGenerate).toHaveBeenCalledWith({
      propertyIds: [1, 3, 4, 5],
      cover: false,
      portfolioSummary: true,
      closing: true,
      opportunityFees: true,
      opportunityGallery: false,
      opportunityPlans: true,
      opportunityRenders: true,
      opportunityBudget: true,
    })
  })

  it('mientras el PDF se arma, el botón lo dice y no acepta otro clic', () => {
    const onGenerate = vi.fn()
    render(<ProspectusMenu properties={INVENTORY} generating onGenerate={onGenerate} />)

    const boton = screen.getByText('⏳ GENERANDO…') as HTMLButtonElement
    expect(boton.disabled).toBe(true)
  })
})
