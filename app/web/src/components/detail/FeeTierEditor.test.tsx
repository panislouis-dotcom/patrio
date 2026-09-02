import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FeeTierEditor } from './FeeTierEditor'
import * as api from '../../lib/api'
import type { Property } from '../../lib/types'

// Solo se mockean las dos funciones que este componente llama — replaceFeeTiers
// (su escritura) y fetchProperty (el refresh posterior, porque el PUT solo
// devuelve la lista de tramos, no la propiedad con las cifras recalculadas).
// Todo lo demás de api.ts queda real, mismo patrón que BudgetPanel.test.tsx.
vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    replaceFeeTiers: vi.fn(),
    fetchProperty: vi.fn(),
  }
})

const LABEL = 'COMISIÓN VENTA — TRAMOS'
const SAVE = 'GUARDAR CAMBIOS DE VENTA ▸'
const property = (over: Partial<Property> = {}) =>
  ({ id: 7, saleFeeTiers: [], rentFeeTiers: [], ...over } as unknown as Property)

beforeEach(() => {
  vi.mocked(api.replaceFeeTiers).mockReset()
  vi.mocked(api.fetchProperty).mockReset()
})

describe('FeeTierEditor — estado vacío', () => {
  it('sin tramos, enseña SUPUESTO POR OMISIÓN, el botón de agregar y ningún botón de guardar', () => {
    render(<FeeTierEditor property={property()} kind="venta" onPropertyChange={vi.fn()} />)
    expect(screen.getByText('SUPUESTO POR OMISIÓN')).not.toBeNull()
    expect(screen.getByText('+ agregar tramo')).not.toBeNull()
    // Sin escalera todavía no hay nada que limpiar ni nada que guardar.
    expect(screen.queryByLabelText(`Quitar escalera de ${LABEL}`)).toBeNull()
    expect(screen.queryByText(SAVE)).toBeNull()
  })
})

describe('FeeTierEditor — nada se guarda solo', () => {
  it('agregar tramo siembra un renglón y muestra Guardar, sin llamar al API todavía', () => {
    render(<FeeTierEditor property={property()} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('+ agregar tramo'))

    expect(screen.getByLabelText(`Umbral tramo 1 — ${LABEL}`)).not.toBeNull()
    expect(screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`)).not.toBeNull()
    // Agregar un renglón ya es un cambio sin guardar — el botón aparece de
    // inmediato, antes de tocar ningún campo.
    expect(screen.getByText(SAVE)).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })

  it('teclear un campo no guarda nada por sí solo — ni al cambiarlo ni al soltarlo (blur)', () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.06 }]
    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)

    const tasa = screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`)
    fireEvent.change(tasa, { target: { value: '7' } })
    fireEvent.blur(tasa)

    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
    expect(screen.getByText(SAVE)).not.toBeNull()
  })

  it('un renglón a medio llenar no muestra error hasta que se intenta Guardar', () => {
    render(<FeeTierEditor property={property()} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('+ agregar tramo'))

    const umbral = screen.getByLabelText(`Umbral tramo 1 — ${LABEL}`)
    fireEvent.change(umbral, { target: { value: '5000000' } })
    fireEvent.blur(umbral)
    // Falta la tasa: trabajo en progreso, no un error todavía.
    expect(screen.queryByText(/tasa entre 0% y 100%/i)).toBeNull()
    expect(screen.queryByText(/completa el umbral y la tasa/i)).toBeNull()

    fireEvent.click(screen.getByText(SAVE))
    expect(screen.getByText(/completa el umbral y la tasa/i)).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })
})

