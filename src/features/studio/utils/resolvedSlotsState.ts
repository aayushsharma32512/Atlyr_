import type { StudioProductTrayItem, StudioProductTraySlot } from "@/services/studio/studioService"

export type SlotMap = Record<StudioProductTraySlot, StudioProductTrayItem | null>

export type RequestedSlotIds = Partial<Record<StudioProductTraySlot, string | null>>

const SLOT_ORDER: StudioProductTraySlot[] = ["top", "bottom", "shoes"]

export function buildSlotMap(items: StudioProductTrayItem[]): SlotMap {
  const map: SlotMap = { top: null, bottom: null, shoes: null }
  items.forEach((item) => {
    if (item.slot === "top" || item.slot === "bottom" || item.slot === "shoes") {
      map[item.slot] = item
    }
  })
  return map
}

export function mergeSlotMaps(target: SlotMap, source: SlotMap): SlotMap {
  let changed = false
  const next: SlotMap = { ...target }
  SLOT_ORDER.forEach((slot) => {
    const incoming = source[slot]
    if (incoming && (!next[slot] || next[slot]?.productId !== incoming.productId)) {
      next[slot] = incoming
      changed = true
    }
  })
  return changed ? next : target
}

/** The slots whose requested id is not the one held. */
export function computePendingSlots(requestedSlotIds: RequestedSlotIds, resolvedSlots: SlotMap): StudioProductTraySlot[] {
  return SLOT_ORDER.filter((slot) => {
    const requestedId = requestedSlotIds[slot]
    if (!requestedId) {
      return false
    }
    const resolved = resolvedSlots[slot]
    return !resolved || resolved.productId !== requestedId
  })
}

export type FirstResolveState = { outfitId: string | null; awaiting: boolean }

/**
 * A screen has nothing correct to draw until the URL's pieces are in for the first time. After that,
 * a later miss (a rack tap, an undo) keeps the last frame and swaps one piece, so only an outfit
 * change restarts the wait.
 */
export function firstResolveState(
  prev: FirstResolveState | null,
  outfitId: string | null,
  pendingCount: number,
): FirstResolveState {
  if (prev && prev.outfitId === outfitId) {
    return prev
  }
  return { outfitId, awaiting: pendingCount > 0 }
}

export function firstResolveDone(prev: FirstResolveState): FirstResolveState {
  return prev.awaiting ? { ...prev, awaiting: false } : prev
}
