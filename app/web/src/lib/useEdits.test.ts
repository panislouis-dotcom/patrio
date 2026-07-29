import { act, renderHook } from '@testing-library/react'
import { useEdits } from './useEdits'

interface Row {
  name: string
  landPrice: number | null
}

const base: Row = { name: 'Casa Roma', landPrice: 1_000_000 }

describe('useEdits', () => {
  it('reads from base while there are no edits', () => {
    const { result } = renderHook(() => useEdits(base))
    expect(result.current.field('name')).toBe('Casa Roma')
    expect(result.current.hasEdits).toBe(false)
  })

  it('gives edits precedence over base', () => {
    const { result } = renderHook(() => useEdits(base))
    act(() => result.current.setField('name', 'Casa Condesa'))
    expect(result.current.field('name')).toBe('Casa Condesa')
    expect(result.current.edits).toEqual({ name: 'Casa Condesa' })
    expect(result.current.hasEdits).toBe(true)
  })

  // Regression: the previous `edits[key] ?? base[key]` fell back to the stale base
  // value whenever an edit cleared the field, so the UI kept showing the old
  // number even though the PATCH had already cleared it.
  it('keeps an explicit null instead of falling back to base', () => {
    const { result } = renderHook(() => useEdits(base))
    act(() => result.current.setField('landPrice', null))
    expect(result.current.field('landPrice')).toBeNull()
    expect(result.current.edits).toEqual({ landPrice: null })
    expect(result.current.hasEdits).toBe(true)
  })

  it('drops the key when set to undefined, restoring the base value', () => {
    const { result } = renderHook(() => useEdits(base))
    act(() => result.current.setField('landPrice', null))
    act(() => result.current.setField('landPrice', undefined))
    expect(result.current.field('landPrice')).toBe(1_000_000)
    expect('landPrice' in result.current.edits).toBe(false)
    expect(result.current.hasEdits).toBe(false)
  })

  it('keeps the same edits object when dropping a key that was never edited', () => {
    const { result } = renderHook(() => useEdits(base))
    const before = result.current.edits
    act(() => result.current.setField('landPrice', undefined))
    expect(result.current.edits).toBe(before)
  })

  it('clear() discards every pending edit', () => {
    const { result } = renderHook(() => useEdits(base))
    act(() => result.current.setField('name', 'Casa Condesa'))
    act(() => result.current.clear())
    expect(result.current.edits).toEqual({})
    expect(result.current.hasEdits).toBe(false)
    expect(result.current.field('name')).toBe('Casa Roma')
  })

  it('returns undefined for every field while base is null', () => {
    const { result } = renderHook(() => useEdits<Row>(null))
    expect(result.current.field('name')).toBeUndefined()
  })

  it('still serves edits made before base arrived', () => {
    const { result, rerender } = renderHook(({ b }: { b: Row | null }) => useEdits(b), {
      initialProps: { b: null as Row | null },
    })
    act(() => result.current.setField('name', 'Borrador'))
    rerender({ b: base })
    expect(result.current.field('name')).toBe('Borrador')
    expect(result.current.field('landPrice')).toBe(1_000_000)
  })
})
