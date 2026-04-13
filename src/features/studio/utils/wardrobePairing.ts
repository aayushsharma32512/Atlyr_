import type { StudioProductTraySlot } from "@/services/studio/studioService"

type WardrobeItem = {
  itemType?: StudioProductTraySlot | null
}

const COMPLEMENTARY_SLOTS: Record<StudioProductTraySlot, StudioProductTraySlot[]> = {
  top: ["bottom", "shoes"],
  bottom: ["top", "shoes"],
  shoes: ["top", "bottom"],
}

export function getComplementarySlots(
  slot: StudioProductTraySlot | null | undefined,
): StudioProductTraySlot[] {
  if (!slot) return []
  return COMPLEMENTARY_SLOTS[slot] ?? []
}

export function filterWardrobeItemsBySlot<T extends WardrobeItem>(
  items: T[],
  slot: StudioProductTraySlot | null | undefined,
): T[] {
  const allowedSlots = getComplementarySlots(slot)
  if (allowedSlots.length === 0) {
    return []
  }
  return items.filter((item) => item.itemType && allowedSlots.includes(item.itemType))
}
