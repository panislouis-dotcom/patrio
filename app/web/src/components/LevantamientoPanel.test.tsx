import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LevantamientoPanel } from './LevantamientoPanel'
import {
  withVariant, emptyFloorSet, clone,
  type FloorPlanModel, type FloorSet, type VariantKey,
} from '../lib/floorplan/types'

/** Un original con un muro de verdad: clonar algo vacío no probaría nada. */
function originalConMuro(): FloorSet {
  const fs = emptyFloorSet()
  fs.floors[0].name = 'Planta Original'
  fs.floors[0].vertices = {
    v1: { id: 'v1', x: 0, y: 0 },
    v2: { id: 'v2', x: 4, y: 0 },
  }
  fs.floors[0].edges = { e1: { id: 'e1', v1: 'v1', v2: 'v2', thickness: 0.15, openings: [] } }
  return fs
}

function plannedFloorSet(): FloorSet {
  const fs = emptyFloorSet()
  fs.floors[0].name = 'Planta Planeada'
  return fs
}

function renderPanel(variant: VariantKey, geometry: FloorPlanModel | null) {
  const onSave = vi.fn(async (_variant: VariantKey, _fs: FloorSet) => {})
  const onReady = vi.fn()
  render(
    <LevantamientoPanel
      variant={variant}
      geometry={geometry}
      onSave={onSave}
      onUploadImage={async () => ({ imageKey: 'test-key' })}
      onReady={onReady}
      onDirtyChange={() => {}}
    />,
  )
  return { onSave, onReady }
}

describe('LevantamientoPanel · ORIGINAL', () => {
  it('es solo el editor: sin botones de clonación en ninguna dirección', () => {
    const { onReady } = renderPanel('original', withVariant(null, 'original', originalConMuro()))
    expect(screen.getByText('Planta Original')).toBeTruthy()
    expect(screen.queryByText('PARTIR DEL ORIGINAL')).toBeNull()
    expect(screen.queryByText('EMPEZAR EN BLANCO')).toBeNull()
    expect(screen.queryByText('RE-PARTIR DEL ORIGINAL')).toBeNull()
    // El GUARDAR de la página necesita saber de qué variante es el editor vivo.
    expect(onReady).toHaveBeenCalledWith('original', expect.anything())
  })
})

describe('LevantamientoPanel · PLANEADO sin datos', () => {
  it('aterriza en su empty state con las dos acciones', () => {
    renderPanel('planned', withVariant(null, 'original', originalConMuro()))
    expect(screen.getByText('PARTIR DEL ORIGINAL')).toBeTruthy()
    expect(screen.getByText('EMPEZAR EN BLANCO')).toBeTruthy()
    // Sin planeado no hay nada que editar: el editor no se monta.
    expect(document.querySelector('svg')).toBeNull()
  })

  it('sin original que clonar solo ofrece empezar en blanco', () => {
    renderPanel('planned', null)
    expect(screen.queryByText('PARTIR DEL ORIGINAL')).toBeNull()
    expect(screen.getByText('EMPEZAR EN BLANCO')).toBeTruthy()
  })

  it('PARTIR DEL ORIGINAL guarda un clon profundo del original, con sus mismos ids', async () => {
    const original = originalConMuro()
    const { onSave } = renderPanel('planned', withVariant(null, 'original', original))

    fireEvent.click(screen.getByText('PARTIR DEL ORIGINAL'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const [variant, fs] = onSave.mock.calls[0]
    expect(variant).toBe('planned')
    // Mismo contenido, otra identidad: divergen sin arrastrarse mutaciones.
    expect(fs).toEqual(original)
    expect(fs).not.toBe(original)
    expect(fs.floors[0]).not.toBe(original.floors[0])
    // Los ids NO se regeneran: las variantes viven en FloorSets que nunca se mezclan.
    expect(fs.floors[0].edges.e1.id).toBe('e1')
  })

  it('EMPEZAR EN BLANCO guarda un planeado con una planta en blanco', async () => {
    const { onSave } = renderPanel('planned', withVariant(null, 'original', originalConMuro()))

    fireEvent.click(screen.getByText('EMPEZAR EN BLANCO'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const [variant, fs] = onSave.mock.calls[0]
    expect(variant).toBe('planned')
    expect(fs).toEqual(emptyFloorSet())
  })
})

describe('LevantamientoPanel · PLANEADO existente', () => {
  const geometry = () =>
    withVariant(withVariant(null, 'original', originalConMuro()), 'planned', plannedFloorSet())

  it('el empty state desaparece: se monta el editor con SU variante', () => {
    const { onReady } = renderPanel('planned', geometry())
    expect(screen.queryByText('PARTIR DEL ORIGINAL')).toBeNull()
    expect(screen.queryByText('EMPEZAR EN BLANCO')).toBeNull()
    expect(screen.getByText('Planta Planeada')).toBeTruthy()
    expect(screen.queryByText('Planta Original')).toBeNull()
    expect(onReady).toHaveBeenCalledWith('planned', expect.anything())
  })

  it('RE-PARTIR exige la confirmación de dos pasos, y cancelar no clona nada', async () => {
    const { onSave } = renderPanel('planned', geometry())

    // Primer paso: el botón solo arma la confirmación, sin tocar el modelo.
    fireEvent.click(screen.getByText('RE-PARTIR DEL ORIGINAL'))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('¿CONFIRMAR RE-PARTIR?')).toBeTruthy()

    fireEvent.click(screen.getByText('CANCELAR'))
    expect(screen.queryByText('¿CONFIRMAR RE-PARTIR?')).toBeNull()
    expect(screen.getByText('RE-PARTIR DEL ORIGINAL')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()

    // Segundo paso: confirmar sí reemplaza el planeado con un clon del original.
    fireEvent.click(screen.getByText('RE-PARTIR DEL ORIGINAL'))
    fireEvent.click(screen.getByText('¿CONFIRMAR RE-PARTIR?'))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const [variant, fs] = onSave.mock.calls[0]
    expect(variant).toBe('planned')
    expect(fs).toEqual(originalConMuro())
  })

  it('editar y guardar el planeado no toca el original', async () => {
    const geo = geometry()
    const originalAntes = clone(geo.variants.original)
    const { onSave } = renderPanel('planned', geo)

    // "wall" crea un muro en el modelo del editor (el del planeado) y Save lo entrega.
    fireEvent.click(screen.getByText('wall'))
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const [variant, fs] = onSave.mock.calls[0]
    expect(variant).toBe('planned')
    expect(Object.keys(fs.floors[0].edges)).toHaveLength(1)
    // El original ni se guardó ni se mutó por referencia compartida.
    expect(geo.variants.original).toEqual(originalAntes)
    expect(onSave.mock.calls.every(([v]) => v === 'planned')).toBe(true)
  })
})
