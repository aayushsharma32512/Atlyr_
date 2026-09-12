import type { StudioProductTraySlot } from "@/services/studio/studioService"

/**
 * A layer is a second top-type piece worn over the top. Off until the team
 * reverses DESIGN_NOTES; the bundle gates it the same way (`altLayerOn: false`).
 */
export const LAYERING_ENABLED = false

/** The service knows three slots. The canvas adds `layer` on top of them. */
export type StudioCanvasSlot = StudioProductTraySlot | "layer"

const BASE_SLOTS: StudioCanvasSlot[] = ["top", "bottom", "shoes"]

/** Rail, row and focus-step order. */
export const CANVAS_SLOTS: StudioCanvasSlot[] = LAYERING_ENABLED
  ? [...BASE_SLOTS, "layer"]
  : BASE_SLOTS

export const CANVAS_SLOT_NAMES: Record<StudioCanvasSlot, string> = {
  top: "Top",
  bottom: "Bottom",
  shoes: "Shoes",
  layer: "Layer over top",
}

export function isCanvasSlot(value: string | null | undefined): value is StudioCanvasSlot {
  return value === "top" || value === "bottom" || value === "shoes" || value === "layer"
}

/** A layer queries the catalogue as a top, and focuses to the top's band. */
export function toTraySlot(slot: StudioCanvasSlot): StudioProductTraySlot {
  return slot === "layer" ? "top" : slot
}

/** Step to the next/previous slot, wrapping. Drives the focus sheet's swipe. */
export function stepCanvasSlot(slot: StudioCanvasSlot, delta: number): StudioCanvasSlot {
  const index = CANVAS_SLOTS.indexOf(slot)
  if (index < 0) {
    return CANVAS_SLOTS[0]
  }
  const next = (index + delta + CANVAS_SLOTS.length) % CANVAS_SLOTS.length
  return CANVAS_SLOTS[next]
}
