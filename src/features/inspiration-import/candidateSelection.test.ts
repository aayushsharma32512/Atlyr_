import { describe, expect, it } from "@jest/globals"

import { getDefaultCandidateIds } from "@/features/inspiration-import/candidateSelection"

describe("getDefaultCandidateIds", () => {
  it("selects the highest-confidence top and bottom in category order", () => {
    expect(getDefaultCandidateIds([
      { id: "bottom-low", category: "bottom", confidence: 0.61 },
      { id: "top-high", category: "top", confidence: 0.92 },
      { id: "bottom-high", category: "bottom", confidence: 0.87 },
      { id: "top-low", category: "top", confidence: 0.54 },
    ])).toEqual(["top-high", "bottom-high"])
  })

  it("selects the available category when the other category was not detected", () => {
    expect(getDefaultCandidateIds([
      { id: "bottom", category: "bottom", confidence: 0.72 },
    ])).toEqual(["bottom"])
  })

  it("keeps the first candidate when confidence scores tie", () => {
    expect(getDefaultCandidateIds([
      { id: "top-first", category: "top", confidence: 0.8 },
      { id: "top-second", category: "top", confidence: 0.8 },
    ])).toEqual(["top-first"])
  })
})
