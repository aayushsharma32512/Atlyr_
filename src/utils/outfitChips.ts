import type { Outfit } from "@/types"
import { getOutfitTagsFromItems, splitTagList } from "@/utils/productTags"

// tags/items are optional here (not just on Outfit) so callers can pass a StudioOutfitDTO, which has no items/tags field at all.
export type OutfitChipSource =
  | (Pick<Outfit, "fit" | "feel" | "vibes"> & Partial<Pick<Outfit, "tags" | "items">>)
  | null
  | undefined

/** Stored tags win; else derive from items; only an itemless outfit falls back to the legacy fit+feel+vibes split. */
export function getOutfitChips(outfit: OutfitChipSource): string[] {
  if (!outfit) {
    return []
  }

  if (outfit.tags && outfit.tags.length > 0) {
    return outfit.tags
  }

  if (outfit.items && outfit.items.length > 0) {
    return getOutfitTagsFromItems(outfit.items)
  }

  return [
    ...splitTagList(outfit.fit),
    ...splitTagList(outfit.feel),
    ...splitTagList(outfit.vibes),
  ]
}
