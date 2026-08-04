import { render, screen, fireEvent } from '@testing-library/react'
import { MediaTabs } from './MediaTabs'

const TABS = [
  { label: 'mapa', panel: <div>panel mapa</div> },
  { label: 'fotos', panel: <div>panel fotos</div> },
  { label: 'plano', panel: <div>panel plano</div> },
  { label: 'renders', panel: <div>panel renders</div> },
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
    fireEvent.click(screen.getByText('PLANO'))
    expect(screen.getByText('panel plano')).not.toBeNull()
    expect(screen.queryByText('panel mapa')).toBeNull()
  })

  it('dibuja tantas pestañas como le den, en el orden en que se las dieron', () => {
    // El orden lo decide quien arma la ficha. Con un prop por pestaña lo decidía
    // una constante escondida en el componente.
    render(<MediaTabs tabs={TABS} />)
    const labels = screen.getAllByRole('button').map(b => b.textContent)
    expect(labels).toEqual(['MAPA', 'FOTOS', 'PLANO', 'RENDERS', 'PRESUPUESTO'])

    fireEvent.click(screen.getByText('PRESUPUESTO'))
    expect(screen.getByText('panel presupuesto')).not.toBeNull()
  })

  it('opens RENDERS as its own tab, next to the photos', () => {
    render(<MediaTabs tabs={TABS} />)
    fireEvent.click(screen.getByText('RENDERS'))
    expect(screen.getByText('panel renders')).not.toBeNull()
    expect(screen.queryByText('panel fotos')).toBeNull()
  })
})
