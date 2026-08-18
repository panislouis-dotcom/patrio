import { render, screen, fireEvent } from '@testing-library/react'
import { FotosPanel } from './FotosPanel'
import { PhotoGallery } from '../PhotoGallery'
import { RendersPanel } from './RendersPanel'
import type { PropertyImage, PropertyRender, RenderPrompt } from '../../lib/types'

// `PhotoGallery` y `RendersPanel` ya tienen su propia batería de pruebas — aquí
// solo importa que `FotosPanel` sea una cáscara de navegación fiel: monta cada
// uno con los props correctos y solo uno a la vez, sin tocar su interior.
vi.mock('../PhotoGallery', () => ({ PhotoGallery: vi.fn(() => <div data-testid="photo-gallery" />) }))
vi.mock('./RendersPanel', () => ({ RendersPanel: vi.fn(() => <div data-testid="renders-panel" />) }))

const image = (id: number): PropertyImage => ({
  id, filePath: `p/${id}.png`, fileName: `${id}.jpg`, contentType: 'image/png',
  sortOrder: 0, uploadedAt: '2026-08-01T00:00:00Z', imageType: 'antes',
})

const prompt: RenderPrompt = {
  id: 1, name: 'Jardín regional', body: 'Mezquite y agaves.', kind: 'photo', isDefault: true,
  createdAt: '2026-08-01T00:00:00Z',
}

const renderRow: PropertyRender = {
  id: 1, propertyId: 7, sourceImageId: 10, sourcePlanPath: null, sourceVariant: null,
  floorId: null, floorName: null,
  parentRenderId: null, filePath: 'r/1.png', contentType: 'image/png', promptId: 1,
  promptText: 'Mezquite y agaves.', provider: 'openai', model: 'gpt-image-2',
  createdAt: '2026-08-02T00:00:00Z', isChosen: false,
}

function setup(over: Partial<Parameters<typeof FotosPanel>[0]> = {}) {
  const props = {
    images: [image(10), image(11)],
    base: 'http://api.test',
    onUpload: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onChangeType: vi.fn().mockResolvedValue(undefined),
    onReorder: vi.fn().mockResolvedValue(undefined),
    prompts: [prompt],
    renders: [renderRow],
    onGenerate: vi.fn().mockResolvedValue(renderRow),
    onEdit: vi.fn().mockResolvedValue(renderRow),
    onSavePrompt: vi.fn().mockResolvedValue(prompt),
    onDeleteRender: vi.fn().mockResolvedValue(undefined),
    onChoose: vi.fn().mockResolvedValue(undefined),
    onUnchoose: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
  render(<FotosPanel {...props} />)
  return props
}

describe('FotosPanel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('ofrece la sub-navegación GALERÍA | RENDERS', () => {
    setup()
    expect(screen.getByText('GALERÍA')).not.toBeNull()
    expect(screen.getByText('RENDERS')).not.toBeNull()
  })

  it('GALERÍA es la vista por omisión', () => {
    setup()
    expect(screen.getByTestId('photo-gallery')).not.toBeNull()
    expect(screen.queryByTestId('renders-panel')).toBeNull()
  })

  it('clic en RENDERS muestra su panel y oculta la galería', () => {
    setup()
    fireEvent.click(screen.getByText('RENDERS'))
    expect(screen.getByTestId('renders-panel')).not.toBeNull()
    expect(screen.queryByTestId('photo-gallery')).toBeNull()
  })

  it('monta PhotoGallery con las fotos y los callbacks tal cual', () => {
    const props = setup()
    expect(vi.mocked(PhotoGallery)).toHaveBeenCalledWith(
      expect.objectContaining({
        images: props.images, base: props.base, onUpload: props.onUpload,
        onDelete: props.onDelete, onChangeType: props.onChangeType, onReorder: props.onReorder,
      }),
      {},
    )
  })

  it('monta RendersPanel en modo "photos" con las fotos, prompts y renders', () => {
    const props = setup()
    fireEvent.click(screen.getByText('RENDERS'))
    expect(vi.mocked(RendersPanel)).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'photos', images: props.images, prompts: props.prompts, renders: props.renders,
        base: props.base, onGenerate: props.onGenerate, onEdit: props.onEdit,
        onSavePrompt: props.onSavePrompt, onDeleteRender: props.onDeleteRender,
      }),
      {},
    )
  })

  // ── Selector de foto (Task 32) ───────────────────────────────────────────────
  // La estrella marca UN elegido POR FOTO, así que RENDERS tiene que poder
  // aislar "los renders de ESTA foto". El selector vive aquí —dueño de la lista
  // de fotos— y no dentro de `RendersPanel`, mismo reparto que el selector de
  // piso de `LevantamientoPanel`. No se confunde con el escogedor de "Fuente"
  // de `RendersPanel`: ese elige de qué foto NACE un render nuevo; este elige
  // cuáles ya existentes se ENSEÑAN.
  describe('selector de foto en RENDERS', () => {
    it('ofrece un botón por foto, con su nombre de archivo', () => {
      const props = setup()
      fireEvent.click(screen.getByText('RENDERS'))
      for (const img of props.images) expect(screen.getByRole('button', { name: img.fileName })).not.toBeNull()
    })

    it('no lo enseña en GALERÍA — ahí las fotos ya se ven todas', () => {
      const props = setup()
      expect(screen.queryByRole('button', { name: props.images[0].fileName })).toBeNull()
    })

    it('arranca en la primera foto, para que RENDERS nunca abra en blanco', () => {
      setup()
      fireEvent.click(screen.getByText('RENDERS'))
      expect(vi.mocked(RendersPanel)).toHaveBeenCalledWith(
        expect.objectContaining({ selectedImageId: 10 }), {},
      )
    })

    it('elegir otra foto cambia la foto que RendersPanel tiene que mostrar', () => {
      setup()
      fireEvent.click(screen.getByText('RENDERS'))
      vi.mocked(RendersPanel).mockClear()
      fireEvent.click(screen.getByRole('button', { name: '11.jpg' }))
      expect(vi.mocked(RendersPanel)).toHaveBeenCalledWith(
        expect.objectContaining({ selectedImageId: 11 }), {},
      )
    })

    it('sin fotos no hay selector, y RendersPanel lo sabe (null, no un id inventado)', () => {
      setup({ images: [] })
      fireEvent.click(screen.getByText('RENDERS'))
      expect(screen.queryByRole('button', { name: /\.jpg$/ })).toBeNull()
      expect(vi.mocked(RendersPanel)).toHaveBeenCalledWith(
        expect.objectContaining({ selectedImageId: null }), {},
      )
    })

    it('reenvía onChoose/onUnchoose a RendersPanel — la estrella la maneja la página', () => {
      const props = setup()
      fireEvent.click(screen.getByText('RENDERS'))
      expect(vi.mocked(RendersPanel)).toHaveBeenCalledWith(
        expect.objectContaining({ onChoose: props.onChoose, onUnchoose: props.onUnchoose }), {},
      )
    })
  })
})
