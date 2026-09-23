import { describe, expect, it } from "@jest/globals"

import { LAYER_RULES } from "@/features/studio/config/layerRules"
import { defaultLayerOrder, hidesBottomPlaceholder, layerRuleFor } from "@/features/studio/utils/layerOrder"

import { TOP_TYPE_CATEGORIES } from "./fixtures/topTypeCategories"

const kindOf = (typeCategory: string | null, productName: string | null = null) =>
  layerRuleFor({ typeCategory, productName })?.kind ?? null
const liveValues = TOP_TYPE_CATEGORIES.map((row) => row.typeCategory).filter((v): v is string => v !== null)

describe("layer rules config", () => {
  it("keeps every word lower case, trimmed, and unique within its list", () => {
    for (const rule of LAYER_RULES) {
      for (const list of [rule.matches, rule.nameMatches ?? []]) {
        for (const word of list) expect(word).toBe(word.trim().toLowerCase())
        expect(new Set(list).size).toBe(list.length)
      }
    }
  })
})

describe("layerRuleFor against the live type values", () => {
  it("matches at most one rule per value", () => {
    for (const value of liveValues) {
      const hits = LAYER_RULES.filter((rule) => rule.matches.some((word) => new RegExp(`\\b${word}\\b`, "i").test(value)))
      expect(hits.length).toBeLessThanOrEqual(1)
    }
  })

  it("classifies every bodysuit value, and nothing else, as bodysuit", () => {
    const expected = liveValues.filter((v) => v.includes("bodysuit"))
    expect(expected.length).toBeGreaterThan(0)
    for (const value of liveValues) {
      expect(kindOf(value) === "bodysuit").toBe(expected.includes(value))
    }
  })

  it("classifies every dress and gown value as one-piece", () => {
    for (const value of liveValues.filter((v) => v.includes("dress") || v.includes("gown"))) {
      expect(kindOf(value)).toBe("one-piece")
    }
  })

  it("does not read a one-piece word inside another word", () => {
    expect(kindOf("bodycon dress")).toBe("one-piece")
    expect(kindOf("saree blouse")).toBeNull()
    expect(kindOf("kurta")).toBeNull()
    expect(kindOf("crop top")).toBeNull()
    expect(kindOf(null)).toBeNull()
    expect(kindOf("")).toBeNull()
  })
})

describe("layerRuleFor name fallback", () => {
  it("catches a bodysuit the tagger typed as plain tops", () => {
    expect(kindOf("tops", "Square Neck Bodysuit")).toBe("bodysuit")
    expect(kindOf("tops", "Ribbed Body Suit")).toBe("bodysuit")
  })

  it("lets the type text win over the name", () => {
    expect(kindOf("maxi dress", "Bodysuit Style Dress")).toBe("one-piece")
  })

  it("does not read the one-piece rule from a name", () => {
    expect(kindOf("tops", "Dressberry Women's Top")).toBeNull()
    expect(kindOf("tops", "Classic Dress Shirt")).toBeNull()
    expect(kindOf("Top", "Wavy Print Cowl Mini Dress")).toBeNull()
  })
})

describe("defaultLayerOrder", () => {
  it("puts the bottom in front of a bodysuit and keeps the base order otherwise", () => {
    expect(defaultLayerOrder({ typeCategory: "bodysuit" })).toEqual(["bottom", "top", "shoes"])
    expect(defaultLayerOrder({ typeCategory: "High Neck Bodysuits" })).toEqual(["bottom", "top", "shoes"])
    expect(defaultLayerOrder({ typeCategory: "maxi dress" })).toEqual(["top", "bottom", "shoes"])
    expect(defaultLayerOrder({ typeCategory: "t-shirt" })).toEqual(["top", "bottom", "shoes"])
    expect(defaultLayerOrder(null)).toEqual(["top", "bottom", "shoes"])
  })

  it("returns a fresh array each call", () => {
    defaultLayerOrder({ typeCategory: "t-shirt" }).reverse()
    expect(defaultLayerOrder({ typeCategory: "t-shirt" })).toEqual(["top", "bottom", "shoes"])
  })
})

describe("hidesBottomPlaceholder", () => {
  it("is true for tops that cover the hips", () => {
    expect(hidesBottomPlaceholder({ typeCategory: "maxi dress" })).toBe(true)
    expect(hidesBottomPlaceholder({ typeCategory: "bodysuit" })).toBe(true)
    expect(hidesBottomPlaceholder({ typeCategory: "tops", productName: "Square Neck Bodysuit" })).toBe(true)
    expect(hidesBottomPlaceholder({ typeCategory: "crop top" })).toBe(false)
    expect(hidesBottomPlaceholder(null)).toBe(false)
  })
})
