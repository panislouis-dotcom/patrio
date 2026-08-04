import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { BudgetItemSuggestion } from '../../lib/types'
import { DedupeNameCell, DEBOUNCE_MS } from './DedupeNameCell'
import * as api from '../../lib/api'

vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, suggestBudgetItems: vi.fn() }
})

const suggestion = (over: Partial<BudgetItemSuggestion>): BudgetItemSuggestion => ({
  source: 'catalog', itemId: 1, chapterId: 1, chapterName: 'Acabados',
  name: 'Piso cerámico 60×60', unit: 'm²', similarity: 0.6, usedInLines: 4, ...over,
})

/**
 * La celda es controlada, como en la tabla: quien la usa es el dueño del texto.
 * El arnés hace ese papel para que teclear se parezca a teclear.
 */
function Harness(props: {
  linked?: boolean
  onAdopt?: (s: BudgetItemSuggestion) => void
  onBlur?: () => void
}) {
  const [value, setValue] = useState('')
  return (
    <DedupeNameCell
      value={value}
      ariaLabel="Partida"
      style={{}}
      linked={props.linked ?? false}
      onChange={setValue}
      onBlur={props.onBlur ?? (() => {})}
      onAdopt={props.onAdopt ?? (() => {})}
    />
  )
}

const teclear = (texto: string) =>
  fireEvent.change(screen.getByLabelText('Partida'), { target: { value: texto } })

/** Esperar a que el debounce venza sin que pase nada, para poder afirmar el nada. */
const dejarPasarElDebounce = () =>
  new Promise(resolve => setTimeout(resolve, DEBOUNCE_MS + 60))

