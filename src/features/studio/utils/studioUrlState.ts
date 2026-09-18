import type { StudioProductTraySlot } from "@/services/studio/studioService"
import { isCanvasSlot, type StudioCanvasSlot } from "@/features/studio/constants/layering"

export type SlotIdMap = Partial<Record<StudioProductTraySlot, string | null>>

/** Alternates rack source. Maps to RackMode: wardrobe→yours, explore→alternates. */
export type StudioSource = "wardrobe" | "saves" | "explore"

export interface StudioUrlState {
  outfitId: string | null
  slotIds: SlotIdMap
  slot: StudioProductTraySlot | null
  productId: string | null
  share?: boolean
  hiddenSlots?: Partial<Record<StudioProductTraySlot, boolean>>
  /** Studio focus zoom. Null is the un-zoomed canvas. */
  focus?: StudioCanvasSlot | null
  source?: StudioSource | null
}

export function isStudioSource(value: string | null): value is StudioSource {
  return value === "wardrobe" || value === "saves" || value === "explore"
}

export function isStudioSlot(slot: string | null): slot is StudioProductTraySlot {
  return slot === "top" || slot === "bottom" || slot === "shoes"
}

export function parseStudioSearchParams(searchParams: URLSearchParams): StudioUrlState {
  const slotParam = searchParams.get("slot")
  const slot = slotParam && isStudioSlot(slotParam) ? slotParam : null
  const focusParam = searchParams.get("focus")
  const sourceParam = searchParams.get("source")
  return {
    focus: isCanvasSlot(focusParam) ? focusParam : null,
    source: isStudioSource(sourceParam) ? sourceParam : null,
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
  if (state.focus && isCanvasSlot(state.focus)) {
    params.set("focus", state.focus)
  }
  if (state.source && isStudioSource(state.source)) {
    params.set("source", state.source)
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

/** A piece opened from a feed: worn in its slot on the given look (else the user's last look), zoomed to it. */
export function buildStudioFocusUrl(input: {
  productId: string
  slot: StudioProductTraySlot
  returnTo?: string | null
  outfitId?: string | null
  /** Slot overrides already on that look; the target slot is replaced. */
  slotIds?: SlotIdMap
}): string {
  const params = buildStudioSearchParams({
    outfitId: input.outfitId ?? null,
    slotIds: { ...input.slotIds, [input.slot]: input.productId },
    focus: input.slot,
  })
  if (input.returnTo) {
    params.set("returnTo", encodeURIComponent(input.returnTo))
  }
  return `/studio?${params.toString()}`
}

/** outfitId and slot ids out of a remembered Studio path like "/studio/alternatives?outfitId=a&topId=b". */
export function parseStudioPath(path: string): Pick<StudioUrlState, "outfitId" | "slotIds"> {
  const query = path.split("?")[1] ?? ""
  const parsed = parseStudioSearchParams(new URLSearchParams(query))
  return { outfitId: parsed.outfitId, slotIds: parsed.slotIds }
}
