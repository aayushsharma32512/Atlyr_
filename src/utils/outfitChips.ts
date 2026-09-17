import type { Outfit } from "@/types"
import { splitTagList } from "@/utils/productTags"

export type OutfitChipSource = Pick<Outfit, "fit" | "feel" | "vibes"> | null | undefined

export function getOutfitChips(outfit: OutfitChipSource): string[] {
  if (!outfit) {
    return []
  }

  return [
    ...splitTagList(outfit.fit),
    ...splitTagList(outfit.feel),
    ...splitTagList(outfit.vibes),
  ]
}
