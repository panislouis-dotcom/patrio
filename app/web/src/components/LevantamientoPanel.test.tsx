import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LevantamientoPanel } from './LevantamientoPanel'
import {
  withVariant, emptyFloorSet, clone,
  type FloorPlanModel, type FloorSet, type VariantKey,
} from '../lib/floorplan/types'
import type { PropertyRender } from '../lib/types'

// `floorToPngBlob` rasteriza vía <canvas>, que jsdom no implementa (no hay paquete
// `canvas` en este repo — ver planImage.test.ts, que por eso solo prueba la mitad
// PURA). Se mockea aquí para poder probar QUE se llama y CON qué variante, sin
// pelear con un canvas que no existe en este entorno.
vi.mock('../lib/floorplan/planImage', () => ({
  floorToPngBlob: vi.fn(async () => new Blob(['plano'], { type: 'image/png' })),
}))

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

/** Render nacido del plano de UNA variante — `sourceVariant` es lo único que
 * `RendersPanel` usa para separar «lo mío» de «lo del otro levantamiento». */
function planRenderRow(id: number, variant: VariantKey): PropertyRender {
  return {
    id, propertyId: 7, sourceImageId: null, sourcePlanPath: `plan/${id}.png`, sourceVariant: variant,
    parentRenderId: null, filePath: `r/${id}.png`, contentType: 'image/png', promptId: null,
    promptText: 'Estilo minimalista.', provider: 'openai', model: 'gpt-image-2',
    createdAt: '2026-08-01T00:00:00Z',
  }
}

