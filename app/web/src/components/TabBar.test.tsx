import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TabBar } from './TabBar'

beforeEach(() => {
  // ApiKeysSection fetches the key list on mount; hand it an empty list so the panel mounts
  // cleanly regardless of network.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
  // Y lee el token para armar el encabezado de esa petición. Mismo motivo que el `fetch`:
  // sin esto el efecto de montaje truena antes de que el panel exista, y la prueba falla
  // por un motivo que no es el que mira.
  vi.stubGlobal('localStorage', {
    getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
  })
})

describe('TabBar settings panel', () => {
  it('opens on gear click and is position:fixed so it escapes the bar\'s scroll container', () => {
    const { getByTitle, queryByTestId } = render(
      <MemoryRouter><TabBar /></MemoryRouter>)

    // Closed to start.
    expect(queryByTestId('settings-panel')).toBeNull()

    fireEvent.click(getByTitle('Configuración'))

    // The bug: an absolute-positioned panel hung below the bar was clipped by the bar's
    // overflowX:auto container and never appeared. It must render, and it must be fixed —
    // absolute would reintroduce the clip.
    const panel = queryByTestId('settings-panel')
    expect(panel).not.toBeNull()
    expect(panel!.style.position).toBe('fixed')
  })
})
