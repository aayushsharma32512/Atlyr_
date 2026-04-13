import type { Outfit } from "@/types"

const INVALID_TAGS = new Set(["null", "nan"])

function splitTagList(value?: string | null): string[] {
  if (!value) {
    return []
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && !INVALID_TAGS.has(entry.toLowerCase()))
}

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
