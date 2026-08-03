import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ParsedProperty } from '../lib/types'
import { SmartPropertyModal } from './SmartPropertyModal'
import * as api from '../lib/api'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: () => null,
  useMapEvents: () => null,
}))

vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, parseProperty: vi.fn(), createProperty: vi.fn(), uploadPropertyImage: vi.fn() }
})

/** Un anuncio de casa TERMINADA: 4,000,000 por 320 m² de terreno y 250 ya construidos. */
const LISTING: ParsedProperty = {
  name: 'Casa Centro Terminada', address: 'Calle Uno 1, Centro', city: 'Monterrey',
  type: 'casa', price: 4_000_000, sqmLand: 320, sqmConstruction: 250,
  notes: 'Dos niveles, 1975.', url: 'https://example.com/anuncio', status: '',
  latitude: 25.67, longitude: -100.31,
  municipioCve: '19039', municipioName: 'Monterrey', colonia: 'Centro', stateName: 'Nuevo León',
}

async function analyze() {
  vi.mocked(api.parseProperty).mockResolvedValue(LISTING)
  vi.mocked(api.createProperty).mockResolvedValue({ id: 42 } as never)
  render(<SmartPropertyModal onClose={() => {}} onCreated={() => {}} />)
  fireEvent.change(screen.getByPlaceholderText(/lamudi/), { target: { value: 'https://example.com/anuncio' } })
  fireEvent.click(screen.getByText('ANALIZAR ▸'))
  // GUARDAR solo existe en el paso de revisión: esperarlo es esperar al parseo.
  await waitFor(() => expect(screen.getByText('GUARDAR ▸')).not.toBeNull())
}

const field = (label: string) =>
  screen.getByText(label).closest('div')!.parentElement!.querySelector('input') as HTMLInputElement

describe('SmartPropertyModal', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('el precio del anuncio es el precio de COMPRA, no el del terreno', async () => {
    await analyze()
    expect(field('Precio de compra (MXN)').value).toBe('4000000')
  })

  it('los metros ya construidos no se copian a la obra a ejecutar', async () => {
    await analyze()
    // Éste era el doble conteo: 250 m² ya pagados dentro del precio, listos para
    // multiplicarse por un costo de obra y sumarse otra vez.
    expect(field('Obra a ejecutar (m²)').value).toBe('')
    expect(field('Obra a ejecutar (m²)').placeholder).toContain('250')
  })

  it('guarda el precio como purchasePrice, sin obra y sin plazo inventado', async () => {
    await analyze()
    fireEvent.click(screen.getByText('GUARDAR ▸'))

    await waitFor(() => expect(api.createProperty).toHaveBeenCalled())
    const body = vi.mocked(api.createProperty).mock.calls[0][0]
    expect(body.purchasePrice).toBe(4_000_000)
    expect(body.sqmConstruction).toBe(0)
    // Sin plazo capturado el modelo aplica el suyo y la ficha lo declara supuesto.
    expect(body.holdMonths).toBeUndefined()
    // Lo construido no se pierde: queda dicho donde no puede volverse presupuesto.
    expect(body.notes).toContain('Construido según el anuncio: 250 m²')
  })
})
