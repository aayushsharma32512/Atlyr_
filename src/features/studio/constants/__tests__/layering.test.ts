import { describe, expect, it } from "bun:test"

import {
  CANVAS_SLOTS,
  CANVAS_SLOT_NAMES,
  LAYERING_ENABLED,
  isCanvasSlot,
  stepCanvasSlot,
  toTraySlot,
} from "../layering"

describe("canvas slots", () => {
  it("ships with layering off, mirroring the bundle's altLayerOn", () => {
    expect(LAYERING_ENABLED).toBe(false)
    expect(CANVAS_SLOTS).toEqual(["top", "bottom", "shoes"])
  })

  it("only adds the layer slot when the flag is on", () => {
    expect(CANVAS_SLOTS.includes("layer")).toBe(LAYERING_ENABLED)
  })

  it("names the layer row after what it does", () => {
    expect(CANVAS_SLOT_NAMES.layer).toBe("Layer over top")
  })
})

describe("isCanvasSlot", () => {
  it("accepts every canvas slot, layer included", () => {
    expect(isCanvasSlot("top")).toBe(true)
    expect(isCanvasSlot("bottom")).toBe(true)
    expect(isCanvasSlot("shoes")).toBe(true)
    expect(isCanvasSlot("layer")).toBe(true)
  })

  it("rejects anything else", () => {
    expect(isCanvasSlot("accessory")).toBe(false)
    expect(isCanvasSlot("")).toBe(false)
    expect(isCanvasSlot(null)).toBe(false)
    expect(isCanvasSlot(undefined)).toBe(false)
  })
})

describe("toTraySlot", () => {
  it("queries a layer as a top — there is no layer item_type", () => {
    expect(toTraySlot("layer")).toBe("top")
  })

  it("leaves the three real slots alone", () => {
    expect(toTraySlot("top")).toBe("top")
    expect(toTraySlot("bottom")).toBe("bottom")
    expect(toTraySlot("shoes")).toBe("shoes")
  })
})

describe("stepCanvasSlot", () => {
  it("walks top to bottom to shoes", () => {
    expect(stepCanvasSlot("top", 1)).toBe("bottom")
    expect(stepCanvasSlot("bottom", 1)).toBe("shoes")
  })

  it("wraps in both directions", () => {
    expect(stepCanvasSlot(CANVAS_SLOTS[CANVAS_SLOTS.length - 1], 1)).toBe("top")
    expect(stepCanvasSlot("top", -1)).toBe(CANVAS_SLOTS[CANVAS_SLOTS.length - 1])
  })

  it("falls back to the first slot when the current one is not on the canvas", () => {
    // Layer with the flag off — reachable from a stale URL.
    expect(stepCanvasSlot("layer", 1)).toBe("top")
  })
})
