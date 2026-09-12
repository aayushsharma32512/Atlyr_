import { describe, expect, it } from "bun:test"

import { SLUG_LENGTH, generateShareSlug, isSafeSharePath } from "../shareLinkSlug"

describe("generateShareSlug", () => {
  it("is eight characters", () => {
    expect(generateShareSlug()).toHaveLength(SLUG_LENGTH)
  })

  it("never uses the look-alike characters 0 O I l", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateShareSlug()).not.toMatch(/[0OIl]/)
    }
  })

  it("is URL-safe — letters and digits only", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateShareSlug()).toMatch(/^[A-Za-z0-9]+$/)
    }
  })

  it("does not repeat across a batch", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateShareSlug()))
    expect(seen.size).toBe(500)
  })
})

describe("isSafeSharePath", () => {
  it("accepts a URL inside the query string — the path itself stays same-origin", () => {
    expect(isSafeSharePath("/studio?next=https://example.com")).toBe(true)
  })

  it("accepts the studio share path", () => {
    expect(isSafeSharePath("/studio?outfitId=abc&topId=1&share=1")).toBe(true)
    expect(isSafeSharePath("/studio")).toBe(true)
  })

  it("refuses anything that could leave the app", () => {
    for (const bad of [
      "https://evil.example/x",
      "//evil.example/x",
      "/\\evil.example",
      "javascript:alert(1)",
      "studio?share=1",
      "",
    ]) {
      expect(isSafeSharePath(bad)).toBe(false)
    }
  })
})
