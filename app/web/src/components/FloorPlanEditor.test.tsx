// app/web/src/components/FloorPlanEditor.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import FloorPlanEditor from './FloorPlanEditor'
import { colors } from '../lib/theme'

// jsdom normalizes inline hex colors it reads back through `.style` to rgb(), so compare
// against that normalized form rather than the raw hex literal from theme.ts.
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
const ACTIVE_BG = hexToRgb(colors.primary)

describe('empty-state landing screen', () => {
  it('shows the start-blank affordance for an empty initial model, then enters the editor on click', () => {
    const onSave = vi.fn()
    const { container } = render(<FloorPlanEditor onUploadImage={async () => ({ imageKey: 'test-key' })} initial={null} onSave={onSave} />)
    expect(container.querySelector('svg')).toBeNull()
    const startBlank = screen.getByText('Start blank')
    expect(startBlank).toBeTruthy()
    fireEvent.click(startBlank)
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('tool selection', () => {
  it('clicking a tool button makes it active and deactivates the previous one', () => {
    const onSave = vi.fn()
    const { container } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'test-key' })} initial={null} onSave={onSave} />,
    )
    fireEvent.click(screen.getByText('Start blank'))

    const buttons = Array.from(container.querySelectorAll('button'))
    const selectBtn = buttons.find(b => b.textContent === 'select')!
    const wallBtn = buttons.find(b => b.textContent === 'wall')!

    // btn(active) renders background: colors.primary for the active tool, 'transparent'
    // otherwise (see floorplanStyles.ts) — 'select' is the default active tool.
    expect(selectBtn.style.background).toBe(ACTIVE_BG)
    expect(wallBtn.style.background).toBe('transparent')

    fireEvent.click(wallBtn)

    // Clicking "wall" immediately creates a wall and switches the tool back to 'select'
    // (see FloorPlanEditor's onToolClick), so re-query the buttons fresh after the click.
    const buttonsAfter = Array.from(container.querySelectorAll('button'))
    const doorBtn = buttonsAfter.find(b => b.textContent === 'door')!
    expect(doorBtn.style.background).toBe('transparent')
    fireEvent.click(doorBtn)
    const buttonsAfterDoor = Array.from(container.querySelectorAll('button'))
    const doorBtnActive = buttonsAfterDoor.find(b => b.textContent === 'door')!
    const selectBtnNow = buttonsAfterDoor.find(b => b.textContent === 'select')!
    expect(doorBtnActive.style.background).toBe(ACTIVE_BG)
    expect(selectBtnNow.style.background).toBe('transparent')
  })
})

describe('undo/redo buttons', () => {
  it('are disabled when there is no history yet', () => {
    const onSave = vi.fn()
    const { container } = render(
      <FloorPlanEditor onUploadImage={async () => ({ imageKey: 'test-key' })} initial={null} onSave={onSave} />,
    )
    fireEvent.click(screen.getByText('Start blank'))
    const buttons = Array.from(container.querySelectorAll('button'))
    const undoBtn = buttons.find(b => b.textContent === 'UNDO') as HTMLButtonElement
    const redoBtn = buttons.find(b => b.textContent === 'REDO') as HTMLButtonElement
    expect(undoBtn.disabled).toBe(true)
    expect(redoBtn.disabled).toBe(true)
  })
})
