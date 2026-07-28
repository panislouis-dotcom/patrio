import { render, screen } from '@testing-library/react'
import { MapPanel } from './MapPanel'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  CircleMarker: () => null,
}))

describe('MapPanel', () => {
  it('renders the map when both coordinates are set', () => {
    render(<MapPanel lat={25.6866} lon={-100.3161} markerColor="#6B8A5E" />)
    expect(screen.getByTestId('map-container')).not.toBeNull()
  })

  it.each([
    ['null coordinates', null, null],
    ['the 0,0 sentinel', 0, 0],
    ['a missing longitude', 25.6866, null],
  ])('shows the empty state for %s', (_case, lat, lon) => {
    render(<MapPanel lat={lat} lon={lon} markerColor="#6B8A5E" />)
    expect(screen.getByText('SIN COORDENADAS')).not.toBeNull()
    expect(screen.queryByTestId('map-container')).toBeNull()
  })
})
