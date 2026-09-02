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

describe('FeeTierEditor — vista (sin tramos guardados)', () => {
  it('sin tramos, enseña SUPUESTO POR OMISIÓN y el botón de agregar — nada de Guardar ni cajas', () => {
    render(<FeeTierEditor property={property()} kind="venta" onPropertyChange={vi.fn()} />)
    expect(screen.getByText('SUPUESTO POR OMISIÓN')).not.toBeNull()
    expect(screen.getByText('+ agregar tramo')).not.toBeNull()
    expect(screen.queryByText(SAVE)).toBeNull()
    expect(screen.queryByLabelText(`Umbral tramo 1 — ${LABEL}`)).toBeNull()
  })
})

describe('FeeTierEditor — vista (con tramos guardados)', () => {
  it('enseña los tramos como texto fijo, sin ✕ de ningún tipo, con un botón «editar tramos»', () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.06 }]
    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)

    expect(screen.getByText('5,000,000')).not.toBeNull()
    expect(screen.getByText('6')).not.toBeNull()
    expect(screen.getByText('editar tramos')).not.toBeNull()
    // Nada de ✕ visible en vista: ni la de "quitar todo" (ya no existe) ni
    // la de un renglón individual (solo aparece en edición).
    expect(screen.queryByText('✕')).toBeNull()
    expect(screen.queryByLabelText(`Quitar escalera de ${LABEL}`)).toBeNull()
    expect(screen.queryByLabelText(`Quitar tramo 1 — ${LABEL}`)).toBeNull()
    // Tampoco hay cajas de captura ni botón de Guardar hasta entrar a editar.
    expect(screen.queryByLabelText(`Umbral tramo 1 — ${LABEL}`)).toBeNull()
    expect(screen.queryByText(SAVE)).toBeNull()
  })
})

describe('FeeTierEditor — entrar y salir de edición', () => {
  it('«editar tramos» abre las cajas, la ✕ por renglón y Guardar/cancelar', () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.06 }]
    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('editar tramos'))

    expect(screen.getByLabelText(`Umbral tramo 1 — ${LABEL}`)).not.toBeNull()
    expect(screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`)).not.toBeNull()
    expect(screen.getByLabelText(`Quitar tramo 1 — ${LABEL}`)).not.toBeNull()
    expect(screen.getByText(SAVE)).not.toBeNull()
    expect(screen.getByText('cancelar')).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })

  it('«+ agregar tramo» desde vacío entra a edición sembrando un renglón', () => {
    render(<FeeTierEditor property={property()} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('+ agregar tramo'))

    expect(screen.getByLabelText(`Umbral tramo 1 — ${LABEL}`)).not.toBeNull()
    expect(screen.getByText(SAVE)).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })

  it('cancelar descarta el borrador y regresa a vista con los valores guardados', () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.06 }]
    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('editar tramos'))
    fireEvent.change(screen.getByLabelText(`Umbral tramo 1 — ${LABEL}`), { target: { value: '9000000' } })

    fireEvent.click(screen.getByText('cancelar'))

    expect(screen.queryByLabelText(`Umbral tramo 1 — ${LABEL}`)).toBeNull()
    expect(screen.getByText('5,000,000')).not.toBeNull()
    expect(screen.getByText('editar tramos')).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })

  it('un renglón a medio llenar no muestra error hasta que se intenta Guardar', () => {
    render(<FeeTierEditor property={property()} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('+ agregar tramo'))

    fireEvent.change(screen.getByLabelText(`Umbral tramo 1 — ${LABEL}`), { target: { value: '5000000' } })
    expect(screen.queryByText(/completa el umbral y la tasa/i)).toBeNull()

    fireEvent.click(screen.getByText(SAVE))
    expect(screen.getByText(/completa el umbral y la tasa/i)).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })
})

describe('FeeTierEditor — Guardar cambios', () => {
  it('agregar tramo, llenarlo y hacer clic en Guardar manda el arreglo completo y regresa a vista', async () => {
    const onPropertyChange = vi.fn()
    const refreshed = property({ saleFeeTiers: [{ threshold: 5_000_000, rate: 0.06 }] })
    vi.mocked(api.replaceFeeTiers).mockResolvedValue([{ threshold: 5_000_000, rate: 0.06 }])
    vi.mocked(api.fetchProperty).mockResolvedValue(refreshed)

    render(<FeeTierEditor property={property()} kind="venta" onPropertyChange={onPropertyChange} />)
    fireEvent.click(screen.getByText('+ agregar tramo'))
    fireEvent.change(screen.getByLabelText(`Umbral tramo 1 — ${LABEL}`), { target: { value: '5000000' } })
    fireEvent.change(screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`), { target: { value: '6' } })
    fireEvent.click(screen.getByText(SAVE))

    await waitFor(() => expect(api.replaceFeeTiers).toHaveBeenCalledWith(
      7, 'venta', [{ threshold: 5_000_000, rate: 0.06 }],
    ))
    await waitFor(() => expect(api.fetchProperty).toHaveBeenCalledWith(7))
    await waitFor(() => expect(onPropertyChange).toHaveBeenCalledWith(refreshed))
    // De vuelta a vista: ya no hay cajas ni botón de Guardar.
    await waitFor(() => expect(screen.queryByLabelText(`Umbral tramo 1 — ${LABEL}`)).toBeNull())
    expect(screen.queryByText(SAVE)).toBeNull()
  })

  it('borrar todos los renglones y guardar vacía la escalera — reemplaza la vieja ✕ de "quitar todo"', async () => {
    const onPropertyChange = vi.fn()
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.05 }]
    const refreshed = property({ saleFeeTiers: [] })
    vi.mocked(api.replaceFeeTiers).mockResolvedValue([])
    vi.mocked(api.fetchProperty).mockResolvedValue(refreshed)

    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={onPropertyChange} />)
    fireEvent.click(screen.getByText('editar tramos'))
    fireEvent.click(screen.getByLabelText(`Quitar tramo 1 — ${LABEL}`))
    expect(screen.getByText(/sin tramos/i)).not.toBeNull()

    fireEvent.click(screen.getByText(SAVE))
    await waitFor(() => expect(api.replaceFeeTiers).toHaveBeenCalledWith(7, 'venta', []))
    await waitFor(() => expect(onPropertyChange).toHaveBeenCalledWith(refreshed))
  })
})

