import { describe, expect, it } from "bun:test"

import { selectRackProducts } from "../rackOrder"

const results = [
  { id: "a", price: 300 },
  { id: "b", price: 100 },
  { id: "c", price: 200 },
]

describe("selectRackProducts", () => {
  it("keeps search order — no price sort", () => {
    const rack = selectRackProducts({ searchResults: results, fallback: [], useSearchResults: true })
    expect(rack.map((p) => p.id)).toEqual(["a", "b", "c"])
  })

  it("does not move the worn piece to the front", () => {
    // "c" is worn. It stays at index 2; the tile marks it in place.
    const rack = selectRackProducts({ searchResults: results, fallback: [], useSearchResults: true })
    expect(rack.findIndex((p) => p.id === "c")).toBe(2)
  })

  it("never mutates the query cache's array", () => {
    const source = [...results]
    selectRackProducts({ searchResults: source, fallback: [], useSearchResults: true })
    expect(source.map((p) => p.id)).toEqual(["a", "b", "c"])
  })

  it("falls back to the whole slot when no search is committed", () => {
    const fallback = [{ id: "x", price: 1 }]
    const rack = selectRackProducts({ searchResults: results, fallback, useSearchResults: false })
    expect(rack.map((p) => p.id)).toEqual(["x"])
  })

  it("falls back while a search is still loading", () => {
    const fallback = [{ id: "x", price: 1 }]
    const rack = selectRackProducts({ searchResults: undefined, fallback, useSearchResults: true })
    expect(rack.map((p) => p.id)).toEqual(["x"])
  })

  it("is an empty rack when there is nothing at all", () => {
    expect(selectRackProducts({ searchResults: undefined, fallback: undefined, useSearchResults: false })).toEqual([])
  })
})
