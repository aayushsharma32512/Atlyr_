import { describe, expect, test } from "bun:test"
import type { AvatarItemBoundsFrame } from "@/features/studio/types"
import { getGarmentPreviewCrop, isBoundsFrameFor } from "./previewCrop"

const frame: AvatarItemBoundsFrame = {
  canvasWidth: 240,
  canvasHeight: 580,
  items: [
    { id: "top-1", zone: "top", left: 40, top: 120, width: 160, height: 190 },
    { id: "bottom-1", zone: "bottom", left: 55, top: 285, width: 130, height: 250 },
  ],
}

describe("getGarmentPreviewCrop", () => {
  test("ends a top crop just below its last opaque garment pixel", () => {
    const crop = getGarmentPreviewCrop(frame, "top-1", "top")

    expect(crop).not.toBeNull()
    expect(crop!.topPercent).toBe(-0)
    expect(crop!.bottomPercent).toBeLessThan(0)
  })

  test("starts a bottom crop just above its first opaque garment pixel", () => {
    const crop = getGarmentPreviewCrop(frame, "bottom-1", "bottom")

    expect(crop).not.toBeNull()
    expect(crop!.topPercent).toBeLessThan(0)
    expect(crop!.bottomPercent).toBe(-0)
  })

  test("returns no crop until matching bounds are available", () => {
    expect(getGarmentPreviewCrop(frame, "missing", "top")).toBeNull()
    expect(getGarmentPreviewCrop(null, "top-1", "top")).toBeNull()
  })

  test("keeps a minimum vertical context around very short garments", () => {
    const shortFrame: AvatarItemBoundsFrame = {
      ...frame,
      items: [{ id: "top-2", zone: "top", left: 80, top: 40, width: 80, height: 30 }],
    }
    const crop = getGarmentPreviewCrop(shortFrame, "top-2", "top")!
    const expandedHeight = 100 - crop.topPercent - crop.bottomPercent

    expect(expandedHeight).toBeLessThanOrEqual(100 / 0.42 + 0.001)
  })
})

describe("isBoundsFrameFor", () => {
  test("accepts the frame that measured the garments now on the figure", () => {
    expect(isBoundsFrameFor(frame, ["top-1", "bottom-1"])).toBe(true)
  })

  test("rejects a frame from a build the figure has already replaced", () => {
    expect(isBoundsFrameFor(frame, ["top-2", "bottom-1"])).toBe(false)
  })

  test("accepts an empty frame, which is how the renderer reports no measurable garment", () => {
    expect(isBoundsFrameFor({ ...frame, items: [] }, ["top-1"])).toBe(true)
  })
})
