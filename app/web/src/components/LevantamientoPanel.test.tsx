import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LevantamientoPanel } from './LevantamientoPanel'
import {
  withOriginal, withPlan, emptyFloorSet, emptyFloorGraph, clone,
  LEGACY_PLAN_ID, LEGACY_PLAN_NAME,
  type FloorPlanModel, type FloorSet, type ProjectPlan, type VariantKey,
} from '../lib/floorplan/types'
import type { PropertyRender } from '../lib/types'

/** El plan legado (id determinista 'planned') con el fs dado — el shape exacto que
 * migrateGeometry produce para un blob v3 con planned, y el que estos montajes fijos
 * variant="planned" siguen direccionando. */
const legacyPlan = (fs: FloorSet): ProjectPlan => ({ id: LEGACY_PLAN_ID, name: LEGACY_PLAN_NAME, fs })

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

/** Un levantamiento con 2 pisos de verdad — el caso de la propiedad 5 ("Locales
 * Salon Escobedo"), y el que ejercita el selector de piso de RENDERS (Task 30). */
function dosPlantas(): FloorSet {
  const fs = emptyFloorSet()
  fs.floors[0].name = 'Planta Baja'
  fs.floors.push(emptyFloorGraph('Planta Alta'))
  return fs
}

/** Compara un FloorSet ignorando el `id` de cada piso: útil cuando la variante bajo prueba
 * nace con identidad nueva a propósito (p. ej. EMPEZAR EN BLANCO) y solo importa la FORMA —
 * comparar contra una segunda llamada de fábrica generaría un id distinto por diseño. */
function sinIdsDePiso(fs: FloorSet): FloorSet {
  const c = clone(fs)
  c.floors.forEach(f => { delete (f as { id?: string }).id })
  return c
}

/** Render nacido del plano de UNA variante — `sourceVariant` es lo único que
 * `RendersPanel` usa para separar «lo mío» de «lo del otro levantamiento». */
function planRenderRow(id: number, variant: VariantKey, floorId: string | null = null): PropertyRender {
  return {
    id, propertyId: 7, sourceImageId: null, sourcePlanPath: `plan/${id}.png`, sourceVariant: variant,
    floorId, floorName: floorId,
    parentRenderId: null, filePath: `r/${id}.png`, contentType: 'image/png', promptId: null,
    promptText: 'Estilo minimalista.', provider: 'openai', model: 'gpt-image-2',
    createdAt: '2026-08-01T00:00:00Z', isChosen: false,
  }
}

function renderPanel(
  variant: VariantKey,
  geometry: FloorPlanModel | null,
  // Un onSave que nunca resuelve deja el estado "en vuelo" a la vista del test.
  onSave = vi.fn(async (_variant: VariantKey, _fs: FloorSet) => {}),
  over: {
    renders?: PropertyRender[]
    onGenerateRender?: (variant: VariantKey, req: { promptId: number | null; promptText: string; plan: Blob; floorId: string; floorName: string })
      => Promise<PropertyRender>
    onUploadRender?: (variant: VariantKey, req: { floorId: string; floorName: string; file: File })
      => Promise<PropertyRender>
  } = {},
) {
  const onReady = vi.fn()
  const onGenerateRender = over.onGenerateRender
    ? vi.fn(over.onGenerateRender)
    : vi.fn().mockResolvedValue(planRenderRow(99, variant))
  const onUploadRender = over.onUploadRender ? vi.fn(over.onUploadRender) : undefined
  // Extraído a función para poder re-renderizar con OTRA `geometry` — la
  // instancia real (`PropertyDetailPage`) nunca remonta el panel al cambiar el
  // FloorSet, solo le pasa props nuevas (`key` fijo por variante). Un test que
  // reproduzca "el FloorSet cambió por debajo" tiene que hacer lo mismo.
  const buildElement = (geo: FloorPlanModel | null) => (
    <LevantamientoPanel
      variant={variant}
      geometry={geo}
      onSave={onSave}
      onUploadImage={async () => ({ imageKey: 'test-key' })}
      onReady={onReady}
      onDirtyChange={() => {}}
      base=""
      prompts={[]}
      renders={over.renders ?? []}
      onGenerateRender={onGenerateRender}
      onUploadRender={onUploadRender}
      onSavePrompt={vi.fn().mockResolvedValue({ id: 1, name: 'x', body: 'y', kind: 'plan', isDefault: false, createdAt: '2026-08-01T00:00:00Z' })}
      onDeleteRender={vi.fn().mockResolvedValue(undefined)}
      onChoose={vi.fn().mockResolvedValue(undefined)}
      onUnchoose={vi.fn().mockResolvedValue(undefined)}
    />
  )
  const { rerender, container } = render(buildElement(geometry))
  return {
    onSave, onReady, onGenerateRender, onUploadRender, container,
    rerenderWithGeometry: (geo: FloorPlanModel | null) => rerender(buildElement(geo)),
  }
}

