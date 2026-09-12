import { describe, expect, it } from "bun:test"

import { trimmedRange } from "../image-alpha-bounds"

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const range = (counts: number[], frac?: number) => trimmedRange(counts, sum(counts), frac)

describe("trimmedRange", () => {
  it("keeps a clean run exactly", () => {
    // Garment occupies indices 3..6, nothing else.
    expect(range([0, 0, 0, 50, 50, 50, 50, 0, 0, 0])).toEqual([3, 6])
  })

  it("ignores a speck far from the garment", () => {
    // One stray pixel at index 9 would drag a raw max/min box out to 9.
    const counts = [0, 0, 0, 500, 500, 500, 500, 0, 0, 1]
    expect(range(counts)).toEqual([3, 6])
  })

  it("ignores specks on both sides", () => {
    const counts = [1, 0, 0, 500, 500, 500, 500, 0, 0, 1]
    expect(range(counts)).toEqual([3, 6])
  })

  it("keeps a faint edge that carries real mass", () => {
    // 5% of the mass at the edge is the garment, not noise.
    const counts = [50, 0, 0, 500, 500, 0, 0, 0, 0, 0]
    expect(range(counts)[0]).toBe(0)
  })

  it("is a no-op when the mass fills the axis, as in a photo", () => {
    expect(range(new Array(10).fill(100))).toEqual([0, 9])
  })

  it("never inverts, even when one bucket holds everything", () => {
    const [lo, hi] = range([0, 0, 1000, 0, 0])
    expect(lo).toBe(2)
    expect(hi).toBe(2)
    expect(hi).toBeGreaterThanOrEqual(lo)
  })

  it("returns the whole axis when there is no mass at all", () => {
    expect(trimmedRange([0, 0, 0], 0)).toEqual([0, 2])
  })

  it("returns a safe range for an empty axis", () => {
    expect(trimmedRange([], 0)).toEqual([0, 0])
  })

  it("trims more aggressively as the fraction rises", () => {
    const counts = [10, 100, 100, 100, 10]
    const [loSmall] = range(counts, 0)
    const [loBig] = range(counts, 0.05)
    expect(loSmall).toBe(0)
    expect(loBig).toBe(1)
  })

  it("matches the measured fix for the noisy sneaker asset", () => {
    // 256 columns: garment mass over ~105 of them, plus faint specks out to the
    // right edge. Raw bounds spanned 0.719 of the width; trimmed spans ~0.41.
    const counts = new Array(256).fill(0)
    for (let i = 72; i < 177; i++) counts[i] = 40
    for (let i = 240; i < 256; i++) counts[i] = 1
    const [lo, hi] = range(counts)
    expect((hi - lo + 1) / 256).toBeCloseTo(0.41, 2)
  })
})

