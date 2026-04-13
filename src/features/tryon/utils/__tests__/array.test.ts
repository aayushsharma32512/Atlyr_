import { uniqueProductIds } from "@/features/tryon/utils/array"

describe("uniqueProductIds", () => {
  it("filters falsy values and deduplicates", () => {
    const result = uniqueProductIds(["a", null, "b", "a", undefined, "c"])
    expect(result).toEqual(["a", "b", "c"])
  })

  it("returns empty array when no ids are provided", () => {
    expect(uniqueProductIds([null, undefined])).toEqual([])
  })
})

