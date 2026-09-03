import { describe, expect, test } from "bun:test"
import { resolvePreviewCategory } from "./previewFocus"

describe("resolvePreviewCategory", () => {
  test("keeps the active category when it has a selection", () => {
    expect(resolvePreviewCategory("bottom", { top: {}, bottom: {} })).toBe("bottom")
  })

  test("falls back to the selected top when the active bottom is empty", () => {
    expect(resolvePreviewCategory("bottom", { top: {}, bottom: null })).toBe("top")
  })

  test("falls back to the selected bottom when the active top is empty", () => {
    expect(resolvePreviewCategory("top", { top: null, bottom: {} })).toBe("bottom")
  })

  test("keeps the active category when neither category is selected", () => {
    expect(resolvePreviewCategory("bottom", { top: null, bottom: null })).toBe("bottom")
  })
})
