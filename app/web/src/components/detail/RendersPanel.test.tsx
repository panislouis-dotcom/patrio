import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RendersPanel } from './RendersPanel'
import type { PropertyImage, RenderPrompt, PropertyRender } from '../../lib/types'

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

const renderRow = (id: number): PropertyRender => ({
  id, propertyId: 7, sourceImageId: 10, filePath: `r/${id}.png`, contentType: 'image/png',
  promptId: 1, promptText: 'Mezquite y agaves.', provider: 'openai', model: 'gpt-image-2',
  createdAt: '2026-08-02T00:00:00Z',
})

function setup(over: Partial<Parameters<typeof RendersPanel>[0]> = {}) {
  const props = {
    images: [photo(10, 'fachada.jpg'), photo(11, 'jardin.jpg')],
    prompts,
    renders: [] as PropertyRender[],
    base: '',
    onGenerate: vi.fn().mockResolvedValue(renderRow(1)),
    onSavePrompt: vi.fn().mockResolvedValue(prompts[0]),
    onDeleteRender: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
  render(<RendersPanel {...props} />)
  return props
}

describe('RendersPanel', () => {
  it('no permite generar sin una foto elegida', () => {
    setup()
    expect(screen.getByRole('button', { name: /GENERAR/i }).hasAttribute('disabled')).toBe(true)
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

  it('avisa cuando la propiedad no tiene fotos que renderizar', () => {
    setup({ images: [] })
    expect(screen.getByText(/sube una foto/i)).not.toBeNull()
  })
})