describe('LevantamientoPanel · ORIGINAL', () => {
  it('es solo el editor: sin botones de clonación en ninguna dirección', () => {
    const { onReady } = renderPanel('original', withOriginal(null, originalConMuro()))
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
    renderPanel('planned', withOriginal(null, originalConMuro()))
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
    const { onSave } = renderPanel('planned', withOriginal(null, original))

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

  it('el piso planeado comparte el id de su piso original: es linaje intencional, no un bug', async () => {
    // Decisión explícita (ver comentario junto a `clone(source)` en writePlanned,
    // LevantamientoPanel.tsx): clonar copia el id del piso original al planeado a
    // propósito — da linaje gratis entre variantes. La unicidad de FloorGraph.id (Task 28)
    // solo exige no repetirse DENTRO de un FloorSet; original y planned son arreglos
    // separados, así que compartir id entre ellos no colisiona con esa garantía.
    const original = originalConMuro()
    const { onSave } = renderPanel('planned', withOriginal(null, original))

    fireEvent.click(screen.getByText('PARTIR DEL ORIGINAL'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const [, fs] = onSave.mock.calls[0]
    expect(fs.floors[0].id).toBe(original.floors[0].id)
  })

  it('cada acción marca su propio estado en vuelo: el ocupado no se cuelga del botón vecino', () => {
    // Con un booleano compartido, EMPEZAR EN BLANCO ponía "CLONANDO…" en el
    // botón de PARTIR DEL ORIGINAL — el estado explícito dice CUÁL acción corre.
    const colgado = vi.fn((_v: VariantKey, _fs: FloorSet) => new Promise<void>(() => {}))
    renderPanel('planned', withOriginal(null, originalConMuro()), colgado)

    fireEvent.click(screen.getByText('EMPEZAR EN BLANCO'))

    expect(screen.getByText('CREANDO…')).toBeTruthy()
    const partir = screen.getByText('PARTIR DEL ORIGINAL') as HTMLButtonElement
    expect(partir.textContent).toBe('PARTIR DEL ORIGINAL')
    // Vecino sin su etiqueta de ocupado, pero igual desactivado: solo UNA escritura a la vez.
    expect(partir.disabled).toBe(true)
  })

  it('EMPEZAR EN BLANCO guarda un planeado con una planta en blanco', async () => {
    const { onSave } = renderPanel('planned', withOriginal(null, originalConMuro()))

    fireEvent.click(screen.getByText('EMPEZAR EN BLANCO'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const [variant, fs] = onSave.mock.calls[0]
    expect(variant).toBe('planned')
    // Misma forma que un FloorSet en blanco — el id difiere a propósito: EMPEZAR EN BLANCO
    // nace con identidad propia, no clonada, así que comparar contra otra llamada de
    // fábrica nunca puede coincidir en el id sin volverse un mock del generador.
    expect(sinIdsDePiso(fs)).toEqual(sinIdsDePiso(emptyFloorSet()))
    expect(fs.floors[0].id).toBeTruthy()
  })
})

describe('LevantamientoPanel · PLANEADO existente', () => {
  const geometry = () =>
    withPlan(withOriginal(null, originalConMuro()), legacyPlan(plannedFloorSet()))

  it('el empty state desaparece: se monta el editor con SU variante', () => {
    const { onReady } = renderPanel('planned', geometry())
    expect(screen.queryByText('PARTIR DEL ORIGINAL')).toBeNull()
    expect(screen.queryByText('EMPEZAR EN BLANCO')).toBeNull()
    expect(screen.getByText('Planta Planeada')).toBeTruthy()
    expect(screen.queryByText('Planta Original')).toBeNull()
    expect(onReady).toHaveBeenCalledWith('planned', expect.anything())
  })

  it('RE-PARTIR exige la confirmación de dos pasos, y cancelar no clona nada', async () => {
    // Reusa LA MISMA instancia de `original` para armar la geometría y para comparar el
    // resultado: `originalConMuro()` genera un id nuevo en cada llamada (vía emptyFloorSet),
    // así que comparar contra una segunda llamada nunca coincidiría en el id del piso.
    const original = originalConMuro()
    const { onSave } = renderPanel('planned', withPlan(withOriginal(null, original), legacyPlan(plannedFloorSet())))

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
    expect(fs).toEqual(original)
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
    withPlan(withOriginal(null, originalConMuro()), legacyPlan(plannedFloorSet()))

  it('PLANO sigue mostrando el editor sin cambios', () => {
    renderPanel('original', withOriginal(null, originalConMuro()))
    // El sub-nav es nuevo, pero PLANO es la pestaña activa por default: el
    // editor de siempre, con sus mismas herramientas.
    expect(screen.getByText('PLANO')).toBeTruthy()
    expect(screen.getByText('RENDERS')).toBeTruthy()
    expect(screen.getByText('Planta Original')).toBeTruthy()
    expect(screen.getByText('wall')).toBeTruthy()
  })

  it('el empty-state PLANEADO no ofrece RENDERS — no hay plano del que generar', () => {
    renderPanel('planned', withOriginal(null, originalConMuro()))
    expect(screen.getByText('PARTIR DEL ORIGINAL')).toBeTruthy()
    expect(screen.queryByText('RENDERS')).toBeNull()
    expect(screen.queryByText('PLANO')).toBeNull()
  })

  it('ORIGINAL: la pestaña RENDERS lista solo los renders de SU variante', () => {
    const renders = [planRenderRow(1, 'original'), planRenderRow(2, 'planned')]
    renderPanel('original', withOriginal(null, originalConMuro()), undefined, { renders })

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

  it('generar desde el ORIGINAL llama a onGenerateRender con variant: "original" y el piso único', async () => {
    const original = originalConMuro()
    const { onGenerateRender } = renderPanel('original', withOriginal(null, original))

    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText(/^el plano$/i))
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))

    await waitFor(() => expect(onGenerateRender).toHaveBeenCalled())
    const [variant, req] = onGenerateRender.mock.calls[0]
    expect(variant).toBe('original')
    expect(req.plan).toBeInstanceOf(Blob)
    expect(req.promptText.length).toBeGreaterThan(0)
    // Con un solo piso, el selector de RENDERS no hace falta tocarlo: el
    // default ya manda la identidad correcta al backend (Task 30).
    expect(req.floorId).toBe(original.floors[0].id)
    expect(req.floorName).toBe('Planta Original')
  })

  it('generar desde el PLANEADO llama a onGenerateRender con variant: "planned" y el piso único', async () => {
    const { onGenerateRender } = renderPanel('planned', geometryConPlaneado())

    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText(/^el plano$/i))
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))

    await waitFor(() => expect(onGenerateRender).toHaveBeenCalled())
    const [variant, req] = onGenerateRender.mock.calls[0]
    expect(variant).toBe('planned')
    expect(req.plan).toBeInstanceOf(Blob)
    expect(req.floorId).toBeTruthy()
    expect(req.floorName).toBe('Planta Planeada')
  })
})

describe('LevantamientoPanel · selector de piso en RENDERS (Task 30)', () => {
  it('el selector de RENDERS ofrece un botón por piso de fs.floors', () => {
    renderPanel('original', withOriginal(null, dosPlantas()))
    fireEvent.click(screen.getByText('RENDERS'))
    expect(screen.getByText('Planta Baja')).toBeTruthy()
    expect(screen.getByText('Planta Alta')).toBeTruthy()
  })

  it('elegir un piso en RENDERS no mueve el piso activo de PLANO — estados independientes', () => {
    renderPanel('original', withOriginal(null, dosPlantas()))

    // Piso activo de PLANO (pestaña por default) antes de tocar nada en RENDERS.
    const bajaAntes = (screen.getByText('Planta Baja') as HTMLButtonElement).getAttribute('style')
    const altaAntes = (screen.getByText('Planta Alta') as HTMLButtonElement).getAttribute('style')

    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText('Planta Alta'))   // el selector PROPIO de RENDERS
    fireEvent.click(screen.getByText('PLANO'))

    // El editor de PLANO se remonta igual que antes, con el MISMO piso activo:
    // nada de lo hecho en RENDERS lo tocó.
    expect((screen.getByText('Planta Baja') as HTMLButtonElement).getAttribute('style')).toBe(bajaAntes)
    expect((screen.getByText('Planta Alta') as HTMLButtonElement).getAttribute('style')).toBe(altaAntes)
  })

  it('generar con el piso B seleccionado manda el id/nombre de B, no el de A', async () => {
    const dos = dosPlantas()
    const { onGenerateRender } = renderPanel('original', withOriginal(null, dos))

    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText('Planta Alta'))
    fireEvent.click(screen.getByText(/^el plano$/i))
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))

    await waitFor(() => expect(onGenerateRender).toHaveBeenCalled())
    const [, req] = onGenerateRender.mock.calls[0]
    expect(req.floorId).toBe(dos.floors[1].id)
    expect(req.floorName).toBe('Planta Alta')
    expect(req.floorId).not.toBe(dos.floors[0].id)
  })

  it('sin tocar el selector, genera con el PRIMER piso por default', async () => {
    const dos = dosPlantas()
    const { onGenerateRender } = renderPanel('original', withOriginal(null, dos))

    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText(/^el plano$/i))
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))

    await waitFor(() => expect(onGenerateRender).toHaveBeenCalled())
    const [, req] = onGenerateRender.mock.calls[0]
    expect(req.floorId).toBe(dos.floors[0].id)
    expect(req.floorName).toBe('Planta Baja')
  })

  it('subir un render en modo plano manda la variante y el piso seleccionado', async () => {
    const dos = dosPlantas()
    const uploadImpl = vi.fn().mockResolvedValue(planRenderRow(5, 'original'))
    const { container } = renderPanel('original', withOriginal(null, dos), undefined,
      { onUploadRender: uploadImpl })

    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText('Planta Alta'))
    fireEvent.click(screen.getByText(/^el plano$/i))
    const file = new File(['x'], 'externo.png', { type: 'image/png' })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(uploadImpl).toHaveBeenCalled())
    const [variant, req] = uploadImpl.mock.calls[0]
    expect(variant).toBe('original')
    expect(req.floorId).toBe(dos.floors[1].id)
    expect(req.floorName).toBe('Planta Alta')
    expect(req.file).toBe(file)
  })

  it('subir un render en modo plano PLANEADO manda variant: "planned"', async () => {
    const geo = withPlan(withOriginal(null, originalConMuro()), legacyPlan(plannedFloorSet()))
    const uploadImpl = vi.fn().mockResolvedValue(planRenderRow(5, 'planned'))
    const { container } = renderPanel('planned', geo, undefined, { onUploadRender: uploadImpl })

    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText(/^el plano$/i))
    const file = new File(['x'], 'externo.png', { type: 'image/png' })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(uploadImpl).toHaveBeenCalled())
    const [variant] = uploadImpl.mock.calls[0]
    expect(variant).toBe('planned')
  })
})

