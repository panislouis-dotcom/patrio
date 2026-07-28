import { useCallback, useState } from 'react'

/**
 * Pending in-place edits over a loaded record.
 *
 * `field` uses key presence — not `??` — so an edit that clears a field to
 * `null` shows as cleared instead of falling back to the stale loaded value.
 * Reverting a field is therefore `setField(key, undefined)`, which removes the
 * key from the payload entirely.
 *
 * Only pass `null` where the endpoint accepts it: prospect PATCHes drop nulls
 * (`exclude_none`) over NOT NULL columns, so those callers must clear with
 * `setField(key, undefined)` — a `null` would read as cleared in the UI while
 * the server quietly kept the old value.
 */
export function useEdits<T extends object>(base: T | null) {
  const [edits, setEdits] = useState<Partial<T>>({})

  const field = useCallback(
    <K extends keyof T>(key: K): T[K] | undefined => (key in edits ? edits[key] : base?.[key]),
    [edits, base],
  )

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K] | undefined) => {
    setEdits(prev => {
      if (value !== undefined) return { ...prev, [key]: value }
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const clear = useCallback(() => setEdits({}), [])

  return { edits, field, setField, hasEdits: Object.keys(edits).length > 0, clear }
}