describe('FeeTierEditor — Guardar cambios', () => {
  it('agregar tramo, llenarlo y hacer clic en Guardar manda el arreglo completo', async () => {
    const onPropertyChange = vi.fn()
    const refreshed = property({ saleFeeTiers: [{ threshold: 5_000_000, rate: 0.06 }] })
    vi.mocked(api.replaceFeeTiers).mockResolvedValue([{ threshold: 5_000_000, rate: 0.06 }])
    vi.mocked(api.fetchProperty).mockResolvedValue(refreshed)

    render(<FeeTierEditor property={property()} kind="venta" onPropertyChange={onPropertyChange} />)
    fireEvent.click(screen.getByText('+ agregar tramo'))
    fireEvent.change(screen.getByLabelText(`Umbral tramo 1 — ${LABEL}`), { target: { value: '5000000' } })
    fireEvent.change(screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`), { target: { value: '6' } })

    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(SAVE))

    await waitFor(() => expect(api.replaceFeeTiers).toHaveBeenCalledWith(
      7, 'venta', [{ threshold: 5_000_000, rate: 0.06 }],
    ))
    // El PUT solo trae la lista de tramos — hace falta el refetch para las
    // cifras en pesos que dependen de la escalera.
    await waitFor(() => expect(api.fetchProperty).toHaveBeenCalledWith(7))
    await waitFor(() => expect(onPropertyChange).toHaveBeenCalledWith(refreshed))
    // Guardado: ya no hay nada pendiente, el botón desaparece.
    await waitFor(() => expect(screen.queryByText(SAVE)).toBeNull())
  })

  it('borrar un renglón es un cambio pendiente — se manda hasta hacer clic en Guardar', async () => {
    const onPropertyChange = vi.fn()
    const existing: Property['saleFeeTiers'] = [
      { threshold: 5_000_000, rate: 0.06 },
      { threshold: 6_500_000, rate: 0.07 },
    ]
    const refreshed = property({ saleFeeTiers: [{ threshold: 6_500_000, rate: 0.07 }] })
    vi.mocked(api.replaceFeeTiers).mockResolvedValue([{ threshold: 6_500_000, rate: 0.07 }])
    vi.mocked(api.fetchProperty).mockResolvedValue(refreshed)

    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={onPropertyChange} />)
    fireEvent.click(screen.getByLabelText(`Quitar tramo 1 — ${LABEL}`))

    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(SAVE))

    await waitFor(() => expect(api.replaceFeeTiers).toHaveBeenCalledWith(
      7, 'venta', [{ threshold: 6_500_000, rate: 0.07 }],
    ))
    await waitFor(() => expect(onPropertyChange).toHaveBeenCalledWith(refreshed))
  })

  it('quitar toda la escalera (✕) vuelve al default en pantalla, pero solo se persiste al hacer clic en Guardar', async () => {
    const onPropertyChange = vi.fn()
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.05 }]
    const refreshed = property({ saleFeeTiers: [] })
    vi.mocked(api.replaceFeeTiers).mockResolvedValue([])
    vi.mocked(api.fetchProperty).mockResolvedValue(refreshed)

    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={onPropertyChange} />)
    fireEvent.click(screen.getByLabelText(`Quitar escalera de ${LABEL}`))

    // El borrador ya se ve vacío...
    expect(screen.getByText('SUPUESTO POR OMISIÓN')).not.toBeNull()
    // ...pero el servidor todavía no se tocó — Guardar sigue pendiente.
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
    expect(screen.getByText(SAVE)).not.toBeNull()

    fireEvent.click(screen.getByText(SAVE))
    await waitFor(() => expect(api.replaceFeeTiers).toHaveBeenCalledWith(7, 'venta', []))
    await waitFor(() => expect(onPropertyChange).toHaveBeenCalledWith(refreshed))
  })
})

describe('FeeTierEditor — validación local', () => {
  it('un umbral repetido se rechaza al hacer clic en Guardar, sin llamar al API', () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.06 }]
    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('+ agregar tramo'))

    fireEvent.change(screen.getByLabelText(`Umbral tramo 2 — ${LABEL}`), { target: { value: '5000000' } })
    fireEvent.change(screen.getByLabelText(`Tasa tramo 2 — ${LABEL}`), { target: { value: '4' } })
    expect(screen.queryByText(/umbrales deben ser únicos/i)).toBeNull()

    fireEvent.click(screen.getByText(SAVE))
    expect(screen.getByText(/umbrales deben ser únicos/i)).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })

  it('una tasa fuera de [0,1] se rechaza al hacer clic en Guardar, sin llamar al API', () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.05 }]
    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`), { target: { value: '150' } })
    fireEvent.click(screen.getByText(SAVE))

    expect(screen.getByText(/tasa entre 0% y 100%/i)).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })
})

describe('FeeTierEditor — rechazo del servidor', () => {
  it('si el servidor rechaza el PUT, su mensaje se muestra y no se llama fetchProperty', async () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.05 }]
    vi.mocked(api.replaceFeeTiers).mockRejectedValue(new Error('No se pudo guardar la escalera.'))

    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`), { target: { value: '7' } })
    fireEvent.click(screen.getByText(SAVE))

    await waitFor(() => expect(screen.getByText('No se pudo guardar la escalera.')).not.toBeNull())
    expect(api.fetchProperty).not.toHaveBeenCalled()
    // El PUT falló: el cambio sigue pendiente, Guardar no desaparece.
    expect(screen.getByText(SAVE)).not.toBeNull()
  })
})
