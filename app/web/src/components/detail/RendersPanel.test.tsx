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
  { id: 1, name: 'Jardín regional (xeriscape)', body: 'Mezquite y agaves.', kind: 'photo', isDefault: true,
    createdAt: '2026-08-01T00:00:00Z' },
  { id: 2, name: 'Fachada minimalista', body: 'Aplanado fino en lino.', kind: 'photo', isDefault: true,
    createdAt: '2026-08-01T00:00:00Z' },
]

/** Presets de PLANO (Tarea 22): estilo puro, sin describir áreas. Sirven para
 * probar que un panel `photos` nunca los ofrece, y viceversa. */
const planPrompts: RenderPrompt[] = [
  { id: 3, name: 'Cálido contemporáneo', body: 'Piso de madera, tonos cálidos.', kind: 'plan', isDefault: true,
    createdAt: '2026-08-01T00:00:00Z' },
  { id: 4, name: 'Minimalista nórdico', body: 'Blancos y madera clara.', kind: 'plan', isDefault: true,
    createdAt: '2026-08-01T00:00:00Z' },
]

/** Render nacido de una FOTO: `sourceVariant` NULL, como lo manda la migración 040. */
const renderRow = (id: number): PropertyRender => ({
  id, propertyId: 7, sourceImageId: 10, sourcePlanPath: null, sourceVariant: null, parentRenderId: null,
  floorId: null, floorName: null,
  filePath: `r/${id}.png`, contentType: 'image/png', promptId: 1, promptText: 'Mezquite y agaves.',
  provider: 'openai', model: 'gpt-image-2', createdAt: '2026-08-02T00:00:00Z', isChosen: false,
})

/** Render nacido del PLANO: sin foto, con `sourcePlanPath`/`sourceVariant` puestos y su
 * piso identificado — `floorId`/`floorName` null por defecto significa RENDER LEGADO
 * (anterior a la migración 042), no "sin variar": los tests de piso lo pisan a propósito. */
const planRenderRow = (
  id: number, variant: string = 'original',
  floor: { id: string | null; name: string | null } = { id: null, name: null },
): PropertyRender => ({
  ...renderRow(id), sourceImageId: null, sourcePlanPath: `plan/${id}.png`, sourceVariant: variant,
  floorId: floor.id, floorName: floor.name,
})

// Base fija (no genérica) para los tests de modo PLANO que rerenderean al cambiar
// de piso: un objeto plano en vez de una función con `over` tipado ancho — con
// `over: Record<string, unknown>` (o incluso un genérico `<T extends object>`)
// TypeScript termina de mezclar el spread dentro del JSX sin conservar las claves
// específicas de cada llamada, y `PlanProps` deja de poder verificarse en el sitio
// de uso aunque en runtime estén presentes. Un objeto literal simple + props
// explícitas en cada JSX no tiene esa duda.
const planBase = {
  source: 'plan' as const,
  variant: 'original' as const,
  prompts: planPrompts,
  renders: [] as PropertyRender[],
  base: '',
  onSavePrompt: vi.fn().mockResolvedValue(planPrompts[0]),
  onDeleteRender: vi.fn().mockResolvedValue(undefined),
  onChoose: vi.fn().mockResolvedValue(undefined),
  onUnchoose: vi.fn().mockResolvedValue(undefined),
}

