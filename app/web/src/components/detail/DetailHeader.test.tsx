import { render, screen, fireEvent } from '@testing-library/react'
import { DetailHeader } from './DetailHeader'
import { colors } from '../../lib/theme'

const base = {
  backLabel: 'PROYECTOS',
  onBack: () => {},
  title: 'Casa Roma',
  statusLabel: 'CONSTRUCCIÓN',
  statusColor: colors.primary,
  editing: false,
  onToggleEdit: () => {},
  hasChanges: false,
  saving: false,
  onSave: () => {},
  onCancel: () => {},
  onDelete: () => {},
}

describe('DetailHeader', () => {
  it('shows the title as text and toggles into edit mode', () => {
    const onToggleEdit = vi.fn()
    render(<DetailHeader {...base} onToggleEdit={onToggleEdit} />)
    expect(screen.getByText('Casa Roma')).not.toBeNull()
    fireEvent.click(screen.getByText('EDITAR'))
    expect(onToggleEdit).toHaveBeenCalled()
  })

  it('swaps the title for an input while editing', () => {
    const onChange = vi.fn()
    render(<DetailHeader {...base} editing editingTitle={{ value: 'Casa Roma', onChange }} />)
    fireEvent.change(screen.getByDisplayValue('Casa Roma'), { target: { value: 'Casa Condesa' } })
    expect(onChange).toHaveBeenCalledWith('Casa Condesa')
    expect(screen.getByText('VER')).not.toBeNull()
  })

  it('hides GUARDAR and CANCELAR until there are changes', () => {
    const onSave = vi.fn()
    const { rerender } = render(<DetailHeader {...base} onSave={onSave} />)
    expect(screen.queryByText('GUARDAR ▸')).toBeNull()
    expect(screen.queryByText('CANCELAR')).toBeNull()
    rerender(<DetailHeader {...base} onSave={onSave} hasChanges />)
    fireEvent.click(screen.getByText('GUARDAR ▸'))
    expect(onSave).toHaveBeenCalled()
    expect(screen.getByText('CANCELAR')).not.toBeNull()
  })

  it('asks for confirmation before deleting', () => {
    const onDelete = vi.fn()
    render(<DetailHeader {...base} onDelete={onDelete} />)
    fireEvent.click(screen.getByText('ELIMINAR'))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('¿CONFIRMAR BORRADO?'))
    expect(onDelete).toHaveBeenCalled()
  })

  it('drops the edit CANCELAR while confirming a delete, so the label stays unambiguous', () => {
    render(<DetailHeader {...base} hasChanges />)
    fireEvent.click(screen.getByText('ELIMINAR'))
    expect(screen.getAllByText('CANCELAR')).toHaveLength(1)
    fireEvent.click(screen.getByText('CANCELAR'))
    expect(screen.getByText('ELIMINAR')).not.toBeNull()
  })

  it('renders the actions slot', () => {
    render(<DetailHeader {...base} actions={<button>CONVERTIR ▸ PROYECTO</button>} />)
    expect(screen.getByText('CONVERTIR ▸ PROYECTO')).not.toBeNull()
  })
})