function renderPanel(
  variant: VariantKey,
  geometry: FloorPlanModel | null,
  // Un onSave que nunca resuelve deja el estado "en vuelo" a la vista del test.
  onSave = vi.fn(async (_variant: VariantKey, _fs: FloorSet) => {}),
  over: {
    renders?: PropertyRender[]
    onGenerateRender?: (variant: VariantKey, req: { promptId: number | null; promptText: string; plan: Blob })
      => Promise<PropertyRender>
  } = {},
) {
  const onReady = vi.fn()
  const onGenerateRender = over.onGenerateRender
    ? vi.fn(over.onGenerateRender)
    : vi.fn().mockResolvedValue(planRenderRow(99, variant))
  render(
    <LevantamientoPanel
      variant={variant}
      geometry={geometry}
      onSave={onSave}
      onUploadImage={async () => ({ imageKey: 'test-key' })}
      onReady={onReady}
      onDirtyChange={() => {}}
      base=""
      prompts={[]}
      renders={over.renders ?? []}
      onGenerateRender={onGenerateRender}
      onSavePrompt={vi.fn().mockResolvedValue({ id: 1, name: 'x', body: 'y', kind: 'plan', isDefault: false, createdAt: '2026-08-01T00:00:00Z' })}
      onDeleteRender={vi.fn().mockResolvedValue(undefined)}
    />,
  )
  return { onSave, onReady, onGenerateRender }
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

  it('cada acción marca su propio estado en vuelo: el ocupado no se cuelga del botón vecino', () => {
    // Con un booleano compartido, EMPEZAR EN BLANCO ponía "CLONANDO…" en el
    // botón de PARTIR DEL ORIGINAL — el estado explícito dice CUÁL acción corre.
    const colgado = vi.fn((_v: VariantKey, _fs: FloorSet) => new Promise<void>(() => {}))
    renderPanel('planned', withVariant(null, 'original', originalConMuro()), colgado)

    fireEvent.click(screen.getByText('EMPEZAR EN BLANCO'))

    expect(screen.getByText('CREANDO…')).toBeTruthy()
    const partir = screen.getByText('PARTIR DEL ORIGINAL') as HTMLButtonElement
    expect(partir.textContent).toBe('PARTIR DEL ORIGINAL')
    // Vecino sin su etiqueta de ocupado, pero igual desactivado: solo UNA escritura a la vez.
    expect(partir.disabled).toBe(true)
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

  it('CANCELAR se desactiva mientras el re-partir está en vuelo: ya no hay nada que cancelar', () => {
    // La escritura no se puede detener una vez despachada; un CANCELAR clicable
    // escondería la confirmación mientras el planeado igual se reemplaza.
    const colgado = vi.fn((_v: VariantKey, _fs: FloorSet) => new Promise<void>(() => {}))
    renderPanel('planned', geometry(), colgado)

    fireEvent.click(screen.getByText('RE-PARTIR DEL ORIGINAL'))
    fireEvent.click(screen.getByText('¿CONFIRMAR RE-PARTIR?'))

    expect(screen.getByText('CLONANDO…')).toBeTruthy()
    expect((screen.getByText('CANCELAR') as HTMLButtonElement).disabled).toBe(true)
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

describe('LevantamientoPanel · sub-navegación PLANO | RENDERS', () => {
  const geometryConPlaneado = () =>
    withVariant(withVariant(null, 'original', originalConMuro()), 'planned', plannedFloorSet())

  it('PLANO sigue mostrando el editor sin cambios', () => {
    renderPanel('original', withVariant(null, 'original', originalConMuro()))
    // El sub-nav es nuevo, pero PLANO es la pestaña activa por default: el
    // editor de siempre, con sus mismas herramientas.
    expect(screen.getByText('PLANO')).toBeTruthy()
    expect(screen.getByText('RENDERS')).toBeTruthy()
    expect(screen.getByText('Planta Original')).toBeTruthy()
    expect(screen.getByText('wall')).toBeTruthy()
  })

  it('el empty-state PLANEADO no ofrece RENDERS — no hay plano del que generar', () => {
    renderPanel('planned', withVariant(null, 'original', originalConMuro()))
    expect(screen.getByText('PARTIR DEL ORIGINAL')).toBeTruthy()
    expect(screen.queryByText('RENDERS')).toBeNull()
    expect(screen.queryByText('PLANO')).toBeNull()
  })

  it('ORIGINAL: la pestaña RENDERS lista solo los renders de SU variante', () => {
    const renders = [planRenderRow(1, 'original'), planRenderRow(2, 'planned')]
    renderPanel('original', withVariant(null, 'original', originalConMuro()), undefined, { renders })

    fireEvent.click(screen.getByText('RENDERS'))
    expect(screen.getByAltText('Render 1')).toBeTruthy()
    expect(screen.queryByAltText('Render 2')).toBeNull()
  })

  it('PLANEADO: la pestaña RENDERS lista solo los renders de SU variante, no los del original', () => {
    const renders = [planRenderRow(1, 'original'), planRenderRow(2, 'planned')]
    renderPanel('planned', geometryConPlaneado(), undefined, { renders })

    fireEvent.click(screen.getByText('RENDERS'))
    expect(screen.getByAltText('Render 2')).toBeTruthy()
    expect(screen.queryByAltText('Render 1')).toBeNull()
  })

  it('generar desde el ORIGINAL llama a onGenerateRender con variant: "original"', async () => {
    const { onGenerateRender } = renderPanel('original', withVariant(null, 'original', originalConMuro()))

    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText(/^el plano$/i))
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))

    await waitFor(() => expect(onGenerateRender).toHaveBeenCalled())
    const [variant, req] = onGenerateRender.mock.calls[0]
    expect(variant).toBe('original')
    expect(req.plan).toBeInstanceOf(Blob)
    expect(req.promptText.length).toBeGreaterThan(0)
  })

  it('generar desde el PLANEADO llama a onGenerateRender con variant: "planned"', async () => {
    const { onGenerateRender } = renderPanel('planned', geometryConPlaneado())

    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText(/^el plano$/i))
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))

    await waitFor(() => expect(onGenerateRender).toHaveBeenCalled())
    const [variant, req] = onGenerateRender.mock.calls[0]
    expect(variant).toBe('planned')
    expect(req.plan).toBeInstanceOf(Blob)
  })
})
