import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { NotFound } from './NotFound'

function renderIn(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/propiedades" element={<div>tabla de propiedades</div>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NotFound', () => {
  it('dice QUÉ ruta no encontró, no solo que no encontró', () => {
    // La diferencia entre «me equivoqué al teclear» y «este enlace ya no sirve»
    // está en la ruta, y quien la lee es quien puede corregirla.
    renderIn('/obra/promover')

    expect(screen.getByText('RUTA NO ENCONTRADA')).not.toBeNull()
    expect(screen.getByText('/obra/promover')).not.toBeNull()
  })

  it('ofrece volver, y no adivina a dónde ibas', () => {
    // `App` ya decidió que no hay redirecciones desde las URLs viejas: los ids
    // cambiaron con la fusión de prospectos y proyectos, y mandar un bookmark a
    // la propiedad equivocada es peor que un 404. Un comodín que intentara
    // acertar sería esa misma apuesta con menos información.
    renderIn('/propiedades/999/algo-que-no-existe')

    fireEvent.click(screen.getByText('IR A PROPIEDADES'))
    expect(screen.getByText('tabla de propiedades')).not.toBeNull()
  })
})
