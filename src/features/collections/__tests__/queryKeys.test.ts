import { describe, expect, it } from "@jest/globals"

import { collectionsKeys } from "../queryKeys"

/**
 * TanStack Query's invalidateQueries matches by PREFIX: an invalidation key
 * matches a query whose key starts with it, element by element.
 *
 * This is the rule the collections keys got wrong. `creations()` reads as
 * "all creations", but its `size = 20` default fills the slot and produces the
 * fully-specified key for a page size nothing uses — the tab and the prefetcher
 * both ask for 6. Every invalidation matched zero queries, and with a 30-minute
 * staleTime the list served cache indefinitely: you deleted a creation, the
 * counter dropped, and the item stayed on screen.
 */
const isPrefixOf = (prefix: readonly unknown[], key: readonly unknown[]) =>
  prefix.length <= key.length && prefix.every((part, i) => Object.is(part, key[i]))

const LIVE_PAGE_SIZE = 6 // CreationsTab's PAGE_SIZE and CREATIONS_PREFETCH_SIZE

describe("collectionsKeys invalidation prefixes", () => {
  it("creationsAll matches a creations page of any size", () => {
    for (const size of [LIVE_PAGE_SIZE, 20, 100]) {
      expect(isPrefixOf(collectionsKeys.creationsAll(), collectionsKeys.creations(size))).toBe(true)
    }
  })

  it("tryOnsAll matches a try-ons page of any size", () => {
    for (const size of [LIVE_PAGE_SIZE, 20, 100]) {
      expect(isPrefixOf(collectionsKeys.tryOnsAll(), collectionsKeys.tryOns(size))).toBe(true)
    }
  })

  it("the sized key is NOT a valid invalidation key — this was the bug", () => {
    // Guards against anyone reintroducing `invalidateQueries(collectionsKeys.creations())`.
    expect(isPrefixOf(collectionsKeys.creations(), collectionsKeys.creations(LIVE_PAGE_SIZE))).toBe(false)
    expect(isPrefixOf(collectionsKeys.tryOns(), collectionsKeys.tryOns(LIVE_PAGE_SIZE))).toBe(false)
  })

  it("creationsAll does not reach the counter, so it must be invalidated separately", () => {
    // "creations" vs "creations-counts" are siblings, not parent and child.
    expect(isPrefixOf(collectionsKeys.creationsAll(), collectionsKeys.creationsCounts())).toBe(false)
  })

  it("creationsAll does not spill into unrelated collections queries", () => {
    expect(isPrefixOf(collectionsKeys.creationsAll(), collectionsKeys.favorites())).toBe(false)
    expect(isPrefixOf(collectionsKeys.creationsAll(), collectionsKeys.tryOns(LIVE_PAGE_SIZE))).toBe(false)
    expect(isPrefixOf(collectionsKeys.creationsAll(), collectionsKeys.moodboardItems("x"))).toBe(false)
  })

  it("moodboardItemsAll already followed the correct shape", () => {
    expect(isPrefixOf(collectionsKeys.moodboardItemsAll(), collectionsKeys.moodboardItems("street", 6))).toBe(true)
  })
})