describe('FeeTierEditor — validación local', () => {
  it('un umbral repetido se rechaza al hacer clic en Guardar, sin llamar al API', () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.06 }]
    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('editar tramos'))
    fireEvent.click(screen.getByText('+ agregar tramo'))

    fireEvent.change(screen.getByLabelText(`Umbral tramo 2 — ${LABEL}`), { target: { value: '5000000' } })
    fireEvent.change(screen.getByLabelText(`Tasa tramo 2 — ${LABEL}`), { target: { value: '4' } })

    fireEvent.click(screen.getByText(SAVE))
    expect(screen.getByText(/umbrales deben ser únicos/i)).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })

  it('una tasa fuera de [0,1] se rechaza al hacer clic en Guardar, sin llamar al API', () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.05 }]
    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('editar tramos'))

    fireEvent.change(screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`), { target: { value: '150' } })
    fireEvent.click(screen.getByText(SAVE))

    expect(screen.getByText(/tasa entre 0% y 100%/i)).not.toBeNull()
    expect(api.replaceFeeTiers).not.toHaveBeenCalled()
  })
})

describe('FeeTierEditor — rechazo del servidor', () => {
  it('si el servidor rechaza el PUT, su mensaje se muestra, no se llama fetchProperty y se sigue en edición', async () => {
    const existing: Property['saleFeeTiers'] = [{ threshold: 5_000_000, rate: 0.05 }]
    vi.mocked(api.replaceFeeTiers).mockRejectedValue(new Error('No se pudo guardar la escalera.'))

    render(<FeeTierEditor property={property({ saleFeeTiers: existing })} kind="venta" onPropertyChange={vi.fn()} />)
    fireEvent.click(screen.getByText('editar tramos'))
    fireEvent.change(screen.getByLabelText(`Tasa tramo 1 — ${LABEL}`), { target: { value: '7' } })
    fireEvent.click(screen.getByText(SAVE))

    await waitFor(() => expect(screen.getByText('No se pudo guardar la escalera.')).not.toBeNull())
    expect(api.fetchProperty).not.toHaveBeenCalled()
    // El PUT falló: se queda en edición, con Guardar todavía disponible.
    expect(screen.getByText(SAVE)).not.toBeNull()
  })
})
