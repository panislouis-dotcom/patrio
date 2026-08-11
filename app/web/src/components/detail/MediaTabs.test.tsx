import { render, screen, fireEvent } from '@testing-library/react'
import { MediaTabs } from './MediaTabs'

// El fixture refleja la barra real de la ficha (quién existe y en qué orden lo
// prueba PropertyDetailPage.test.tsx; aquí solo importa que la barra pinte lo
// que le den), incluidos los labels de dos palabras que el toUpperCase respeta.
const TABS = [
  { label: 'mapa', panel: <div>panel mapa</div> },
  { label: 'fotos', panel: <div>panel fotos</div> },
  { label: 'levantamiento original', panel: <div>panel levantamiento original</div> },
  { label: 'levantamiento planeado', panel: <div>panel levantamiento planeado</div> },
  { label: 'presupuesto', panel: <div>panel presupuesto</div> },
]

describe('MediaTabs', () => {
  it('starts on the first tab', () => {
    render(<MediaTabs tabs={TABS} />)
    expect(screen.getByText('panel mapa')).not.toBeNull()
    expect(screen.queryByText('panel fotos')).toBeNull()
  })

  it('switches to the tab that was clicked', () => {
    render(<MediaTabs tabs={TABS} />)
    fireEvent.click(screen.getByText('LEVANTAMIENTO ORIGINAL'))
    expect(screen.getByText('panel levantamiento original')).not.toBeNull()
    expect(screen.queryByText('panel mapa')).toBeNull()
  })

  it('dibuja tantas pestañas como le den, en el orden en que se las dieron', () => {
    // El orden lo decide quien arma la ficha. Con un prop por pestaña lo decidía
    // una constante escondida en el componente.
    render(<MediaTabs tabs={TABS} />)
    const labels = screen.getAllByRole('button').map(b => b.textContent)
    expect(labels).toEqual(['MAPA', 'FOTOS', 'LEVANTAMIENTO ORIGINAL', 'LEVANTAMIENTO PLANEADO', 'PRESUPUESTO'])

    fireEvent.click(screen.getByText('PRESUPUESTO'))
    expect(screen.getByText('panel presupuesto')).not.toBeNull()
  })

  it('switches between two non-default tabs, not just away from the first one', () => {
    render(<MediaTabs tabs={TABS} />)
    fireEvent.click(screen.getByText('FOTOS'))
    fireEvent.click(screen.getByText('LEVANTAMIENTO PLANEADO'))
    expect(screen.getByText('panel levantamiento planeado')).not.toBeNull()
    expect(screen.queryByText('panel fotos')).toBeNull()
  })
})
