import { describe, expect, it } from "@jest/globals"

import { filterWardrobeItemsBySlot, getComplementarySlots } from "../wardrobePairing"

describe("wardrobePairing", () => {
  it("returns complementary slots for each slot", () => {
    expect(getComplementarySlots("top")).toEqual(["bottom", "shoes"])
    expect(getComplementarySlots("bottom")).toEqual(["top", "shoes"])
    expect(getComplementarySlots("shoes")).toEqual(["top", "bottom"])
    expect(getComplementarySlots(null)).toEqual([])
  })

  it("filters items to complementary slots", () => {
    const items = [
      { id: "1", itemType: "top" as const },
      { id: "2", itemType: "bottom" as const },
      { id: "3", itemType: "shoes" as const },
      { id: "4", itemType: null },
    ]

    expect(filterWardrobeItemsBySlot(items, "top").map((item) => item.id)).toEqual(["2", "3"])
    expect(filterWardrobeItemsBySlot(items, "bottom").map((item) => item.id)).toEqual(["1", "3"])
    expect(filterWardrobeItemsBySlot(items, "shoes").map((item) => item.id)).toEqual(["1", "2"])
    expect(filterWardrobeItemsBySlot(items, null)).toEqual([])
  })
})
