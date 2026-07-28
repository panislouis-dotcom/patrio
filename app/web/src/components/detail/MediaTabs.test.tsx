import { render, screen, fireEvent } from '@testing-library/react'
import { MediaTabs } from './MediaTabs'

const panels = {
  mapa: <div>panel mapa</div>,
  fotos: <div>panel fotos</div>,
  plano: <div>panel plano</div>,
}

describe('MediaTabs', () => {
  it('starts on MAPA', () => {
    render(<MediaTabs {...panels} />)
    expect(screen.getByText('panel mapa')).not.toBeNull()
    expect(screen.queryByText('panel fotos')).toBeNull()
  })

  it('switches to the tab that was clicked', () => {
    render(<MediaTabs {...panels} />)
    fireEvent.click(screen.getByText('PLANO'))
    expect(screen.getByText('panel plano')).not.toBeNull()
    expect(screen.queryByText('panel mapa')).toBeNull()
  })
})
