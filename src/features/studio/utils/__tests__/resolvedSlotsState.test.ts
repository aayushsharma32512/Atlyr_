import { describe, expect, it } from "@jest/globals"

import type { StudioProductTrayItem } from "@/services/studio/studioService"

import {
  buildSlotMap,
  computePendingSlots,
  firstResolveDone,
  firstResolveState,
  mergeSlotMaps,
} from "../resolvedSlotsState"

const item = (slot: StudioProductTrayItem["slot"], productId: string) =>
  ({ slot, productId } as unknown as StudioProductTrayItem)

const held = buildSlotMap([item("top", "T1"), item("bottom", "B1"), item("shoes", "S1")])

describe("computePendingSlots", () => {
  it("is empty when the URL names nothing or names the held pieces", () => {
    expect(computePendingSlots({}, held)).toEqual([])
    expect(computePendingSlots({ top: "T1", shoes: "S1" }, held)).toEqual([])
  })

  it("names the slots whose requested id differs from the held one", () => {
    expect(computePendingSlots({ top: "T2", bottom: "B1" }, held)).toEqual(["top"])
    expect(computePendingSlots({ top: "T2" }, buildSlotMap([]))).toEqual(["top"])
  })
})

describe("mergeSlotMaps", () => {
  it("returns the same object when nothing changes", () => {
    expect(mergeSlotMaps(held, buildSlotMap([item("top", "T1")]))).toBe(held)
  })

  it("takes incoming pieces and keeps the rest", () => {
    const merged = mergeSlotMaps(held, buildSlotMap([item("top", "T2")]))
    expect(merged.top?.productId).toBe("T2")
    expect(merged.bottom?.productId).toBe("B1")
  })
})

describe("firstResolveState", () => {
  it("waits on mount when the URL asks for a piece the look does not hold", () => {
    expect(firstResolveState(null, "A", 1)).toEqual({ outfitId: "A", awaiting: true })
  })

  it("does not wait on mount when the URL's pieces are already held", () => {
    expect(firstResolveState(null, "A", 0)).toEqual({ outfitId: "A", awaiting: false })
  })

  it("keeps the last frame on a later miss for the same outfit, such as a rack tap", () => {
    const settled = firstResolveDone(firstResolveState(null, "A", 1))
    expect(settled.awaiting).toBe(false)
    expect(firstResolveState(settled, "A", 1)).toBe(settled)
  })

  it("waits again when the outfit changes and its URL asks for a missing piece", () => {
    const settled = firstResolveDone(firstResolveState(null, "A", 1))
    expect(firstResolveState(settled, "B", 1)).toEqual({ outfitId: "B", awaiting: true })
    expect(firstResolveState(settled, "B", 0)).toEqual({ outfitId: "B", awaiting: false })
  })

  it("settles once and stays settled", () => {
    const waiting = firstResolveState(null, "A", 2)
    const settled = firstResolveDone(waiting)
    expect(settled.awaiting).toBe(false)
    expect(firstResolveDone(settled)).toBe(settled)
  })
})
