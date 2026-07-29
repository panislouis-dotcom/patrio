import { render, screen } from '@testing-library/react'
import { EditableRow } from './EditableRow'
import { StatRow } from '../StatRow'

describe('EditableRow', () => {
  it('renders the value and no input in view mode', () => {
    render(<EditableRow label="INVERSIÓN" editing={false} value="$1,000,000" input={<input aria-label="inversión" />} />)
    expect(screen.getByText('INVERSIÓN')).not.toBeNull()
    expect(screen.getByText('$1,000,000')).not.toBeNull()
    expect(screen.queryByLabelText('inversión')).toBeNull()
  })

  it('renders exactly like StatRow in view mode', () => {
    const editable = render(<EditableRow label="INVERSIÓN" editing={false} value="$1,000,000" />).container
    const stat = render(<StatRow label="INVERSIÓN" value="$1,000,000" />).container
    expect(editable.innerHTML).toBe(stat.innerHTML)
  })

  it('swaps the value for the input in edit mode', () => {
    render(<EditableRow label="INVERSIÓN" editing value="$1,000,000" input={<input aria-label="inversión" />} />)
    expect(screen.getByLabelText('inversión')).not.toBeNull()
    expect(screen.queryByText('$1,000,000')).toBeNull()
  })

  it('stays read-only in edit mode when no input is given', () => {
    const { container } = render(<EditableRow label="CAP RATE" editing value="6.2%" />)
    expect(screen.getByText('6.2%')).not.toBeNull()
    expect(container.querySelector('input')).toBeNull()
  })

  it('shows the hint beside the value', () => {
    render(<EditableRow label="CAP RATE" editing value="6.2%" hint="CALCULADA DEL DESGLOSE" />)
    expect(screen.getByText('CALCULADA DEL DESGLOSE')).not.toBeNull()
    expect(screen.getByText('6.2%')).not.toBeNull()
  })

  it('gives the input the same share of the row with and without a hint', () => {
    const plain = render(<EditableRow label="INVERSIÓN" editing value="—" input={<input aria-label="plain" />} />).container
    const hinted = render(<EditableRow label="INVERSIÓN" editing value="—" input={<input aria-label="hinted" />} hint="CAPTURA MANUAL" />).container
    const box = (c: HTMLElement) => c.querySelector('input')!.parentElement!

    expect(box(plain).style.width).toBe('55%')
    expect(box(hinted).style.width).toBe('55%')
    // Both resolve that 55% against the row itself, so the two inputs line up
    expect(box(plain).parentElement).toBe(plain.firstChild)
    expect(box(hinted).parentElement).toBe(hinted.firstChild)
  })
})