// Los tests mezclan campos de las dos ramas de la unión discriminada a propósito
// (p.ej. pasar `plan` con `source: 'photos'` para probar que el modo fotos lo
// ignora) — exactamente lo que la unión ahora bloquea en tiempo de compilación
// para quien llama de verdad (`LevantamientoPanel`, `FotosPanel`). Por eso `over`
// se queda flexible aquí y el cast al render es intencional: este archivo prueba
// la defensa en TIEMPO DE EJECUCIÓN, no el tipo.
function setup(over: Record<string, unknown> = {}) {
  // Modo plano trae de fábrica un solo piso, sin ambigüedad — el caso común (la
  // inmensa mayoría de propiedades). Los tests de Task 30 que necesitan 2+ pisos
  // o un piso concreto pisan `floorId`/`floorName`/`floorCount` vía `over`.
  const isPlan = over.source === 'plan'
  const props = {
    source: 'photos' as const,
    images: [photo(10, 'fachada.jpg'), photo(11, 'jardin.jpg')],
    prompts,
    renders: [] as PropertyRender[],
    base: '',
    onGenerate: vi.fn().mockResolvedValue(renderRow(1)),
    onSavePrompt: vi.fn().mockResolvedValue(prompts[0]),
    onDeleteRender: vi.fn().mockResolvedValue(undefined),
    ...(isPlan ? { floorId: null, floorName: null, floorCount: 1 } : {}),
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

  it('guarda el texto ajustado como prompt nuevo, con kind="photo" (modo fotos)', async () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText(/texto del prompt/i),
      { target: { value: 'Cochera techada ligera.' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar como nuevo/i }))
    fireEvent.change(screen.getByLabelText(/nombre del prompt/i),
      { target: { value: 'Cochera' } })
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    await waitFor(() => expect(props.onSavePrompt).toHaveBeenCalledWith({
      name: 'Cochera', body: 'Cochera techada ligera.', kind: 'photo',
    }))
  })

  it('modo plano: guarda como nuevo con kind="plan", nunca "photo"', async () => {
    const onSavePrompt = vi.fn().mockResolvedValue(planPrompts[0])
    setup({
      source: 'plan', variant: 'original', plan: planWithRooms(['Sala']),
      onGeneratePlan: vi.fn(), onSavePrompt,
    })
    fireEvent.change(screen.getByLabelText(/texto del prompt/i),
      { target: { value: 'Estilo cálido con madera.' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar como nuevo/i }))
    fireEvent.change(screen.getByLabelText(/nombre del prompt/i),
      { target: { value: 'Cálido' } })
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))

    await waitFor(() => expect(onSavePrompt).toHaveBeenCalledWith({
      name: 'Cálido', body: 'Estilo cálido con madera.', kind: 'plan',
    }))
  })

  it('modo fotos: el selector de preset solo ofrece los de kind="photo"', () => {
    setup({ prompts: [...prompts, ...planPrompts] })
    const select = screen.getByLabelText(/preset/i) as HTMLSelectElement
    const optionText = Array.from(select.options).map(o => o.textContent).join(' | ')
    expect(optionText).toMatch(/Jardín regional/)
    expect(optionText).toMatch(/Fachada minimalista/)
    expect(optionText).not.toMatch(/Cálido contemporáneo/)
    expect(optionText).not.toMatch(/Minimalista nórdico/)
  })

  it('modo plano: el selector de preset solo ofrece los de kind="plan"', () => {
    setup({
      source: 'plan', variant: 'original', plan: planWithRooms(['Sala']),
      onGeneratePlan: vi.fn(), prompts: [...prompts, ...planPrompts],
    })
    const select = screen.getByLabelText(/preset/i) as HTMLSelectElement
    const optionText = Array.from(select.options).map(o => o.textContent).join(' | ')
    expect(optionText).toMatch(/Cálido contemporáneo/)
    expect(optionText).toMatch(/Minimalista nórdico/)
    expect(optionText).not.toMatch(/Jardín regional/)
    expect(optionText).not.toMatch(/Fachada minimalista/)
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

  it('modo plano: el prompt nace sembrado desde los cuartos, sin elegir nada', () => {
    setup({ source: 'plan', variant: 'original', plan: planWithRooms(['Cocina', 'Recámara']), onGeneratePlan: vi.fn() })
    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    expect(ta.value).toMatch(/Cocina/)
    expect(ta.value).toMatch(/Recámara/)
  })

  it('modo plano: genera desde el plano directo — la fuente está elegida de fábrica', async () => {
    const onGeneratePlan = vi.fn().mockResolvedValue(planRenderRow(2))
    setup({ source: 'plan', variant: 'original', plan: planWithRooms(['Sala']), onGeneratePlan })
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))
    await waitFor(() => expect(onGeneratePlan).toHaveBeenCalled())
  })

  // ── Componer plano + preset, nunca pisarse (Task 33d) ───────────────────────
  // El bug: `choosePreset` hacía `setText(p?.body ?? '')` (reemplazo total) y
  // `selectPlan` solo agregaba `planFacts` si el texto estaba VACÍO. Elegir las
  // dos fuentes en cualquier orden borraba una de las dos mitades del prompt —
  // la geometría (Tasks 33a-c) o el estilo — dependiendo de cuál se eligiera
  // último. Ahora ambas COMPONEN: los datos duros del piso siempre van antes
  // del texto de estilo (ver el docstring de `planFacts`, "listo para
  // anteponerse al prompt de estilo").

  it('modo plano: elegir un preset conserva los datos duros ya sembrados', () => {
    setup({
      source: 'plan', variant: 'original', plan: planWithRooms(['Cocina']),
      onGeneratePlan: vi.fn(), prompts: planPrompts,
    })
    fireEvent.change(screen.getByLabelText(/preset/i), { target: { value: '3' } })
    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    expect(ta.value).toMatch(/Cocina/)
    expect(ta.value).toMatch(/Piso de madera, tonos cálidos\./)
  })

  it('modo plano: ya no hay tira de Fuente — el plano es la única y está siempre elegida', () => {
    // 2026-08-25: exigir el click en la única fuente posible (autogenerada)
    // dejaba GENERAR/SUBIR muertos sin razón visible.
    setup({
      source: 'plan', variant: 'original', plan: planWithRooms(['Cocina']),
      onGeneratePlan: vi.fn(), prompts: planPrompts,
    })
    expect(screen.queryByText(/^el plano$/i)).toBeNull()
    expect(screen.queryByText('Fuente')).toBeNull()
    expect(screen.getByRole('button', { name: /GENERAR RENDER/i }).hasAttribute('disabled')).toBe(false)
  })

  it('modo plano: los datos duros del piso van ANTES del texto de estilo, no después', () => {
    setup({
      source: 'plan', variant: 'original', plan: planWithRooms(['Cocina']),
      onGeneratePlan: vi.fn(), prompts: planPrompts,
    })
    fireEvent.change(screen.getByLabelText(/preset/i), { target: { value: '3' } })
    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    expect(ta.value.indexOf('Cocina')).toBeLessThan(ta.value.indexOf('Piso de madera'))
  })

  it('modo plano: componer con preset no duplica los datos duros', () => {
    setup({
      source: 'plan', variant: 'original', plan: planWithRooms(['Cocina']),
      onGeneratePlan: vi.fn(), prompts: planPrompts,
    })
    fireEvent.change(screen.getByLabelText(/preset/i), { target: { value: '3' } })
    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    expect(ta.value.match(/Cocina/g)?.length ?? 0).toBe(1)
  })

  it('modo plano: cambiar de preset tras componer conserva los datos duros y solo reemplaza el estilo', () => {
    setup({
      source: 'plan', variant: 'original', plan: planWithRooms(['Cocina']),
      onGeneratePlan: vi.fn(), prompts: planPrompts,
    })
    fireEvent.change(screen.getByLabelText(/preset/i), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/preset/i), { target: { value: '4' } })
    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    expect(ta.value).toMatch(/Cocina/)
    expect(ta.value).toMatch(/Blancos y madera clara\./)
    expect(ta.value).not.toMatch(/Piso de madera, tonos cálidos\./)
  })

  it('modo plano: generar con plano+preset compuestos sin editar manda el promptId del preset', async () => {
    const onGeneratePlan = vi.fn().mockResolvedValue(planRenderRow(9))
    setup({
      source: 'plan', variant: 'original', plan: planWithRooms(['Cocina']),
      onGeneratePlan, prompts: planPrompts,
    })
    fireEvent.change(screen.getByLabelText(/preset/i), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))
    await waitFor(() => expect(onGeneratePlan).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: 3 }),
    ))
  })

  it('modo plano: editar a mano el texto ya compuesto lo desliga del preset al generar', async () => {
    const onGeneratePlan = vi.fn().mockResolvedValue(planRenderRow(9))
    setup({
      source: 'plan', variant: 'original', plan: planWithRooms(['Cocina']),
      onGeneratePlan, prompts: planPrompts,
    })
    fireEvent.change(screen.getByLabelText(/preset/i), { target: { value: '3' } })
    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: `${ta.value} y techo alto.` } })
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))
    await waitFor(() => expect(onGeneratePlan).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: null }),
    ))
  })

  // ── Piso (Task 30): RENDERS filtra y genera por el piso SELECCIONADO ────────
  // El selector de piso vive en `LevantamientoPanel`, no aquí — este panel solo
  // recibe `floorId`/`floorName`/`floorCount` del piso elegido, así que "elegir
  // otro piso" se prueba montando otra instancia con otro `floorId`, igual que
  // ya se prueba `variant` arriba.

  it('modo plano: el piso seleccionado filtra la lista — solo sus propios renders', () => {
    const renders = [
      planRenderRow(1, 'original', { id: 'floor-a', name: 'Planta Baja' }),
      planRenderRow(2, 'original', { id: 'floor-b', name: 'Planta Alta' }),
    ]
    setup({
      source: 'plan', variant: 'original', renders,
      floorId: 'floor-a', floorName: 'Planta Baja', floorCount: 2,
    })
    expect(screen.getByAltText('Render 1')).not.toBeNull()
    expect(screen.queryByAltText('Render 2')).toBeNull()
  })

  it('modo plano: otra instancia con el OTRO piso seleccionado lista los renders de ESE piso', () => {
    const renders = [
      planRenderRow(1, 'original', { id: 'floor-a', name: 'Planta Baja' }),
      planRenderRow(2, 'original', { id: 'floor-b', name: 'Planta Alta' }),
    ]
    setup({
      source: 'plan', variant: 'original', renders,
      floorId: 'floor-b', floorName: 'Planta Alta', floorCount: 2,
    })
    expect(screen.getByAltText('Render 2')).not.toBeNull()
    expect(screen.queryByAltText('Render 1')).toBeNull()
  })

  it('modo plano: generar manda el id/nombre del piso SELECCIONADO al backend', async () => {
    const onGeneratePlan = vi.fn().mockResolvedValue(
      planRenderRow(9, 'original', { id: 'floor-a', name: 'Planta Baja' }),
    )
    setup({
      source: 'plan', variant: 'original', plan: planWithRooms(['Sala']), onGeneratePlan,
      floorId: 'floor-a', floorName: 'Planta Baja', floorCount: 2,
    })
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))
    await waitFor(() => expect(onGeneratePlan).toHaveBeenCalledWith(
      expect.objectContaining({ floorId: 'floor-a', floorName: 'Planta Baja' }),
    ))
  })

  it('modo plano, 1 solo piso: un render con floorId NULL (legado) se ve bajo ese piso, sin sección aparte', () => {
    setup({
      source: 'plan', variant: 'original',
      renders: [planRenderRow(1, 'original', { id: null, name: null })],
      floorId: 'floor-a', floorName: 'Planta Baja', floorCount: 1,
    })
    expect(screen.getByAltText('Render 1')).not.toBeNull()
    expect(screen.queryByText(/sin piso identificado/i)).toBeNull()
  })

  it('modo plano, 2+ pisos: los renders con floorId NULL van a "Sin piso identificado", aparte de cualquier piso', () => {
    const renders = [
      planRenderRow(1, 'original', { id: 'floor-a', name: 'Planta Baja' }),  // del piso seleccionado
      planRenderRow(2, 'original', { id: null, name: null }),                 // legado, sin piso
      planRenderRow(3, 'original', { id: null, name: null }),                 // legado, sin piso
    ]
    setup({
      source: 'plan', variant: 'original', renders,
      floorId: 'floor-a', floorName: 'Planta Baja', floorCount: 2,
    })

    expect(screen.getByText('Renders (1)')).not.toBeNull()
    expect(screen.getByText('Sin piso identificado (2)')).not.toBeNull()
    expect(screen.getByAltText('Render 1')).not.toBeNull()
    expect(screen.getByAltText('Render 2')).not.toBeNull()
    expect(screen.getByAltText('Render 3')).not.toBeNull()
  })

  it('modo plano, 2+ pisos: un render del OTRO piso no aparece ni en la lista propia ni en "Sin piso identificado"', () => {
    const renders = [
      planRenderRow(1, 'original', { id: 'floor-a', name: 'Planta Baja' }),
      planRenderRow(2, 'original', { id: 'floor-b', name: 'Planta Alta' }),
    ]
    setup({
      source: 'plan', variant: 'original', renders,
      floorId: 'floor-a', floorName: 'Planta Baja', floorCount: 2,
    })
    expect(screen.getByText('Renders (1)')).not.toBeNull()
    expect(screen.getByText('Sin piso identificado (0)')).not.toBeNull()
    expect(screen.queryByAltText('Render 2')).toBeNull()
  })

  it('modo plano, 2+ pisos: sin renders legado, "Sin piso identificado" se muestra en 0 — nunca se esconde', () => {
    setup({
      source: 'plan', variant: 'original',
      renders: [planRenderRow(1, 'original', { id: 'floor-a', name: 'Planta Baja' })],
      floorId: 'floor-a', floorName: 'Planta Baja', floorCount: 2,
    })
    expect(screen.getByText('Sin piso identificado (0)')).not.toBeNull()
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

  it('la estrella vacía llama a onChoose con el id del render', async () => {
    const onChoose = vi.fn().mockResolvedValue(undefined)
    setup({ renders: [renderRow(1)], onChoose, onUnchoose: vi.fn().mockResolvedValue(undefined) })
    fireEvent.click(screen.getByRole('button', { name: 'Elegir este render' }))
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith(1))
  })

  it('la estrella llena llama a onUnchoose', async () => {
    const onUnchoose = vi.fn().mockResolvedValue(undefined)
    setup({ renders: [{ ...renderRow(1), isChosen: true }], onChoose: vi.fn().mockResolvedValue(undefined), onUnchoose })
    fireEvent.click(screen.getByRole('button', { name: 'Quitar como elegido' }))
    await waitFor(() => expect(onUnchoose).toHaveBeenCalledWith(1))
  })

  it('un render sin piso ni foto no muestra el botón de elegir', () => {
    setup({ renders: [{ ...renderRow(1), sourceImageId: null }], onChoose: vi.fn(), onUnchoose: vi.fn() })
    expect(screen.queryByRole('button', { name: 'Elegir este render' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Quitar como elegido' })).toBeNull()
  })
})

describe('RendersPanel: subir un render sin generarlo', () => {
  function uploadInput(container: HTMLElement) {
    return container.querySelector('input[type="file"]') as HTMLInputElement
  }

  it('modo fotos: llama a onUpload con la foto seleccionada y el archivo', async () => {
    const onUpload = vi.fn().mockResolvedValue(renderRow(5))
    const { container } = render(<RendersPanel
      source="photos" images={[photo(10, 'fachada.jpg')]} prompts={prompts} renders={[]} base=""
      onGenerate={vi.fn()} onUpload={onUpload} onSavePrompt={vi.fn()} onDeleteRender={vi.fn()}
      onChoose={vi.fn()} onUnchoose={vi.fn()} />)

    fireEvent.click(screen.getByAltText('fachada.jpg'))
    const file = new File(['x'], 'externo.png', { type: 'image/png' })
    fireEvent.change(uploadInput(container), { target: { files: [file] } })

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith({ sourceImageId: 10, file }))
  })

  it('modo fotos con 2+ fotos: sin foto elegida, subir está deshabilitado Y SE VE deshabilitado', () => {
    render(<RendersPanel
      source="photos" images={[photo(10, 'fachada.jpg'), photo(11, 'jardin.jpg')]}
      prompts={prompts} renders={[]} base=""
      onGenerate={vi.fn()} onUpload={vi.fn()} onSavePrompt={vi.fn()} onDeleteRender={vi.fn()}
      onChoose={vi.fn()} onUnchoose={vi.fn()} />)
    const subir = screen.getByRole('button', { name: /SUBIR RENDER/i })
    expect(subir.hasAttribute('disabled')).toBe(true)
    // Incidente 2026-08-25: deshabilitado pero pintado idéntico al habilitado
    // se vive como «le pico y no pasa nada». El atenuado es parte del contrato.
    expect(subir.style.opacity).toBe('0.45')
    expect(subir.style.cursor).toBe('default')
    // Y la nota de qué falta menciona subir, no solo generar.
    expect(screen.getByText('Elige una fuente arriba para generar o subir.')).toBeTruthy()
  })

  it('modo fotos con UNA sola foto: se auto-elige y subir nace habilitado', () => {
    // 2026-08-25: con una sola fuente no hay nada que decidir — exigir el
    // click dejaba el botón muerto sin razón.
    render(<RendersPanel
      source="photos" images={[photo(10, 'fachada.jpg')]} prompts={prompts} renders={[]} base=""
      onGenerate={vi.fn()} onUpload={vi.fn()} onSavePrompt={vi.fn()} onDeleteRender={vi.fn()}
      onChoose={vi.fn()} onUnchoose={vi.fn()} />)
    const subir = screen.getByRole('button', { name: /SUBIR RENDER/i })
    expect(subir.hasAttribute('disabled')).toBe(false)
    expect(subir.style.opacity).toBe('1')
    expect(screen.queryByText(/elige una fuente/i)).toBeNull()
  })

  it('sin onUpload, no se muestra el botón de subir', () => {
    render(<RendersPanel
      source="photos" images={[photo(10, 'fachada.jpg')]} prompts={prompts} renders={[]} base=""
      onGenerate={vi.fn()} onSavePrompt={vi.fn()} onDeleteRender={vi.fn()}
      onChoose={vi.fn()} onUnchoose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /SUBIR RENDER/i })).toBeNull()
  })

  it('modo plano: llama a onUploadPlan con el piso seleccionado y el archivo', async () => {
    const onUploadPlan = vi.fn().mockResolvedValue(planRenderRow(5))
    const cocina = planWithRooms(['Cocina'])
    const { container } = render(<RendersPanel {...planBase}
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={1}
      onGeneratePlan={vi.fn()} onUploadPlan={onUploadPlan} />)

    const file = new File(['x'], 'externo.png', { type: 'image/png' })
    fireEvent.change(uploadInput(container), { target: { files: [file] } })

    await waitFor(() => expect(onUploadPlan).toHaveBeenCalledWith({
      floorId: cocina.id, floorName: cocina.name, file,
    }))
  })
})

