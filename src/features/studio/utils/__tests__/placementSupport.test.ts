import { describe, expect, it } from "@jest/globals"

import {
  PLACEMENT_FILTERED_SLOTS,
  isOutfitFullyPlaceable,
  isPlaceableOnMannequin,
  shouldFilterSlotByPlacement,
} from "../placementSupport"

const IMAGE = "https://example.test/garment.png"
const TRANSFORM = { scale: 1, rotationDeg: 0, tx: 0, ty: 0, warp: [], mannequin: "female" as const, refW: null, refH: null }

describe("shouldFilterSlotByPlacement", () => {
  // The rack used to filter footwear only, so 113 unplaced tops and bottoms were
  // still offered — tapping one updated the slot and left the model unchanged.
  it("filters every slot the studio can wear", () => {
    expect(shouldFilterSlotByPlacement("top")).toBe(true)
    expect(shouldFilterSlotByPlacement("bottom")).toBe(true)
    expect(shouldFilterSlotByPlacement("shoes")).toBe(true)
  })

  it("leaves slots it does not know about alone", () => {
    expect(shouldFilterSlotByPlacement("background")).toBe(false)
    expect(shouldFilterSlotByPlacement("")).toBe(false)
  })

  it("covers exactly the three wearable slots", () => {
    expect([...PLACEMENT_FILTERED_SLOTS].sort()).toEqual(["bottom", "shoes", "top"])
  })
})

describe("isPlaceableOnMannequin", () => {
  it("rejects a product with no placement at all", () => {
    // 124 of 927 catalog rows, e.g. Barrel Fit Cotton Jeans (GAP / MANGO).
    expect(isPlaceableOnMannequin({ placement: null, imageUrl: IMAGE }, "female")).toBe(false)
    expect(isPlaceableOnMannequin({ imageUrl: IMAGE }, "male")).toBe(false)
  })

  it("rejects a product placed only on the OTHER mannequin", () => {
    // Belted Pleated Twill Shorts: gender=unisex, placed on female only, and
    // QA saw it vanish on the male body.
    const femaleOnly = { placement: { female: TRANSFORM }, imageUrl: IMAGE }
    expect(isPlaceableOnMannequin(femaleOnly, "female")).toBe(true)
    expect(isPlaceableOnMannequin(femaleOnly, "male")).toBe(false)
  })

  it("accepts a product placed on both bodies from either side", () => {
    const both = { placement: { female: TRANSFORM, male: { ...TRANSFORM, mannequin: "male" as const } }, imageUrl: IMAGE }
    expect(isPlaceableOnMannequin(both, "female")).toBe(true)
    expect(isPlaceableOnMannequin(both, "male")).toBe(true)
  })
})

describe("isOutfitFullyPlaceable", () => {
  const male = { ...TRANSFORM, mannequin: "male" as const }
  const placed = (m: "male" | "female") => ({
    placement: m === "male" ? { male } : { female: TRANSFORM },
    imageUrl: IMAGE,
  })

  it("accepts an outfit whose every garment is placed on the body being drawn", () => {
    expect(isOutfitFullyPlaceable([placed("female"), placed("female")], "female")).toBe(true)
  })

  it("rejects an outfit where even one garment would be silently dropped", () => {
    // The whole point: the renderer draws the rest and the look is quietly wrong.
    const unplaced = { placement: null, imageUrl: IMAGE }
    expect(isOutfitFullyPlaceable([placed("female"), unplaced], "female")).toBe(false)
  })

  it("rejects an outfit placed only on the other mannequin", () => {
    expect(isOutfitFullyPlaceable([placed("female")], "male")).toBe(false)
  })

  it("ignores garments with no image, since there is nothing to draw", () => {
    const noImage = { placement: null, imageUrl: null }
    expect(isOutfitFullyPlaceable([placed("female"), noImage], "female")).toBe(true)
  })

  it("rejects an outfit with nothing drawable at all", () => {
    expect(isOutfitFullyPlaceable([], "female")).toBe(false)
    expect(isOutfitFullyPlaceable([{ placement: null, imageUrl: null }], "female")).toBe(false)
  })
})
