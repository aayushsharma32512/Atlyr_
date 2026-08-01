import { useCallback, useMemo, useState } from "react"

import { TASTE_ROWS } from "@/features/profile/constants/tasteVocabularies"

/**
 * Session-local state for the taste step (canvas 6c).
 *
 * TODO(wave-3): nothing here is persisted. The handoff scopes taste to a
 * `taste_tags jsonb` column plus `taste_updated_at` on `profiles`, feeding the
 * For-you ranker as a seed weight; `preferred_categories` and `themes` already
 * exist on the table and could carry it sooner. Until one of those is wired,
 * picks live for the length of the visit and the screen's copy is careful not
 * to imply otherwise — see the footer line in TastePage.
 */
export type TastePicks = Record<string, string[]>

export function useTastePicks() {
  const [picks, setPicks] = useState<TastePicks>({})

  const toggle = useCallback((rowId: string, optionId: string) => {
    setPicks((current) => {
      const row = current[rowId] ?? []
      const next = row.includes(optionId)
        ? row.filter((id) => id !== optionId)
        : [...row, optionId]
      return { ...current, [rowId]: next }
    })
  }, [])

  const total = useMemo(
    () => Object.values(picks).reduce((sum, row) => sum + row.length, 0),
    [picks],
  )

  const rowsTouched = useMemo(
    () => TASTE_ROWS.filter((row) => (picks[row.id] ?? []).length > 0).length,
    [picks],
  )

  return { picks, toggle, total, rowsTouched }
}