// ── El piso cambia sin remontar (addendum de fidelidad geométrica) ─────────────
// `LevantamientoPanel` nunca remonta este panel al cambiar de piso — no hay `key`
// por piso, solo cambia la prop `plan` (y `floorId`/`floorName` junto con ella).
// `text`/`usePlan` viven DENTRO de `RendersPanel`, así que sin sincronización se
// quedan describiendo el piso VIEJO. Dos síntomas reales:
//   1. Duplicación: re-elegir "El plano" tras cambiar de piso comparaba el guard
//      de idempotencia de `selectPlan` (`text.startsWith(facts)`) contra los
//      hechos del piso NUEVO, que nunca calzan con el prefijo viejo — así que
//      antepone sin quitar, y el texto mezcla los cuartos de los DOS pisos.
//   2. Datos obsoletos: generar sin volver a hacer clic en "El plano" manda el
//      PNG del piso nuevo (vía `plan`) con una descripción de texto del piso
//      VIEJO — imagen y prompt describiendo dos pisos distintos.
// Cada test usa `rerender` (nunca una nueva instancia de `render`) para simular
// el cambio de piso real: la misma técnica que ya usa
// `LevantamientoPanel.test.tsx` para probar el reset del resumen de lote.
describe('RendersPanel: el piso cambia sin remontar (sincroniza, nunca duplica, nunca deja obsoleto)', () => {
  it('generar tras cambiar de piso NO manda datos del piso viejo', async () => {
    const cocina = planWithRooms(['Cocina'])
    const recamara = planWithRooms(['Recámara'])
    const onGeneratePlan = vi.fn().mockResolvedValue(planRenderRow(9))
    const { rerender } = render(<RendersPanel {...planBase}
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={2} onGeneratePlan={onGeneratePlan} />)

    // Cambia de piso — la misma prop `plan`, sin remontar (RendersPanel no tiene
    // `key` por piso en `LevantamientoPanel`).
    rerender(<RendersPanel {...planBase}
      plan={recamara} floorId={recamara.id} floorName={recamara.name} floorCount={2} onGeneratePlan={onGeneratePlan} />)

    // Sin volver a tocar "El plano": genera directo.
    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))
    await waitFor(() => expect(onGeneratePlan).toHaveBeenCalled())
    const promptText = onGeneratePlan.mock.calls[0][0].promptText as string
    expect(promptText).toMatch(/Recámara/)
    expect(promptText).not.toMatch(/Cocina/)
  })

  it('cambiar de piso no mezcla los cuartos de los dos pisos (no duplica)', () => {
    const cocina = planWithRooms(['Cocina'])
    const recamara = planWithRooms(['Recámara'])
    const { rerender } = render(<RendersPanel {...planBase}
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={2} onGeneratePlan={vi.fn()} />)

    rerender(<RendersPanel {...planBase}
      plan={recamara} floorId={recamara.id} floorName={recamara.name} floorCount={2} onGeneratePlan={vi.fn()} />)

    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    expect(ta.value).toMatch(/Recámara/)
    expect(ta.value).not.toMatch(/Cocina/)
  })

  it('cambiar de piso por sí solo ya actualiza el texto al piso nuevo', () => {
    // El síntoma 2, visto desde el textarea: ni siquiera hace falta re-generar
    // para notar el dato obsoleto — el texto mismo debe reflejar el piso actual.
    const cocina = planWithRooms(['Cocina'])
    const recamara = planWithRooms(['Recámara'])
    const { rerender } = render(<RendersPanel {...planBase}
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={2} onGeneratePlan={vi.fn()} />)

    rerender(<RendersPanel {...planBase}
      plan={recamara} floorId={recamara.id} floorName={recamara.name} floorCount={2} onGeneratePlan={vi.fn()} />)

    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    expect(ta.value).toMatch(/Recámara/)
    expect(ta.value).not.toMatch(/Cocina/)
  })

  it('una edición manual del texto sobrevive a un cambio de piso — nunca se pisa en silencio', () => {
    // Decisión de UX: si el usuario ya rompió la composición a mano, sincronizar
    // de todos modos arriesgaría perder su edición sin avisar. Se prefiere
    // dejarlo con datos potencialmente obsoletos (visibles, los escribió él) a
    // pisarlos.
    const cocina = planWithRooms(['Cocina'])
    const recamara = planWithRooms(['Recámara'])
    const { rerender } = render(<RendersPanel {...planBase}
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={2} onGeneratePlan={vi.fn()} />)

    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'Texto totalmente reescrito a mano, sin relación con los hechos.' } })

    rerender(<RendersPanel {...planBase}
      plan={recamara} floorId={recamara.id} floorName={recamara.name} floorCount={2} onGeneratePlan={vi.fn()} />)

    expect((screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement).value)
      .toBe('Texto totalmente reescrito a mano, sin relación con los hechos.')
  })

  it('el plano nace sembrado sin ningún click, y cambiar de piso no duplica los hechos', () => {
    // 2026-08-25: "El plano" ya no se elige — es la única fuente posible y
    // está elegida siempre. El texto nace con los hechos del piso montado, y
    // el cambio de piso los REEMPLAZA (nunca los apila).
    const cocina = planWithRooms(['Cocina'])
    const recamara = planWithRooms(['Recámara'])
    const { rerender } = render(<RendersPanel {...planBase}
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={2} onGeneratePlan={vi.fn()} />)
    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    expect(ta.value).toMatch(/Cocina/)
    rerender(<RendersPanel {...planBase}
      plan={recamara} floorId={recamara.id} floorName={recamara.name} floorCount={2} onGeneratePlan={vi.fn()} />)
    expect(ta.value).toMatch(/Recámara/)
    expect(ta.value).not.toMatch(/Cocina/)
    expect(ta.value.match(/Cuartos:/g)?.length ?? 0).toBe(1)
  })

  it('un preset elegido sigue vinculado (promptId no nulo) tras cambiar de piso', async () => {
    // Beneficio directo del reemplazo quirúrgico de `replaceFacts`: solo la mitad
    // de hechos se toca, la mitad de estilo (y por tanto el preset) sigue intacta.
    const cocina = planWithRooms(['Cocina'])
    const recamara = planWithRooms(['Recámara'])
    const onGeneratePlan = vi.fn().mockResolvedValue(planRenderRow(9))
    const { rerender } = render(<RendersPanel {...planBase}
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={2} onGeneratePlan={onGeneratePlan} />)
    fireEvent.change(screen.getByLabelText(/preset/i), { target: { value: '3' } })

    rerender(<RendersPanel {...planBase}
      plan={recamara} floorId={recamara.id} floorName={recamara.name} floorCount={2} onGeneratePlan={onGeneratePlan} />)

    fireEvent.click(screen.getByRole('button', { name: /GENERAR RENDER/i }))
    await waitFor(() => expect(onGeneratePlan).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: 3 }),
    ))
  })

  it('un `plan` con el mismo id pero nueva referencia de objeto no dispara un reemplazo espurio', () => {
    // El escenario real que motiva comparar por `.id` y no por referencia:
    // `LevantamientoPanel` reconstruye `selectedFloor` en cada render (un `.find`
    // sobre `fs.floors`), así que la referencia cambia aunque el piso no.
    const cocina = planWithRooms(['Cocina'])
    const cocinaOtraReferencia = { ...cocina, rooms: [...cocina.rooms] }
    const { rerender } = render(<RendersPanel {...planBase}
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={2} onGeneratePlan={vi.fn()} />)
    const textoAntes = (screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement).value

    rerender(<RendersPanel {...planBase}
      plan={cocinaOtraReferencia} floorId={cocinaOtraReferencia.id} floorName={cocinaOtraReferencia.name}
      floorCount={2} onGeneratePlan={vi.fn()} />)

    expect((screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement).value).toBe(textoAntes)
  })
})

