import type { StudioProductTraySlot } from "@/services/studio/studioService"

export type SlotIdMap = Partial<Record<StudioProductTraySlot, string | null>>

export interface StudioUrlState {
  outfitId: string | null
  slotIds: SlotIdMap
  slot: StudioProductTraySlot | null
  productId: string | null
  share?: boolean
  hiddenSlots?: Partial<Record<StudioProductTraySlot, boolean>>
}

export function isStudioSlot(slot: string | null): slot is StudioProductTraySlot {
  return slot === "top" || slot === "bottom" || slot === "shoes"
}

export function parseStudioSearchParams(searchParams: URLSearchParams): StudioUrlState {
  const slotParam = searchParams.get("slot")
  const slot = slotParam && isStudioSlot(slotParam) ? slotParam : null
  return {
    outfitId: searchParams.get("outfitId"),
    slotIds: {
      top: searchParams.get("topId"),
      bottom: searchParams.get("bottomId"),
      shoes: searchParams.get("shoesId"),
    },
    slot,
    productId: searchParams.get("productId"),
    share: searchParams.get("share") === "1",
    hiddenSlots: {
      top: searchParams.get("topHidden") === "1",
      bottom: searchParams.get("bottomHidden") === "1",
      shoes: searchParams.get("shoesHidden") === "1",
    },
  }
}

export function buildStudioSearchParams(state: Partial<StudioUrlState>): URLSearchParams {
  const params = new URLSearchParams()
  if (state.outfitId) {
    params.set("outfitId", state.outfitId)
  }
  if (state.slotIds) {
    (["top", "bottom", "shoes"] satisfies StudioProductTraySlot[]).forEach((slot) => {
      const id = state.slotIds?.[slot]
      const key = `${slot}Id`
      if (id) {
        params.set(key, id)
      }
    })
  }
  if (state.slot && isStudioSlot(state.slot)) {
    params.set("slot", state.slot)
  }
  if (state.productId) {
    params.set("productId", state.productId)
  }
  if (state.share) {
    params.set("share", "1")
  }
  if (state.hiddenSlots) {
    if (state.hiddenSlots.top) {
      params.set("topHidden", "1")
    }
    if (state.hiddenSlots.bottom) {
      params.set("bottomHidden", "1")
    }
    if (state.hiddenSlots.shoes) {
      params.set("shoesHidden", "1")
    }
  }
  return params
}

export function buildStudioUrl(
  basePath: string,
  view: "studio" | "alternatives",
  state: Partial<StudioUrlState>,
): string {
  const params = buildStudioSearchParams(state)
  const targetPath = view === "alternatives" ? `${basePath}/alternatives` : basePath
  const search = params.toString()
  return `${targetPath}${search ? `?${search}` : ""}`
}
