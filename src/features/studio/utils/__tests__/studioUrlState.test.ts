import { describe, expect, it } from "bun:test"

import {
  buildStudioFocusUrl,
  buildStudioSearchParams,
  parseLayerOrder,
  parseStudioPath,
  parseStudioSearchParams,
} from "../studioUrlState"

describe("layers parameter", () => {
  it("parses a full permutation and rejects anything else", () => {
    expect(parseLayerOrder("bottom,top,shoes")).toEqual(["bottom", "top", "shoes"])
    expect(parseLayerOrder(" shoes , top , bottom ")).toEqual(["shoes", "top", "bottom"])
    expect(parseLayerOrder("bottom,top")).toBeNull()
    expect(parseLayerOrder("bottom,top,top")).toBeNull()
    expect(parseLayerOrder("bottom,top,hat")).toBeNull()
    expect(parseLayerOrder("")).toBeNull()
    expect(parseLayerOrder(null)).toBeNull()
  })

  it("round-trips through the search params and is absent when null", () => {
    const withOrder = buildStudioSearchParams({ outfitId: "o1", layerOrder: ["bottom", "top", "shoes"] })
    expect(withOrder.get("layers")).toBe("bottom,top,shoes")
    expect(parseStudioSearchParams(withOrder).layerOrder).toEqual(["bottom", "top", "shoes"])
    const without = buildStudioSearchParams({ outfitId: "o1", layerOrder: null })
    expect(without.has("layers")).toBe(false)
    expect(parseStudioSearchParams(without).layerOrder).toBeNull()
  })
})

describe("buildStudioFocusUrl", () => {
  it("puts the product in its slot and focuses that zone", () => {
    const url = buildStudioFocusUrl({ productId: "p1", slot: "bottom", returnTo: "/search?scope=lowers" })
    expect(url.startsWith("/studio?")).toBe(true)
    const params = new URLSearchParams(url.slice("/studio?".length))
    const parsed = parseStudioSearchParams(params)
    expect(parsed.slotIds.bottom).toBe("p1")
    expect(parsed.slotIds.top).toBeNull()
    expect(parsed.focus).toBe("bottom")
    expect(parsed.outfitId).toBeNull()
    expect(params.get("returnTo")).toBe(encodeURIComponent("/search?scope=lowers"))
  })

  it("omits returnTo when not given", () => {
    const url = buildStudioFocusUrl({ productId: "p1", slot: "top" })
    expect(url).toBe("/studio?topId=p1&focus=top")
  })

  it("wears the piece on the given look and keeps the other slot overrides", () => {
    const url = buildStudioFocusUrl({
      productId: "p9",
      slot: "top",
      outfitId: "o1",
      slotIds: { top: "old", bottom: "b1", shoes: null },
    })
    const parsed = parseStudioSearchParams(new URLSearchParams(url.slice("/studio?".length)))
    expect(parsed.outfitId).toBe("o1")
    expect(parsed.slotIds).toEqual({ top: "p9", bottom: "b1", shoes: null })
    expect(parsed.focus).toBe("top")
  })
})

describe("parseStudioPath", () => {
  it("reads the look and slot ids from a remembered path", () => {
    expect(parseStudioPath("/studio/alternatives?outfitId=o1&topId=t1&slot=top&focus=top")).toEqual({
      outfitId: "o1",
      slotIds: { top: "t1", bottom: null, shoes: null },
    })
  })
  it("is empty for a bare path", () => {
    expect(parseStudioPath("/studio")).toEqual({ outfitId: null, slotIds: { top: null, bottom: null, shoes: null } })
  })
})
