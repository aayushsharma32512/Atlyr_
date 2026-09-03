import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import type { InspirationWebResult } from "../types"
import { readWebSearchCache, writeWebSearchCache } from "../webSearchCache"

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
const values = new Map<string, string>()
const sessionStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  removeItem: (key: string) => { values.delete(key) },
  setItem: (key: string, value: string) => { values.set(key, value) },
}

const result: InspirationWebResult = {
  id: "lens-image:1",
  candidateId: "candidate-1",
  providerResultId: "lens-image:1",
  title: "Example shirt",
  merchantDomain: "shop.example",
  listingUrl: "https://shop.example/shirt",
  imageUrl: "https://shop.example/shirt.jpg",
  rank: 1,
  priceLabel: "₹2,450",
  selectionToken: "signed-token",
}

beforeEach(() => {
  values.clear()
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage },
  })
})

afterAll(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
  else Reflect.deleteProperty(globalThis, "window")
})

describe("inspiration web-search browser cache", () => {
  test("returns candidate-scoped results before the one-hour expiry", () => {
    writeWebSearchCache("import-1", "candidate-1", [result], 1_000)

    expect(readWebSearchCache("import-1", "candidate-1", 1_000 + 60 * 60 * 1_000 - 1)).toEqual([result])
    expect(readWebSearchCache("import-1", "candidate-2", 1_100)).toBeNull()
  })

  test("evicts results at expiry", () => {
    writeWebSearchCache("import-1", "candidate-1", [result], 1_000)

    expect(readWebSearchCache("import-1", "candidate-1", 1_000 + 60 * 60 * 1_000)).toBeNull()
    expect(values.size).toBe(0)
  })

  test("rejects persisted database rows that have no selection token", () => {
    writeWebSearchCache("import-1", "candidate-1", [{ ...result, selectionToken: null }], 1_000)

    expect(readWebSearchCache("import-1", "candidate-1", 1_001)).toBeNull()
  })

  test("rejects browser-modified unsafe URLs", () => {
    writeWebSearchCache("import-1", "candidate-1", [{
      ...result,
      listingUrl: "javascript:alert(1)",
    }], 1_000)

    expect(readWebSearchCache("import-1", "candidate-1", 1_001)).toBeNull()
  })
})
