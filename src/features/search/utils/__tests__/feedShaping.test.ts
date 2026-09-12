import { describe, expect, it } from "bun:test"

import {
  flattenBrowseLooks,
  looksFromHomeEntries,
  piecesFromBrowseLooks,
  piecesFromSearchResults,
  piecesFromTrending,
  readFeedSeed,
} from "../feedShaping"

const outfit = (id: string, gender: string | null = "male") =>
  ({ id, gender, created_by: null } as unknown as import("@/types").Outfit)

const rendered = (id: string, zone: "top" | "bottom" | "shoes", name = id) =>
  ({ id, zone, productName: name, imageUrl: `https://img/${id}.png`, thumbnailUrl: null } as unknown as import("@/features/studio/types").StudioRenderedItem)

const browse = [
  {
    categoryId: "c1",
    title: "Office",
    outfits: [
      { id: "e1", title: "Look A", chips: [], outfit: outfit("o1"), studioOutfit: { renderedItems: [rendered("p1", "top"), rendered("p2", "bottom")] } },
      { id: "e2", title: "Look B", chips: [], outfit: outfit("o2", null), studioOutfit: { renderedItems: [rendered("p1", "top"), rendered("p3", "shoes")] } },
    ],
  },
  {
    categoryId: "c2",
    title: "Party",
    outfits: [{ id: "e3", title: "Look A again", chips: [], outfit: outfit("o1"), studioOutfit: null }],
  },
] as unknown as import("@/services/search/searchService").SearchBrowseCollection[]

describe("flattenBrowseLooks", () => {
  it("flattens collections in order and dedupes by outfit id", () => {
    const looks = flattenBrowseLooks(browse, "female")
    expect(looks.map((l) => l.outfit.id)).toEqual(["o1", "o2"])
    expect(looks[0].gender).toBe("male")
    expect(looks[1].gender).toBe("female") // null falls back
    expect(looks[0].renderedItems?.length).toBe(2)
  })
})

describe("piecesFromBrowseLooks", () => {
  it("picks the slot's item from each curated look, deduped, first-seen order", () => {
    expect(piecesFromBrowseLooks(browse, "top").map((p) => p.id)).toEqual(["p1"])
    expect(piecesFromBrowseLooks(browse, "shoes")).toEqual([
      { id: "p3", title: "p3", imageSrc: "https://img/p3.png", slot: "shoes" },
    ])
  })
})

describe("looksFromHomeEntries", () => {
  it("flattens pages and applies the gender fallback", () => {
    const pages = [
      [{ id: "h1", title: "One", chips: [], outfit: outfit("o9", "female"), renderedItems: [] }],
      [{ id: "h2", title: "Two", chips: [], outfit: outfit("o10", "unisex"), renderedItems: [] }],
    ] as unknown as import("@/services/home/homeService").HomeOutfitEntry[][]
    const looks = looksFromHomeEntries(pages, "male")
    expect(looks.map((l) => [l.id, l.gender])).toEqual([["h1", "female"], ["h2", "male"]])
    expect(looksFromHomeEntries(undefined, "male")).toEqual([])
  })
})

describe("piecesFromTrending", () => {
  it("maps trending rows to pieces", () => {
    const rows = [{ id: "t1", type: "top", productName: null, imageUrl: "u", looks: 3 }] as import("@/services/collections/collectionsService").TrendingProduct[]
    expect(piecesFromTrending(rows, "top")).toEqual([{ id: "t1", title: "", imageSrc: "u", slot: "top" }])
    expect(piecesFromTrending(undefined, "top")).toEqual([])
  })
})

describe("piecesFromSearchResults", () => {
  it("flattens result pages into pieces", () => {
    const pages = [{ nextCursor: 24, results: [{ id: "s1", title: "Shirt", imageSrc: "i", thumbnailSrc: "i" }] }] as unknown as { results: import("@/services/search/searchService").ProductSearchResult[] }[]
    expect(piecesFromSearchResults(pages, "top")).toEqual([{ id: "s1", title: "Shirt", imageSrc: "i", slot: "top" }])
  })
})

describe("readFeedSeed", () => {
  it("mints once per storage and reuses it", () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    const first = readFeedSeed(storage, () => "abc")
    const second = readFeedSeed(storage, () => "zzz")
    expect(first).toBe("abc")
    expect(second).toBe("abc")
  })

  it("falls back to a minted seed when storage throws", () => {
    const storage = { getItem: () => { throw new Error("private mode") }, setItem: () => {} }
    expect(readFeedSeed(storage, () => "m")).toBe("m")
  })
})
