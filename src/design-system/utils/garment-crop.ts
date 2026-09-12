import type { CSSProperties } from "react"

import type { GarmentBounds } from "./image-alpha-bounds"

/**
 * Below this share of the image, the opaque garment is a sliver in a sea of
 * transparency and the frame is worth cropping. A scraped JPEG has no alpha at
 * all and measures exactly 1, so photographs are never touched. A segmented
 * shoe on the placement canvas measures ~0.025.
 */
export const CROP_AREA_THRESHOLD = 0.6

/** How much of the frame the garment fills once cropped. */
const DEFAULT_FILL = 0.86

export function shouldCropToContent(bounds: GarmentBounds): boolean {
  return bounds.w * bounds.h < CROP_AREA_THRESHOLD
}

/**
 * Position an image inside its frame so the opaque garment is centred and fills
 * `fill` of the frame, at the image's true aspect.
 *
 * `frameAspect` is the frame's own width/height. CSS percentages resolve width
 * against the frame's width and height against its height, so the two axes need
 * separate units — without the frame's aspect the image skews on any frame that
 * is not square. With full bounds this reduces to plain `object-fit: contain`.
 */
export function garmentCropStyle(
  bounds: GarmentBounds,
  frameAspect = 1,
  fill = DEFAULT_FILL,
): CSSProperties {
  const imageAspect = bounds.aspect > 0 ? bounds.aspect : 1
  const frame = frameAspect > 0 ? frameAspect : 1
  const safeW = Math.max(bounds.w, 0.001)
  const safeH = Math.max(bounds.h, 0.001)

  // Work in units of frame width; the frame is 1 wide and 1/frame tall.
  const byWidth = fill / safeW
  const byHeight = (fill * imageAspect) / (frame * safeH)
  const width = Math.min(byWidth, byHeight)
  const heightInWidthUnits = width / imageAspect

  return {
    position: "absolute",
    width: `${(width * 100).toFixed(3)}%`,
    // Converted to frame-height units, hence the extra factor of `frame`.
    height: `${(heightInWidthUnits * frame * 100).toFixed(3)}%`,
    left: `${((0.5 - width * (bounds.x + safeW / 2)) * 100).toFixed(3)}%`,
    top: `${((0.5 - heightInWidthUnits * (bounds.y + safeH / 2) * frame) * 100).toFixed(3)}%`,
    maxWidth: "none",
    maxHeight: "none",
    objectFit: "fill",
  }
}