// ── Aviso: el texto editado a mano ya no refleja el piso actual ────────────────
// El sync deliberadamente NO toca el texto cuando el usuario lo editó a mano
// (rompiendo el prefijo de hechos) — correcto, para no pisar su edición. Pero eso
// deja el texto describiendo el piso VIEJO sin ninguna señal visual de que ya no
// coincide con el piso/PNG que se va a mandar al generar. Mismo criterio del
// addendum de fidelidad geométrica (docs/plans/2026-08-13-fidelidad-geometrica-
// renders-plano.md): el resultado nunca debe mentir sobre la distribución real,
// y un texto obsoleto y silencioso es exactamente ese tipo de mentira.
describe('RendersPanel: avisa cuando el texto ya no refleja el piso actual', () => {
  it('aparece cuando una edición manual rompe el prefijo de hechos y luego cambia de piso', () => {
    const cocina = planWithRooms(['Cocina'])
    const recamara = planWithRooms(['Recámara'])
    const { rerender } = render(<RendersPanel {...planBase}
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={2} onGeneratePlan={vi.fn()} />)

    const ta = screen.getByLabelText(/texto del prompt/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'Texto totalmente reescrito a mano, sin relación con los hechos.' } })

    rerender(<RendersPanel {...planBase}
      plan={recamara} floorId={recamara.id} floorName={recamara.name} floorCount={2} onGeneratePlan={vi.fn()} />)

    expect(screen.getByText(/el texto no refleja el piso actual/i)).not.toBeNull()
  })

  it('NO aparece cuando el texto sigue sincronizado con el piso actual (sin edición manual)', () => {
    const cocina = planWithRooms(['Cocina'])
    const recamara = planWithRooms(['Recámara'])
    const { rerender } = render(<RendersPanel {...planBase}
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={2} onGeneratePlan={vi.fn()} />)

    rerender(<RendersPanel {...planBase}
      plan={recamara} floorId={recamara.id} floorName={recamara.name} floorCount={2} onGeneratePlan={vi.fn()} />)

    expect(screen.queryByText(/el texto no refleja el piso actual/i)).toBeNull()
  })

  it('NO aparece con usePlan=false, aunque el texto se edite a mano (modo fotos)', () => {
    setup()
    fireEvent.change(screen.getByLabelText(/texto del prompt/i), { target: { value: 'Cualquier cosa.' } })
    expect(screen.queryByText(/el texto no refleja el piso actual/i)).toBeNull()
  })
})