describe('DedupeNameCell', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('pregunta si la partida que se escribe ya existe en el catálogo', async () => {
    // Sin esto, en seis obras hay «Piso cerámico», «Colocación piso cerámico» y
    // «Piso ceramico 60x60» como tres partidas distintas, cada una con una sola
    // observación de precio. El catálogo no se ve roto: simplemente nunca
    // aprende nada.
    vi.mocked(api.suggestBudgetItems).mockResolvedValue([suggestion({})])
    render(<Harness />)

    teclear('Piso ceramico')

    // El CAPÍTULO va en la frase, y es la mitad de la información: el duplicado
    // suele estar tecleado bajo otro capítulo, que es el caso que justifica todo
    // esto. Sin decirlo, aceptar la sugerencia sería a ciegas.
    expect(await screen.findByText(/¿Es la misma que «Piso cerámico 60×60» \(Acabados\) del catálogo\?/))
      .not.toBeNull()
  })

  it('el capítulo del candidato se dice, aunque sea otro que el del renglón', async () => {
    // «Piso cerámico» en Acabados contra «Colocación piso cerámico» en
    // Albañilería es exactamente el duplicado que hay que poder ver.
    vi.mocked(api.suggestBudgetItems).mockResolvedValue([
      suggestion({ chapterName: 'Albañilería', name: 'Colocación piso cerámico' }),
    ])
    render(<Harness />)

    teclear('Piso ceramico')

    expect(await screen.findByText(/«Colocación piso cerámico» \(Albañilería\)/)).not.toBeNull()
  })

  it('SUGIERE y no bloquea: el renglón se guarda con el aviso en pantalla', async () => {
    // Es la regla de la que dependen todas las demás. Si el sistema estorba, se
    // captura basura o se deja de capturar, y las dos son peores que un
    // duplicado.
    const onBlur = vi.fn()
    vi.mocked(api.suggestBudgetItems).mockResolvedValue([suggestion({})])
    render(<Harness onBlur={onBlur} />)

    teclear('Piso ceramico')
    await screen.findByRole('status')

    fireEvent.blur(screen.getByLabelText('Partida'))

    // El guardado ocurre igual, sin contestar nada
    expect(onBlur).toHaveBeenCalledTimes(1)
    // Y el aviso sigue ahí: si se cerrara al perder el foco, sus botones serían
    // inalcanzables — hacer clic en uno desenfoca la caja primero.
    expect(screen.getByRole('status')).not.toBeNull()
  })

  it('usar la del catálogo copia el texto y la procedencia, y ningún importe', async () => {
    const onAdopt = vi.fn()
    vi.mocked(api.suggestBudgetItems).mockResolvedValue([suggestion({ itemId: 42 })])
    render(<Harness onAdopt={onAdopt} />)

    teclear('Piso ceramico')
    fireEvent.click(await screen.findByText('USAR LA DEL CATÁLOGO'))

    expect(onAdopt).toHaveBeenCalledTimes(1)
    const adoptada = onAdopt.mock.calls[0][0] as BudgetItemSuggestion
    expect(adoptada.itemId).toBe(42)
    expect(adoptada.name).toBe('Piso cerámico 60×60')
    expect(adoptada.unit).toBe('m²')
  })

  it('adoptar un renglón suelto junta el grupo pero no liga nada', async () => {
    // Mientras el catálogo está vacío, los renglones sueltos son la única
    // memoria que existe. Escribirlos igual es lo que hace que lleguen a la cola
    // de promoción como un grupo de cuatro y no como cuatro grupos de uno.
    const onAdopt = vi.fn()
    vi.mocked(api.suggestBudgetItems).mockResolvedValue([
      suggestion({ itemId: null, chapterId: null, source: 'lines', usedInLines: 3, name: 'Piso cerámico' }),
    ])
    render(<Harness onAdopt={onAdopt} />)

    teclear('Piso ceramico')

    expect(await screen.findByText(/«Piso cerámico» \(Acabados\) ya se escribió en 3 renglones/))
      .not.toBeNull()
    // El botón dice otra cosa porque hace otra cosa: no hay catálogo al que ligarse
    fireEvent.click(screen.getByText('USAR ESE NOMBRE'))
    expect((onAdopt.mock.calls[0][0] as BudgetItemSuggestion).itemId).toBeNull()
  })

  it('«NO, ES OTRA» baja al siguiente candidato, y al acabarse deja de preguntar', async () => {
    vi.mocked(api.suggestBudgetItems).mockResolvedValue([
      suggestion({ itemId: 1, name: 'Piso cerámico 60×60' }),
      suggestion({ itemId: 2, name: 'Piso porcelánico' }),
    ])
    render(<Harness />)

    teclear('Piso ceramico')
    await screen.findByText(/«Piso cerámico 60×60»/)

    fireEvent.click(screen.getByText('NO, ES OTRA'))
    expect(screen.getByText(/«Piso porcelánico»/)).not.toBeNull()

    fireEvent.click(screen.getByText('NO, ES OTRA'))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('un renglón que ya tiene procedencia no vuelve a preguntar nada', async () => {
    // La pregunta ya se contestó. Volver a hacerla es justo el estorbo que esta
    // pieza no se puede permitir.
    vi.mocked(api.suggestBudgetItems).mockResolvedValue([suggestion({})])
    render(<Harness linked />)

    teclear('Piso ceramico')
    await dejarPasarElDebounce()

    expect(api.suggestBudgetItems).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('no consulta con dos letras: «pi» se parece a todo', async () => {
    vi.mocked(api.suggestBudgetItems).mockResolvedValue([suggestion({})])
    render(<Harness />)

    teclear('pi')
    await dejarPasarElDebounce()

    expect(api.suggestBudgetItems).not.toHaveBeenCalled()
  })

  it('teclear una palabra es UNA consulta, no una por tecla', async () => {
    vi.mocked(api.suggestBudgetItems).mockResolvedValue([])
    render(<Harness />)

    teclear('Pis')
    teclear('Piso')
    teclear('Piso c')
    teclear('Piso cer')

    await waitFor(() => expect(api.suggestBudgetItems).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.suggestBudgetItems).mock.calls[0][0]).toBe('Piso cer')
  })

  it('si el servidor no contesta, la captura sigue exactamente igual', async () => {
    // El aviso es una ayuda. Un banner rojo porque una sugerencia no llegó sería
    // el estorbo que esta pieza existe para evitar; callarse es el modo
    // degradado correcto.
    const onBlur = vi.fn()
    vi.mocked(api.suggestBudgetItems).mockRejectedValue(new Error('502'))
    render(<Harness onBlur={onBlur} />)

    teclear('Piso ceramico')
    await waitFor(() => expect(api.suggestBudgetItems).toHaveBeenCalled())
    await dejarPasarElDebounce()

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/error/i)).toBeNull()
    fireEvent.blur(screen.getByLabelText('Partida'))
    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it('una respuesta lenta de un nombre viejo no pisa a la del nombre vigente', async () => {
    // Teclear rápido deja varias consultas en vuelo y la más lenta puede
    // contestar al final: sin descartar las viejas, el aviso preguntaría por un
    // nombre a medio escribir que ya nadie tiene en pantalla.
    const lenta = suggestion({ name: 'Lo que se escribió primero' })
    const vigente = suggestion({ name: 'Lo que se está escribiendo' })
    vi.mocked(api.suggestBudgetItems)
      .mockImplementationOnce(() => new Promise(r => setTimeout(() => r([lenta]), 200)))
      .mockResolvedValueOnce([vigente])

    render(<Harness />)
    teclear('Piso cer')
    await waitFor(() => expect(api.suggestBudgetItems).toHaveBeenCalledTimes(1))
    teclear('Piso cerámico rectificado')
    await waitFor(() => expect(api.suggestBudgetItems).toHaveBeenCalledTimes(2))

    expect(await screen.findByText(/«Lo que se está escribiendo»/)).not.toBeNull()
    await dejarPasarElDebounce()
    expect(screen.queryByText(/«Lo que se escribió primero»/)).toBeNull()
  })

  it('cuando el nombre ya es idéntico, lo dice y ofrece ligarlo', async () => {
    // No es la misma pregunta: aquí no hay nada que decidir sobre el texto, solo
    // procedencia que ganar.
    vi.mocked(api.suggestBudgetItems).mockResolvedValue([
      suggestion({ name: 'Piso cerámico 60×60', itemId: 7 }),
    ])
    render(<Harness />)

    teclear('  piso cerámico 60×60 ')

    expect(await screen.findByText('«Piso cerámico 60×60» ya está en el catálogo (Acabados).'))
      .not.toBeNull()
  })
})
