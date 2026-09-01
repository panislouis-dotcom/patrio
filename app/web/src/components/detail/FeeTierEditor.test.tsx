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
const property = (over: Partial<Property> = {}) =>
  ({ id: 7, saleFeeTiers: [], rentFeeTiers: [], ...over } as unknown as Property)

beforeEach(() => {
  vi.mocked(api.replaceFeeTiers).mockReset()
  vi.mocked(api.fetchProperty).mockReset()
})

describe('FeeTierEditor — estado vacío', () => {
  it('sin tramos, enseña SUPUESTO POR OMISIÓN y el botón de agregar', () => {
    render(<FeeTierEditor property={property()} kind="venta" onPropertyChange={vi.fn()} />)
    expect(screen.getByText('SUPUESTO POR OMISIÓN')).not.toBeNull()
    expect(screen.getByText('+ agregar tramo')).not.toBeNull()
    // Sin escalera todavía no hay nada que limpiar.
    expect(screen.queryByLabelText(`Quitar escalera de ${LABEL}`)).toBeNull()
  })
})

describe('FeeTierEditor — agregar y comitir', () => {
  it('agregar tramo siembra un solo renglón, sin llamar al API todavía', () => {
    render(<FeeTierEditor property={property()} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('+ agregar tramo'))

    expect(screen.getByLabelText(`Umbral tramo 1 — ${LABEL}`)).not.toBeNull()
    expect(screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`)).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })

  it('al completar umbral y tasa, el blur de la tasa comita el arreglo completo', async () => {
    const onPropertyChange = vi.fn()
    const refreshed = property({ saleFeeTiers: [{ threshold: 5_000_000, rate: 0.06 }] })
    vi.mocked(api.replaceFeeTiers).mockResolvedValue([{ threshold: 5_000_000, rate: 0.06 }])
    vi.mocked(api.fetchProperty).mockResolvedValue(refreshed)

    render(<FeeTierEditor property={property()} kind="venta" onPropertyChange={onPropertyChange} />)
    fireEvent.click(screen.getByText('+ agregar tramo'))

    const umbral = screen.getByLabelText(`Umbral tramo 1 — ${LABEL}`)
    fireEvent.change(umbral, { target: { value: '5000000' } })
    fireEvent.blur(umbral)
    // Falta la tasa del tramo: es trabajo en progreso, no un error todavía —
    // ni escritura ni mensaje rojo mientras el usuario sigue llenando el
    // renglón (antes de este corte, tabular de DESDE $ a TASA % mostraba
    // "cada tramo necesita una tasa..." antes de que hubiera oportunidad de
    // escribirla).
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
    expect(screen.queryByText(/tasa entre 0% y 100%/i)).toBeNull()

    const tasa = screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`)
    fireEvent.change(tasa, { target: { value: '6' } })
    fireEvent.blur(tasa)

    await waitFor(() => expect(api.replaceFeeTiers).toHaveBeenCalledWith(
      7, 'venta', [{ threshold: 5_000_000, rate: 0.06 }],
    ))
    // El PUT solo trae la lista de tramos — hace falta el refetch para las
    // cifras en pesos que dependen de la escalera.
    await waitFor(() => expect(api.fetchProperty).toHaveBeenCalledWith(7))
    await waitFor(() => expect(onPropertyChange).toHaveBeenCalledWith(refreshed))
  })
})

describe('FeeTierEditor — borrar', () => {
  it('borrar un renglón comita de inmediato, sin esperar un blur', async () => {
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

    await waitFor(() => expect(api.replaceFeeTiers).toHaveBeenCalledWith(
      7, 'venta', [{ threshold: 6_500_000, rate: 0.07 }],
    ))
    await waitFor(() => expect(onPropertyChange).toHaveBeenCalledWith(refreshed))
  })

  it('quitar toda la escalera (✕) manda un arreglo vacío — vuelve al default', async () => {
    const onPropertyChange = vi.fn()
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.05 }]
    const refreshed = property({ saleFeeTiers: [] })
    vi.mocked(api.replaceFeeTiers).mockResolvedValue([])
    vi.mocked(api.fetchProperty).mockResolvedValue(refreshed)

    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={onPropertyChange} />)
    fireEvent.click(screen.getByLabelText(`Quitar escalera de ${LABEL}`))

    await waitFor(() => expect(api.replaceFeeTiers).toHaveBeenCalledWith(7, 'venta', []))
    await waitFor(() => expect(onPropertyChange).toHaveBeenCalledWith(refreshed))
    expect(screen.getByText('SUPUESTO POR OMISIÓN')).not.toBeNull()
  })
})

describe('FeeTierEditor — validación local', () => {
  it('un umbral repetido se rechaza sin llamar al API', () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.06 }]
    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('+ agregar tramo'))

    const umbral2 = screen.getByLabelText(`Umbral tramo 2 — ${LABEL}`)
    fireEvent.change(umbral2, { target: { value: '5000000' } })
    fireEvent.blur(umbral2)

    const tasa2 = screen.getByLabelText(`Tasa tramo 2 — ${LABEL}`)
    fireEvent.change(tasa2, { target: { value: '4' } })
    fireEvent.blur(tasa2)

    expect(screen.getByText(/umbrales deben ser únicos/i)).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })

  it('una tasa fuera de [0,1] se rechaza sin llamar al API', () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.05 }]
    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)

    const tasa = screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`)
    fireEvent.change(tasa, { target: { value: '150' } })
    fireEvent.blur(tasa)

    expect(screen.getByText(/tasa entre 0% y 100%/i)).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })
})

describe('FeeTierEditor — rechazo del servidor', () => {
  it('si el servidor rechaza el PUT, su mensaje se muestra y no se llama fetchProperty', async () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.05 }]
    vi.mocked(api.replaceFeeTiers).mockRejectedValue(new Error('No se pudo guardar la escalera.'))

    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)
    const tasa = screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`)
    fireEvent.change(tasa, { target: { value: '7' } })
    fireEvent.blur(tasa)

    await waitFor(() => expect(screen.getByText('No se pudo guardar la escalera.')).not.toBeNull())
    expect(api.fetchProperty).not.toHaveBeenCalled()
  })
})
