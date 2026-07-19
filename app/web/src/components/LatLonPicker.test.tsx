import { render, screen, fireEvent } from '@testing-library/react'
import { LatLonPicker } from './LatLonPicker'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
  CircleMarker: () => null,
  useMapEvents: () => null,
}))

describe('LatLonPicker', () => {
  it('renders lat and lon inputs with initial values', () => {
    render(<LatLonPicker lat={25.6866} lon={-100.3161} onChange={vi.fn()} />)
    expect(screen.getByDisplayValue('25.6866')).not.toBeNull()
    expect(screen.getByDisplayValue('-100.3161')).not.toBeNull()
  })

  it('calls onChange with updated lat when latitud input changes', () => {
    const onChange = vi.fn()
    render(<LatLonPicker lat={25.6866} lon={-100.3161} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('25.6866'), { target: { value: '25.7' } })
    expect(onChange).toHaveBeenCalledWith(25.7, -100.3161)
  })

  it('calls onChange with updated lon when longitud input changes', () => {
    const onChange = vi.fn()
    render(<LatLonPicker lat={25.6866} lon={-100.3161} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('-100.3161'), { target: { value: '-100.5' } })
    expect(onChange).toHaveBeenCalledWith(25.6866, -100.5)
  })

  it('map is hidden by default', () => {
    render(<LatLonPicker lat={25.6866} lon={-100.3161} onChange={vi.fn()} />)
    expect(screen.queryByTestId('map-container')).toBeNull()
  })

  it('shows map after clicking ABRIR MAPA', () => {
    render(<LatLonPicker lat={25.6866} lon={-100.3161} onChange={vi.fn()} />)
    fireEvent.click(screen.getByText(/ABRIR MAPA/))
    expect(screen.queryByTestId('map-container')).not.toBeNull()
  })

  it('hides map after toggling CERRAR MAPA', () => {
    render(<LatLonPicker lat={25.6866} lon={-100.3161} onChange={vi.fn()} />)
    fireEvent.click(screen.getByText(/ABRIR MAPA/))
    fireEvent.click(screen.getByText(/CERRAR MAPA/))
    expect(screen.queryByTestId('map-container')).toBeNull()
  })

  it('shows empty input when lat is 0', () => {
    render(<LatLonPicker lat={0} lon={0} onChange={vi.fn()} />)
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs[0].getAttribute('value')).toBe('')
    expect(inputs[1].getAttribute('value')).toBe('')
  })
})