describe('RendersPanel: scoping por PLAN — dos planes comparten floor ids a propósito', () => {
  it('el panel de un plan NUNCA enseña los renders de otro plan del mismo piso', () => {
    // Plan A y Plan B nacieron de PARTIR: el piso comparte id. El único
    // discriminante es la variante (= el plan id) — floorId solo mezclaría.
    const cocina = planWithRooms(['Cocina'])
    render(<RendersPanel {...planBase} variant="plan-a"
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={1}
      onGeneratePlan={vi.fn()}
      renders={[
        planRenderRow(1, 'plan-a', { id: cocina.id, name: 'PB' }),
        planRenderRow(2, 'plan-b', { id: cocina.id, name: 'PB' }),
      ]} />)
    expect(screen.getByText('Renders (1)')).toBeTruthy()
  })

  it('la sección "Sin piso identificado" también es por plan', () => {
    const cocina = planWithRooms(['Cocina'])
    const dosPisos = 2
    render(<RendersPanel {...planBase} variant="plan-a"
      plan={cocina} floorId={cocina.id} floorName={cocina.name} floorCount={dosPisos}
      onGeneratePlan={vi.fn()}
      renders={[
        planRenderRow(1, 'plan-a', { id: null, name: null }),
        planRenderRow(2, 'plan-b', { id: null, name: null }),
      ]} />)
    expect(screen.getByText('Sin piso identificado (1)')).toBeTruthy()
  })
})
