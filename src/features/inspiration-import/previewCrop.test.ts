import { describe, expect, test } from "bun:test"
import type { AvatarItemBoundsFrame } from "@/features/studio/types"
import { getGarmentPreviewCrop } from "./previewCrop"

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
