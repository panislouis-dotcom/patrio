import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RendersPanel } from './RendersPanel'
import type { PropertyImage, RenderPrompt, PropertyRender } from '../../lib/types'
import { emptyFloorGraph, type FloorGraph } from '../../lib/floorplan/types'

/** Un piso con solo nombres de cuarto sueltos (sin polígono cerrado) — basta para que
 * `roomLabels`/`planFacts` los reporten; a estos tests no les importa el área. */
function planWithRooms(names: string[]): FloorGraph {
  const f = emptyFloorGraph('Test')
  f.rooms = names.map((name, i) => ({ name, cx: i, cy: 0 }))
  return f
}

const photo = (id: number, name: string): PropertyImage => ({
  id, filePath: `p/${id}.png`, fileName: name, contentType: 'image/png',
  sortOrder: 0, uploadedAt: '2026-08-01T00:00:00Z', imageType: 'antes',
})

const prompts: RenderPrompt[] = [
  { id: 1, name: 'Jardín regional (xeriscape)', body: 'Mezquite y agaves.', isDefault: true,
    createdAt: '2026-08-01T00:00:00Z' },
  { id: 2, name: 'Fachada minimalista', body: 'Aplanado fino en lino.', isDefault: true,
    createdAt: '2026-08-01T00:00:00Z' },
]

/** Render nacido de una FOTO: `sourceVariant` NULL, como lo manda la migración 040. */
const renderRow = (id: number): PropertyRender => ({
  id, propertyId: 7, sourceImageId: 10, sourcePlanPath: null, sourceVariant: null, parentRenderId: null,
  filePath: `r/${id}.png`, contentType: 'image/png', promptId: 1, promptText: 'Mezquite y agaves.',
  provider: 'openai', model: 'gpt-image-2', createdAt: '2026-08-02T00:00:00Z',
})

/** Render nacido del PLANO: sin foto, con `sourcePlanPath` y `sourceVariant` puestos. */
const planRenderRow = (id: number, variant: 'original' | 'planned' = 'original'): PropertyRender => ({
  ...renderRow(id), sourceImageId: null, sourcePlanPath: `plan/${id}.png`, sourceVariant: variant,
})