describe('LevantamientoPanel · GENERAR TODOS LOS PISOS (Task 31)', () => {
  it('con un solo piso no ofrece el botón de lote — sería idéntico al individual', () => {
    renderPanel('original', withOriginal(null, originalConMuro()))
    fireEvent.click(screen.getByText('RENDERS'))
    expect(screen.queryByText('GENERAR TODOS LOS PISOS')).toBeNull()
  })

  it('con 2+ pisos ofrece el botón de lote', () => {
    renderPanel('original', withOriginal(null, dosPlantas()))
    fireEvent.click(screen.getByText('RENDERS'))
    expect(screen.getByText('GENERAR TODOS LOS PISOS')).toBeTruthy()
  })

  it('exige confirmación de dos pasos: el primer click NO dispara ninguna llamada', () => {
    const { onGenerateRender } = renderPanel('original', withOriginal(null, dosPlantas()))
    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText('GENERAR TODOS LOS PISOS'))

    expect(onGenerateRender).not.toHaveBeenCalled()
    expect(screen.getByText(/¿CONFIRMAR/i)).toBeTruthy()
    // Avisa costo/tiempo antes de confirmar: N pisos, N cargos reales.
    expect(screen.getByText(/2 PISOS · ~2×60-90S · 2 CARGOS REALES/)).toBeTruthy()
  })

  it('CANCELAR en la confirmación no dispara nada y regresa al botón inicial', () => {
    const { onGenerateRender } = renderPanel('original', withOriginal(null, dosPlantas()))
    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText('GENERAR TODOS LOS PISOS'))
    fireEvent.click(screen.getByText('CANCELAR'))

    expect(screen.queryByText(/¿CONFIRMAR/i)).toBeNull()
    expect(screen.getByText('GENERAR TODOS LOS PISOS')).toBeTruthy()
    expect(onGenerateRender).not.toHaveBeenCalled()
  })

  it('confirmar genera un render por CADA piso, con su propio floorId/floorName/plano', async () => {
    const dos = dosPlantas()
    const { onGenerateRender } = renderPanel('original', withOriginal(null, dos))
    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText('GENERAR TODOS LOS PISOS'))
    fireEvent.click(screen.getByText(/¿CONFIRMAR/i))

    await waitFor(() => expect(onGenerateRender).toHaveBeenCalledTimes(2))
    const [variant1, req1] = onGenerateRender.mock.calls[0]
    const [variant2, req2] = onGenerateRender.mock.calls[1]
    expect(variant1).toBe('original')
    expect(variant2).toBe('original')
    expect(req1.floorId).toBe(dos.floors[0].id)
    expect(req1.floorName).toBe('Planta Baja')
    expect(req2.floorId).toBe(dos.floors[1].id)
    expect(req2.floorName).toBe('Planta Alta')
    // Cada llamada trae SU propio plano rasterizado, no el mismo blob reusado.
    expect(req1.plan).toBeInstanceOf(Blob)
    expect(req2.plan).toBeInstanceOf(Blob)
    // No nace de un preset guardado: el lote siembra su propio texto desde los hechos del piso.
    expect(req1.promptId).toBeNull()
    expect(req1.promptText.length).toBeGreaterThan(0)
  })

  it('es SECUENCIAL: el piso 2 no se dispara hasta que el piso 1 resuelve', async () => {
    const dos = dosPlantas()
    let resolveFirst: (v: PropertyRender) => void = () => {}
    const first = new Promise<PropertyRender>(r => { resolveFirst = r })
    let n = 0
    const impl = vi.fn(async (variant: VariantKey) => {
      n++
      if (n === 1) return first
      return planRenderRow(2, variant)
    })
    const { onGenerateRender } = renderPanel(
      'original', withOriginal(null, dos), undefined, { onGenerateRender: impl },
    )
    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText('GENERAR TODOS LOS PISOS'))
    fireEvent.click(screen.getByText(/¿CONFIRMAR/i))

    await waitFor(() => expect(onGenerateRender).toHaveBeenCalledTimes(1))
    // El primero sigue en vuelo: el segundo no debe haberse disparado todavía.
    await new Promise(r => setTimeout(r, 10))
    expect(onGenerateRender).toHaveBeenCalledTimes(1)

    resolveFirst(planRenderRow(1, 'original'))
    await waitFor(() => expect(onGenerateRender).toHaveBeenCalledTimes(2))
  })

  it('un fallo en un piso no cancela a los demás — todos se intentan y el resumen final lo dice', async () => {
    const dos = dosPlantas()
    const impl = vi.fn(async (variant: VariantKey, req: { floorName: string }) => {
      if (req.floorName === 'Planta Baja') throw new Error('OPENAI_API_KEY no está configurada')
      return planRenderRow(2, variant)
    })
    const { onGenerateRender } = renderPanel(
      'original', withOriginal(null, dos), undefined, { onGenerateRender: impl },
    )
    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText('GENERAR TODOS LOS PISOS'))
    fireEvent.click(screen.getByText(/¿CONFIRMAR/i))

    await waitFor(() => expect(onGenerateRender).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/1 de 2 generados/)).toBeTruthy()
    expect(screen.getByText(/Planta Baja — OPENAI_API_KEY no está configurada/)).toBeTruthy()
  })

  it('muestra qué piso se está generando ahora mismo mientras el lote corre', async () => {
    const dos = dosPlantas()
    let resolveFirst: (v: PropertyRender) => void = () => {}
    const pendiente = new Promise<PropertyRender>(r => { resolveFirst = r })
    const impl = vi.fn(async () => pendiente)
    renderPanel('original', withOriginal(null, dos), undefined, { onGenerateRender: impl })

    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText('GENERAR TODOS LOS PISOS'))
    fireEvent.click(screen.getByText(/¿CONFIRMAR/i))

    expect(await screen.findByText(/Generando piso 1 de 2: Planta Baja/i)).toBeTruthy()
    resolveFirst(planRenderRow(1, 'original'))
  })

  it('el resumen del lote no sobrevive a que el FloorSet se reemplace por otro con pisos distintos', async () => {
    // Reproduce el hallazgo del revisor: un lote corre hasta terminar en un
    // FloorSet de 2 pisos, y LUEGO ese FloorSet se reemplaza POR COMPLETO —
    // el mismo gesto que un RE-PARTIR DEL ORIGINAL, un EMPEZAR EN BLANCO, o
    // agregar/quitar un piso en el editor y guardar (`onSave` reescribe la
    // variante entera en los tres casos). El banner viejo no debe seguir
    // describiendo pisos que ya no existen.
    const dos = dosPlantas()
    const { rerenderWithGeometry } = renderPanel('original', withOriginal(null, dos))
    fireEvent.click(screen.getByText('RENDERS'))
    fireEvent.click(screen.getByText('GENERAR TODOS LOS PISOS'))
    fireEvent.click(screen.getByText(/¿CONFIRMAR/i))

    expect(await screen.findByText(/2 de 2 generados/)).toBeTruthy()

    const otros = emptyFloorSet()
    otros.floors[0].name = 'Sotano'
    otros.floors.push(emptyFloorGraph('Azotea'))
    rerenderWithGeometry(withOriginal(null, otros))

    expect(screen.queryByText(/generados/)).toBeNull()
    expect(screen.queryByText(/Generando piso/)).toBeNull()
    // El botón inicial regresa — ninguna confirmación armada de un lote viejo.
    expect(screen.getByText('GENERAR TODOS LOS PISOS')).toBeTruthy()
    expect(screen.queryByText(/¿CONFIRMAR/i)).toBeNull()
  })
})
