import { useCallback } from "react"

import { useSavedTags } from "@/features/collections/hooks/useMoodboards"

/**
 * One saved-tags lookup for every save-card host: reads the user's own
 * user_favorites.tags, keyed by kind ("piece" for a product, "look" for an
 * outfit) so both product and outfit save cards pre-select from the same row.
 */
export function useSavedTagsLookup() {
  const savedTagsQuery = useSavedTags()
  const getSavedTags = useCallback(
    (kind: "piece" | "look", id: string): string[] => {
      const bucket = kind === "piece" ? savedTagsQuery.data?.products : savedTagsQuery.data?.outfits
      return bucket?.[id] ?? []
    },
    [savedTagsQuery.data],
  )
  return { getSavedTags }
}