// Los tests mezclan campos de las dos ramas de la unión discriminada a propósito
// (p.ej. pasar `plan` con `source: 'photos'` para probar que el modo fotos lo
// ignora) — exactamente lo que la unión ahora bloquea en tiempo de compilación
// para quien llama de verdad (`LevantamientoPanel`, `FotosPanel`). Por eso `over`
// se queda flexible aquí y el cast al render es intencional: este archivo prueba
// la defensa en TIEMPO DE EJECUCIÓN, no el tipo.
function setup(over: Record<string, unknown> = {}) {
  const props = {
    source: 'photos' as const,
    images: [photo(10, 'fachada.jpg'), photo(11, 'jardin.jpg')],
    prompts,
    renders: [] as PropertyRender[],
    base: '',
    onGenerate: vi.fn().mockResolvedValue(renderRow(1)),
    onSavePrompt: vi.fn().mockResolvedValue(prompts[0]),
    onDeleteRender: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
  render(<RendersPanel {...(props as unknown as Parameters<typeof RendersPanel>[0])} />)
  return props
}

describe('RendersPanel', () => {
  it('no permite generar sin una foto elegida', () => {
    setup()
    expect(screen.getByRole('button', { name: /GENERAR RENDER/i }).hasAttribute('disabled')).toBe(true)
  })

  it('dice QUÉ falta cuando no se puede generar', () => {
    // Un botón muerto sin explicación se lee como «no pasó nada»: elegir preset
    // es la acción obvia, pero la que habilita es elegir foto.
    setup()
    expect(screen.getByText(/elige una fuente/i)).not.toBeNull()
  })

  it('deja de reclamar la foto en cuanto la eliges', () => {
    setup()
    fireEvent.click(screen.getByAltText('fachada.jpg'))
    expect(screen.queryByText(/elige una fuente/i)).toBeNull()
  })

  it('mientras genera, aparece una tarjeta en la lista — donde el usuario mira', async () => {
    // Tarda ~65 s. La única señal era una etiqueta chiquita en el botón, así que
    // la lista de renders no cambiaba en más de un minuto.
    let resolver: (v: PropertyRender) => void = () => {}
    const pendiente = new Promise<PropertyRender>(r => { resolver = r })
    setup({ onGenerate: vi.fn().mockReturnValue(pendiente) })

    fireEvent.click(screen.getByAltText('fachada.jpg'))
    fireEvent.change(screen.getByLabelText(/texto del prompt/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))

    expect(await screen.findByText(/generando render/i)).not.toBeNull()
    expect(screen.getByText(/puede tardar/i)).not.toBeNull()
    resolver(renderRow(9))
  })

  it('elegir un preset llena el texto editable', () => {
    setup()
    fireEvent.change(screen.getByLabelText(/preset/i), { target: { value: '2' } })
    expect((screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement).value)
      .toBe('Aplanado fino en lino.')
  })

  it('genera con la foto elegida y conserva la liga al preset sin tocar', async () => {
    const props = setup()
    fireEvent.click(screen.getByAltText('jardin.jpg'))
    fireEvent.change(screen.getByLabelText(/preset/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /GENERAR/i }))

    await waitFor(() => expect(props.onGenerate).toHaveBeenCalledWith({
      sourceImageId: 11, promptId: 1, promptText: 'Mezquite y agaves.',
    }))
  })

  it('editar el texto de un preset lo desliga del preset al generar', async () => {
    // Si el texto ya no es el del preset, mandar promptId mentiría sobre el origen.
    const props = setup()
    fireEvent.click(screen.getByAltText('fachada.jpg'))
    fireEvent.change(screen.getByLabelText(/preset/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/texto del prompt/i),
      { target: { value: 'Otra cosa totalmente distinta.' } })
    fireEvent.click(screen.getByRole('button', { name: /GENERAR/i }))

    await waitFor(() => expect(props.onGenerate).toHaveBeenCalledWith({
      sourceImageId: 10, promptId: null, promptText: 'Otra cosa totalmente distinta.',
    }))
  })

  it('guarda el texto ajustado como prompt nuevo', async () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText(/texto del prompt/i),
      { target: { value: 'Cochera techada ligera.' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar como nuevo/i }))
    fireEvent.change(screen.getByLabelText(/nombre del prompt/i),
      { target: { value: 'Cochera' } })
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    await waitFor(() => expect(props.onSavePrompt).toHaveBeenCalledWith({
      name: 'Cochera', body: 'Cochera techada ligera.',
    }))
  })

  it('marca cada render como propuesta, nunca como foto', () => {
    // La garantía visual del modelo de datos: quien lo mire no puede confundirlo.
    setup({ renders: [renderRow(1)] })
    expect(screen.getByText(/propuesta/i)).not.toBeNull()
  })

  it('la marca va encima de la imagen, no debajo', () => {
    // Debajo de un render de 1024px la marca queda fuera de pantalla, y un
    // recorte de la imagen no la lleva. La garantía tiene que viajar pegada.
    setup({ renders: [renderRow(1)] })
    const mark = screen.getByText(/propuesta/i)
    const img = screen.getByAltText('Render 1')
    // Node.DOCUMENT_POSITION_FOLLOWING = 4 → la imagen viene DESPUÉS de la marca.
    expect(mark.compareDocumentPosition(img) & 4).toBeTruthy()
  })

  it('muestra el prompt con el que se generó cada render', () => {
    setup({ renders: [renderRow(1)] })
    expect(screen.getByText(/Mezquite y agaves\./)).not.toBeNull()
  })

  it('el prompt va antes de la imagen, no sepultado debajo', () => {
    // Debajo de un render de 520 px el prompt queda fuera de pantalla y el
    // render pierde lo único que explica de dónde salió.
    setup({ renders: [renderRow(1)] })
    const prompt = screen.getByText(/Mezquite y agaves\./)
    const img = screen.getByAltText('Render 1')
    expect(prompt.compareDocumentPosition(img) & 4).toBeTruthy()
  })

  it('muestra la foto base junto al render — un render solo dice algo con su antes', () => {
    setup({ renders: [renderRow(1)] })  // sourceImageId: 10 = fachada.jpg
    expect(screen.getByAltText('Foto base del render 1')).not.toBeNull()
  })

  it('cuando la foto base se borró lo dice, en vez de fingir que no había', () => {
    setup({ renders: [{ ...renderRow(1), sourceImageId: null }] })
    expect(screen.getByText(/fuente base borrada/i)).not.toBeNull()
    expect(screen.queryByAltText('Foto base del render 1')).toBeNull()
  })

  it('fecha el render: una propuesta de hace seis meses no vale lo mismo', () => {
    setup({ renders: [renderRow(1)] })
    expect(screen.getByText(/2 ago 2026/i)).not.toBeNull()
  })

  it('avisa cuando la propiedad no tiene fotos que renderizar', () => {
    setup({ images: [] })
    expect(screen.getByText(/sube una foto/i)).not.toBeNull()
  })

  it('enseña el motivo cuando el proveedor falla, no un error genérico', async () => {
    // El día uno en QA, sin el secreto, la API contesta 502 con el motivo
    // exacto. Si la pantalla se lo traga, el operador no sabe qué pedirle a
    // infra y reporta «no funciona».
    const props = setup({
      onGenerate: vi.fn().mockRejectedValue(new Error('OPENAI_API_KEY no está configurada')),
    })
    fireEvent.click(screen.getByAltText('fachada.jpg'))
    fireEvent.change(screen.getByLabelText(/texto del prompt/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))

    expect(await screen.findByText(/OPENAI_API_KEY no está configurada/)).not.toBeNull()
    expect(props.onGenerate).toHaveBeenCalled()
  })

  it('ofrece el plano como fuente y siembra el prompt desde los cuartos (modo plano)', () => {
    setup({ source: 'plan', variant: 'original', plan: planWithRooms(['Cocina', 'Recámara']), onGeneratePlan: vi.fn() })
    fireEvent.click(screen.getByText(/^el plano$/i))
    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    expect(ta.value).toMatch(/Cocina/)
    expect(ta.value).toMatch(/Recámara/)
  })

  it('genera desde el plano cuando el plano es la fuente elegida (modo plano)', async () => {
    const onGeneratePlan = vi.fn().mockResolvedValue(planRenderRow(2))
    setup({ source: 'plan', variant: 'original', plan: planWithRooms(['Sala']), onGeneratePlan })
    fireEvent.click(screen.getByText(/^el plano$/i))
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))
    await waitFor(() => expect(onGeneratePlan).toHaveBeenCalled())
  })

  it('muestra «Plano base» cuando el render nació del plano, no «foto borrada» (modo plano)', () => {
    setup({ source: 'plan', variant: 'original', renders: [planRenderRow(1)] })
    expect(screen.getByText('Plano base')).not.toBeNull()
    expect(screen.queryByText(/foto base borrada/i)).toBeNull()
  })

  it('modo fotos: no ofrece "El plano" como fuente aunque haya plano', () => {
    // La fuente plano vive en el RendersPanel de cada levantamiento (Tarea 17),
    // no en el de FOTOS — mezclarlas confundiría cuál render nació de dónde.
    setup({ plan: planWithRooms(['Cocina']), onGeneratePlan: vi.fn() })
    expect(screen.queryByText(/^el plano$/i)).toBeNull()
  })

  it('modo fotos: solo lista cadenas nacidas de una foto, no las del plano', () => {
    setup({ renders: [renderRow(1), planRenderRow(2)] })
    expect(screen.getByAltText('Render 1')).not.toBeNull()
    expect(screen.queryByAltText('Render 2')).toBeNull()
  })

  it('modo plano: no ofrece tira de fotos aunque se le pasen', () => {
    setup({ source: 'plan', variant: 'original', images: [photo(10, 'fachada.jpg')], plan: planWithRooms(['Sala']) })
    expect(screen.queryByAltText('fachada.jpg')).toBeNull()
  })

  it('modo plano: solo lista cadenas de SU variante, no las de la otra', () => {
    setup({
      source: 'plan', variant: 'original',
      renders: [planRenderRow(1, 'original'), planRenderRow(2, 'planned')],
    })
    expect(screen.getByAltText('Render 1')).not.toBeNull()
    expect(screen.queryByAltText('Render 2')).toBeNull()
  })

  it('modo plano: variante equivocada deja la lista vacía, no truena', () => {
    // Defensa en profundidad: aunque el tipo ahora obliga a mandar `variant`, el
    // filtro (`scoped`) sigue siendo el único que decide qué se lista. Si TODOS
    // los renders son de la otra variante, la lista debe quedar en cero, no
    // reventar ni mostrar algo de la variante ajena.
    setup({
      source: 'plan', variant: 'original',
      renders: [planRenderRow(1, 'planned'), planRenderRow(2, 'planned')],
    })
    expect(screen.getByText('Renders (0)')).not.toBeNull()
    expect(screen.queryByAltText('Render 1')).toBeNull()
    expect(screen.queryByAltText('Render 2')).toBeNull()
  })

  it('«Trabajar sobre este» edita con una instrucción chica sobre el mismo render', async () => {
    const onEdit = vi.fn().mockResolvedValue(renderRow(2))
    setup({ renders: [renderRow(1)], onEdit })
    fireEvent.click(screen.getByText(/trabajar sobre este/i))
    fireEvent.change(screen.getByPlaceholderText(/solo el cambio/i),
      { target: { value: 'agrega puerta al baño' } })
    fireEvent.click(screen.getByRole('button', { name: /generar cambio/i }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(1, 'agrega puerta al baño'))
  })

  it('la lista muestra solo la cabeza de la cadena; el paso previo va al historial', () => {
    const raiz = renderRow(1)  // promptText: "Mezquite y agaves."
    const cabeza = { ...renderRow(2), parentRenderId: 1, promptText: 'Agrega puerta.' }
    setup({ renders: [cabeza, raiz] })  // el backend devuelve el más reciente primero
    expect(screen.getByText('Agrega puerta.')).not.toBeNull()          // la cabeza se ve
    expect(screen.queryByText('Mezquite y agaves.')).toBeNull()        // el paso previo, oculto
    expect(screen.getByText(/historial/i)).not.toBeNull()              // pero hay historial
  })

  it('deja de mostrar «generando» cuando la generación falla', async () => {
    // Si la tarjeta de progreso se queda pegada tras un error, parece que sigue
    // trabajando para siempre.
    setup({ onGenerate: vi.fn().mockRejectedValue(new Error('boom')) })
    fireEvent.click(screen.getByAltText('fachada.jpg'))
    fireEvent.change(screen.getByLabelText(/texto del prompt/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))

    await screen.findByText(/boom/)
    expect(screen.queryByText(/generando render/i)).toBeNull()
  })
})
