import { describe, expect, it } from "bun:test"

import { CROP_AREA_THRESHOLD, garmentCropStyle, shouldCropToContent } from "../garment-crop"
import type { GarmentBounds } from "../image-alpha-bounds"

const pct = (v: unknown) => Number(String(v).replace("%", ""))

/** Measured off the live asset: a kolhapuri on the 1536x2752 placement canvas. */
const SEGMENTED_SHOE: GarmentBounds = {
  x: 0.343,
  y: 0.922,
  w: 0.322,
  h: 0.078,
  aspect: 0.558,
}

/** A scraped 540x720 JPEG — no alpha, so the probe returns the whole image. */
const SCRAPED_PHOTO: GarmentBounds = { x: 0, y: 0, w: 1, h: 1, aspect: 0.75 }

describe("shouldCropToContent", () => {
  it("crops a garment that is a sliver on the placement canvas", () => {
    expect(SEGMENTED_SHOE.w * SEGMENTED_SHOE.h).toBeLessThan(0.05)
    expect(shouldCropToContent(SEGMENTED_SHOE)).toBe(true)
  })

  it("never crops an opaque photograph", () => {
    expect(shouldCropToContent(SCRAPED_PHOTO)).toBe(false)
  })

  it("leaves anything at or above the threshold alone", () => {
    expect(shouldCropToContent({ x: 0, y: 0, w: 1, h: CROP_AREA_THRESHOLD, aspect: 1 })).toBe(false)
  })
})

/** Where the opaque box lands, in fractions of the frame's own width/height. */
function placedBox(bounds: GarmentBounds, frameAspect: number, fill?: number) {
  const s = garmentCropStyle(bounds, frameAspect, fill)
  const w = pct(s.width) / 100
  const h = pct(s.height) / 100
  return {
    centreX: pct(s.left) / 100 + w * (bounds.x + bounds.w / 2),
    centreY: pct(s.top) / 100 + h * (bounds.y + bounds.h / 2),
    // Widths are frame-width units; heights are frame-height units. Convert the
    // height so both are comparable against `fill`.
    boxW: w * bounds.w,
    boxH: (h * bounds.h) / frameAspect,
    imgW: w,
    imgH: h,
  }
}

describe.each([
  ["square frame", 1],
  ["tall frame (the piece card: 176x205)", 176 / 205],
  ["wide frame", 1.6],
])("garmentCropStyle — %s", (_label, frameAspect) => {
  it("centres the opaque box in the frame", () => {
    const { centreX, centreY } = placedBox(SEGMENTED_SHOE, frameAspect)
    expect(centreX).toBeCloseTo(0.5, 3)
    expect(centreY).toBeCloseTo(0.5, 3)
  })

  it("scales the opaque box to the requested fill without overflowing", () => {
    const fill = 0.86
    const { boxW, boxH } = placedBox(SEGMENTED_SHOE, frameAspect, fill)
    expect(Math.max(boxW, boxH)).toBeCloseTo(fill, 3)
    expect(Math.min(boxW, boxH)).toBeLessThanOrEqual(fill + 1e-6)
  })

  it("preserves the image's aspect ratio — no skew on a non-square frame", () => {
    const { imgW, imgH } = placedBox(SEGMENTED_SHOE, frameAspect)
    // imgH is in frame-height units; divide by the frame aspect to compare.
    expect(imgW / (imgH / frameAspect)).toBeCloseTo(SEGMENTED_SHOE.aspect, 3)
  })
})

describe("garmentCropStyle", () => {
  it("reduces to object-contain for a full-bounds image in a square frame", () => {
    const s = garmentCropStyle(SCRAPED_PHOTO, 1, 1)
    // A 0.75-aspect image in a square frame: full height, 75% width, centred.
    expect(pct(s.height)).toBeCloseTo(100, 3)
    expect(pct(s.width)).toBeCloseTo(75, 3)
    expect(pct(s.top)).toBeCloseTo(0, 3)
    expect(pct(s.left)).toBeCloseTo(12.5, 3)
  })

  it("survives a degenerate zero-size box without dividing by zero", () => {
    const s = garmentCropStyle({ x: 0.5, y: 0.5, w: 0, h: 0, aspect: 1 })
    expect(Number.isFinite(pct(s.width))).toBe(true)
    expect(Number.isFinite(pct(s.left))).toBe(true)
  })

  it("handles a zero aspect and a zero frame without producing NaN", () => {
    for (const s of [
      garmentCropStyle({ x: 0, y: 0, w: 1, h: 1, aspect: 0 }),
      garmentCropStyle({ x: 0, y: 0, w: 1, h: 1, aspect: 1 }, 0),
    ]) {
      expect(Number.isFinite(pct(s.width))).toBe(true)
      expect(Number.isFinite(pct(s.height))).toBe(true)
    }
  })
})
