import { describe, expect, it } from "bun:test"

import {
  buildStudioSearchParams,
  isStudioSource,
  parseStudioSearchParams,
} from "../studioUrlState"

describe("focus in the URL", () => {
  it("round-trips a focused slot", () => {
    const params = buildStudioSearchParams({ outfitId: "o1", focus: "bottom" })
    expect(params.get("focus")).toBe("bottom")
    expect(parseStudioSearchParams(params).focus).toBe("bottom")
  })

  it("is absent when nothing is focused", () => {
    const params = buildStudioSearchParams({ outfitId: "o1" })
    expect(params.has("focus")).toBe(false)
    expect(parseStudioSearchParams(params).focus).toBeNull()
  })

  it("drops a slot that is not on the canvas", () => {
    expect(parseStudioSearchParams(new URLSearchParams("focus=hat")).focus).toBeNull()
    expect(buildStudioSearchParams({ focus: "hat" as never }).has("focus")).toBe(false)
  })

  it("survives alongside the slot ids it shares the URL with", () => {
    const params = buildStudioSearchParams({
      outfitId: "o1",
      slotIds: { top: "p1", bottom: "p2" },
      focus: "top",
    })
    const parsed = parseStudioSearchParams(params)
    expect(parsed.focus).toBe("top")
    expect(parsed.slotIds.top).toBe("p1")
    expect(parsed.outfitId).toBe("o1")
  })
})

describe("source in the URL", () => {
  it("round-trips each source", () => {
    for (const source of ["wardrobe", "saves", "explore"] as const) {
      const params = buildStudioSearchParams({ source })
      expect(parseStudioSearchParams(params).source).toBe(source)
    }
  })

  it("rejects the old RackMode names, which are not URL values", () => {
    expect(isStudioSource("yours")).toBe(false)
    expect(isStudioSource("alternates")).toBe(false)
    expect(parseStudioSearchParams(new URLSearchParams("source=yours")).source).toBeNull()
  })
})
