import type { AvatarItemBoundsFrame, StudioRenderedZone } from "@/features/studio/types"

export type PreviewCropInsets = {
  topPercent: number
  rightPercent: number
  bottomPercent: number
  leftPercent: number
}

const EDGE_PADDING_RATIO = 0.035
const MIN_VERTICAL_SPAN = 0.42
const MAX_HORIZONTAL_ZOOM = 1.8

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * True when a bounds frame describes the given garments, and not a render that the figure has
 * already replaced. A build that finishes late reports the items it drew, so a frame carrying an id
 * that is no longer worn belongs to an earlier outfit and must be discarded.
 */
export function isBoundsFrameFor(frame: AvatarItemBoundsFrame, itemIds: string[]): boolean {
  if (!frame.items.length) return true
  return frame.items.every((bounds) => itemIds.includes(bounds.id))
}

export function getGarmentPreviewCrop(
  frame: AvatarItemBoundsFrame | null,
  itemId: string,
  category: Extract<StudioRenderedZone, "top" | "bottom">,
): PreviewCropInsets | null {
  if (!frame || frame.canvasHeight <= 0 || frame.canvasWidth <= 0) return null
  const bounds = frame.items.find((item) => item.id === itemId && item.zone === category)
  if (!bounds || bounds.height <= 0 || bounds.width <= 0) return null

  const padding = frame.canvasHeight * EDGE_PADDING_RATIO
  let start = category === "top"
    ? 0
    : clamp((bounds.top - padding) / frame.canvasHeight, 0, 1 - MIN_VERTICAL_SPAN)
  let end = category === "top"
    ? clamp((bounds.top + bounds.height + padding) / frame.canvasHeight, MIN_VERTICAL_SPAN, 1)
    : 1

  if (end - start < MIN_VERTICAL_SPAN) {
    if (category === "top") end = Math.min(1, start + MIN_VERTICAL_SPAN)
    else start = Math.max(0, end - MIN_VERTICAL_SPAN)
  }

  const span = end - start
  if (!Number.isFinite(span) || span <= 0) return null
  const verticalZoom = 1 / span
  const horizontalZoom = Math.min(verticalZoom, MAX_HORIZONTAL_ZOOM)
  const horizontalInset = -((horizontalZoom - 1) / 2) * 100

  return {
    topPercent: -(start / span) * 100,
    rightPercent: horizontalInset,
    bottomPercent: -((1 - end) / span) * 100,
    leftPercent: horizontalInset,
  }
}
