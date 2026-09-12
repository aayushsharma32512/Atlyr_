# Search Feed (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Search reset state as a scoped feed (Looks · Tops · Lowers · Kicks → Hot Styles · Atlyr Curations · For You) with the search bar docked above the nav, and route piece taps into Studio focus.

**Architecture:** Pure helpers (`scope.ts`, `feedShaping.ts`) own every mapping and derivation so they are unit-tested under `bun test` without a renderer. One new service call (`browseProducts`) and one new hook (`useSearchBrowseProducts`) follow the service → queryKeys → hook → screen flow. `useSearchFeed` composes existing home/search/collections hooks per scope into one card-ready shape. Presentation splits into five small components; `SearchScreen.tsx` only swaps its JSX and plumbs scope ↔ mode.

**Tech Stack:** React 18, TanStack Query v5, react-router v6, Tailwind + design-system primitives, Supabase JS, `bun test` (jest-compatible API, `bun:test` `mock.module` for Supabase).

**Spec:** `docs/superpowers/specs/2026-09-11-search-feed-design.md`

## Global Constraints

- Package manager is `bun`. Tests run with `bun test <explicit file path>` (never `bunx jest`, never a bare directory).
- Screens never import `@supabase/supabase-js`; data flows `src/services/<domain>` → `src/features/<domain>/queryKeys.ts` → `src/features/<domain>/hooks` → screen.
- No direct `posthog.*` calls. Do not add a `section` value; omit `section`. No change to `docs/posthog/ENGAGEMENT_TRACKING_SPEC.md` is expected.
- Additive only: nothing deleted. `SearchResetState.tsx` stays on disk, unmounted.
- Do not set `renderBox` at call sites; `OutfitCard` already carries the canonical box.
- Code comments: 1-2 lines, plain language.
- Known-red baseline: `bun run typecheck` has 7 pre-existing errors, `bun run lint` 275/143. Leave every touched file no worse; do not fix unrelated errors.
- Copy as on the whiteboard: "Looks", "Tops", "Lowers", "Kicks", "Hot Styles", "Atlyr Curations", "For You".
- Frame values: chips 26h, section gap 20, rail card width 96, gap 8, gutters 16, nav 55h, bar 40h.
- No PR and no push without Naman's go. Commits are local to `test/all-changes` or a branch off it.
- There is no `@testing-library/react` in this repo: do not write `renderHook` tests. Test pure functions and services only.

---

## File map

| File | Responsibility |
|---|---|
| `src/features/search/utils/scope.ts` (new) | `SearchScope` type, labels, scope ↔ slot ↔ mode maps, URL resolve |
| `src/features/search/utils/feedShaping.ts` (new) | Pure shaping of home/browse/trending/search data into `FeedLook` / `FeedPiece`; feed seed |
| `src/features/studio/utils/studioUrlState.ts` (modify) | `buildStudioFocusUrl` |
| `src/services/search/searchService.ts` (modify) | `browseProducts` |
| `src/features/search/queryKeys.ts` (modify) | `browseProducts` key |
| `src/features/search/hooks/useSearchBrowseProducts.ts` (new) | Infinite query over `browseProducts` |
| `src/features/search/hooks/useSearchFeed.ts` (new) | Per-scope composition → `{ hot, curations, forYou }` |
| `src/design-system/icons/index.ts` (modify) | `openList: ArrowUpRight` |
| `src/design-system/primitives/outfit-card.tsx` (modify) | `footer` prop |
| `src/design-system/utils/useDockAboveKeyboard.ts` (new) | Keeps a fixed dock above the soft keyboard |
| `src/features/search/components/SearchScopeRail.tsx` (new) | Four chips |
| `src/features/search/components/SearchRail.tsx` (new) | Header + 96w horizontal rail |
| `src/features/search/components/SearchFeed.tsx` (new) | Hot / Curations / For You |
| `src/features/search/components/SearchListPage.tsx` (new) | Full-page 2-col of a rail |
| `src/features/search/components/SearchDock.tsx` (new) | Fixed bottom bar wrapper |
| `src/features/search/SearchScreen.tsx` (modify) | Layout swap, scope plumbing, slot filter, piece tap |
| `src/services/collections/collectionsService.ts` (modify) | `perSlot` default 40 |
| `docs/redesign/SEARCH_SCREEN.md` (modify) | v2 build notes |

Shared shapes (defined in Task 2, used everywhere after):

```ts
export interface FeedLook {
  id: string            // list key
  title: string
  outfit: Outfit
  renderedItems?: StudioRenderedItem[]
  gender: "male" | "female"
}
export interface FeedPiece {
  id: string            // product id
  title: string
  imageSrc: string | null
  slot: StudioProductTraySlot
}
```

---

### Task 1: Scope helpers

**Files:**
- Create: `src/features/search/utils/scope.ts`
- Test: `src/features/search/utils/__tests__/scope.test.ts`

**Interfaces:**
- Produces: `SearchScope`, `SearchMode`, `SEARCH_SCOPES`, `SCOPE_LABELS`, `isSearchScope(v)`, `scopeToSlot(scope)`, `slotToScope(slot)`, `scopeToMode(scope)`, `resolveScope(params)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/search/utils/__tests__/scope.test.ts
import { describe, expect, it } from "bun:test"

import {
  SEARCH_SCOPES,
  isSearchScope,
  resolveScope,
  scopeToMode,
  scopeToSlot,
  slotToScope,
} from "../scope"

describe("scope", () => {
  it("lists the four scopes in whiteboard order", () => {
    expect(SEARCH_SCOPES).toEqual(["looks", "tops", "lowers", "kicks"])
  })

  it("maps scopes to tray slots and back", () => {
    expect(scopeToSlot("looks")).toBeNull()
    expect(scopeToSlot("tops")).toBe("top")
    expect(scopeToSlot("lowers")).toBe("bottom")
    expect(scopeToSlot("kicks")).toBe("shoes")
    expect(slotToScope("bottom")).toBe("lowers")
  })

  it("maps scopes to the legacy search mode", () => {
    expect(scopeToMode("looks")).toBe("outfits")
    expect(scopeToMode("kicks")).toBe("products")
  })

  it("resolves scope from the URL, falling back to mode, then looks", () => {
    expect(resolveScope(new URLSearchParams("scope=lowers"))).toBe("lowers")
    expect(resolveScope(new URLSearchParams("mode=products"))).toBe("tops")
    expect(resolveScope(new URLSearchParams("mode=outfits"))).toBe("looks")
    expect(resolveScope(new URLSearchParams("scope=junk&mode=products"))).toBe("tops")
    expect(resolveScope(new URLSearchParams(""))).toBe("looks")
    expect(isSearchScope("kicks")).toBe(true)
    expect(isSearchScope("shoes")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/features/search/utils/__tests__/scope.test.ts`
Expected: FAIL, cannot resolve `../scope`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/search/utils/scope.ts
import type { StudioProductTraySlot } from "@/services/studio/studioService"

export type SearchScope = "looks" | "tops" | "lowers" | "kicks"
export type SearchMode = "products" | "outfits"

export const SEARCH_SCOPES: SearchScope[] = ["looks", "tops", "lowers", "kicks"]

export const SCOPE_LABELS: Record<SearchScope, string> = {
  looks: "Looks",
  tops: "Tops",
  lowers: "Lowers",
  kicks: "Kicks",
}

const SCOPE_SLOT: Record<Exclude<SearchScope, "looks">, StudioProductTraySlot> = {
  tops: "top",
  lowers: "bottom",
  kicks: "shoes",
}

export function isSearchScope(value: string | null | undefined): value is SearchScope {
  return value === "looks" || value === "tops" || value === "lowers" || value === "kicks"
}

export function scopeToSlot(scope: SearchScope): StudioProductTraySlot | null {
  return scope === "looks" ? null : SCOPE_SLOT[scope]
}

export function slotToScope(slot: StudioProductTraySlot): SearchScope {
  return slot === "top" ? "tops" : slot === "bottom" ? "lowers" : "kicks"
}

export function scopeToMode(scope: SearchScope): SearchMode {
  return scope === "looks" ? "outfits" : "products"
}

/** `scope` wins; an old `mode`-only link maps products→tops, outfits→looks. */
export function resolveScope(params: URLSearchParams): SearchScope {
  const scope = params.get("scope")
  if (isSearchScope(scope)) return scope
  return params.get("mode") === "products" ? "tops" : "looks"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/features/search/utils/__tests__/scope.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/search/utils/scope.ts src/features/search/utils/__tests__/scope.test.ts
git commit -m "feat(search): scope helpers for looks/tops/lowers/kicks"
```

---

### Task 2: Feed shaping helpers

**Files:**
- Create: `src/features/search/utils/feedShaping.ts`
- Test: `src/features/search/utils/__tests__/feedShaping.test.ts`

**Interfaces:**
- Consumes: `SearchBrowseCollection` from `@/services/search/searchService`; `HomeOutfitEntry` from `@/services/home/homeService`; `TrendingProduct` from `@/services/collections/collectionsService`; `ProductSearchResult` from `@/services/search/searchService`; `StudioRenderedItem` from `@/features/studio/types`.
- Produces: `FeedLook`, `FeedPiece`, `flattenBrowseLooks`, `piecesFromBrowseLooks`, `looksFromHomeEntries`, `piecesFromTrending`, `piecesFromSearchResults`, `readFeedSeed`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/search/utils/__tests__/feedShaping.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/features/search/utils/__tests__/feedShaping.test.ts`
Expected: FAIL, cannot resolve `../feedShaping`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/search/utils/feedShaping.ts
import type { TrendingProduct } from "@/services/collections/collectionsService"
import type { HomeOutfitEntry } from "@/services/home/homeService"
import type { ProductSearchResult, SearchBrowseCollection } from "@/services/search/searchService"
import type { StudioProductTraySlot } from "@/services/studio/studioService"
import type { StudioRenderedItem } from "@/features/studio/types"
import type { Outfit } from "@/types"

type Gender = "male" | "female"

export interface FeedLook {
  id: string
  title: string
  outfit: Outfit
  renderedItems?: StudioRenderedItem[]
  gender: Gender
}

export interface FeedPiece {
  id: string
  title: string
  imageSrc: string | null
  slot: StudioProductTraySlot
}

export const FEED_SEED_KEY = "atlyr:search:feedSeed"

const resolveGender = (value: string | null | undefined, fallback: Gender): Gender =>
  value === "male" || value === "female" ? value : fallback

/** Curated collections as one rail: collection order kept, each outfit once. */
export function flattenBrowseLooks(collections: SearchBrowseCollection[] | undefined, fallback: Gender): FeedLook[] {
  const seen = new Set<string>()
  const looks: FeedLook[] = []
  for (const collection of collections ?? []) {
    for (const entry of collection.outfits) {
      if (seen.has(entry.outfit.id)) continue
      seen.add(entry.outfit.id)
      looks.push({
        id: entry.id,
        title: entry.title,
        outfit: entry.outfit,
        renderedItems: entry.studioOutfit?.renderedItems,
        gender: resolveGender(entry.outfit.gender, fallback),
      })
    }
  }
  return looks
}

/** The pieces worn in curated looks, for one slot. */
export function piecesFromBrowseLooks(collections: SearchBrowseCollection[] | undefined, slot: StudioProductTraySlot): FeedPiece[] {
  const seen = new Set<string>()
  const pieces: FeedPiece[] = []
  for (const collection of collections ?? []) {
    for (const entry of collection.outfits) {
      const item = entry.studioOutfit?.renderedItems?.find((rendered) => rendered.zone === slot)
      if (!item || seen.has(item.id)) continue
      seen.add(item.id)
      pieces.push({ id: item.id, title: item.productName ?? "", imageSrc: item.thumbnailUrl ?? item.imageUrl ?? null, slot })
    }
  }
  return pieces
}

export function looksFromHomeEntries(pages: HomeOutfitEntry[][] | undefined, fallback: Gender): FeedLook[] {
  return (pages ?? []).flat().map((entry) => ({
    id: entry.id,
    title: entry.title,
    outfit: entry.outfit,
    renderedItems: entry.renderedItems,
    gender: resolveGender(entry.outfit.gender, fallback),
  }))
}

export function piecesFromTrending(rows: TrendingProduct[] | undefined, slot: StudioProductTraySlot): FeedPiece[] {
  return (rows ?? []).map((row) => ({ id: row.id, title: row.productName ?? "", imageSrc: row.imageUrl, slot }))
}

export function piecesFromSearchResults(
  pages: { results: ProductSearchResult[] }[] | undefined,
  slot: StudioProductTraySlot,
): FeedPiece[] {
  return (pages ?? []).flatMap((page) => page.results).map((row) => ({ id: row.id, title: row.title, imageSrc: row.thumbnailSrc ?? row.imageSrc, slot }))
}

const mintSeed = () => Math.random().toString(36).slice(2, 10)

/** One seed per session so For You is stable across back-navigation. */
export function readFeedSeed(storage: Pick<Storage, "getItem" | "setItem">, mint: () => string = mintSeed): string {
  try {
    const existing = storage.getItem(FEED_SEED_KEY)
    if (existing) return existing
    const seed = mint()
    storage.setItem(FEED_SEED_KEY, seed)
    return seed
  } catch {
    return mint()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/features/search/utils/__tests__/feedShaping.test.ts`
Expected: PASS (7 tests). If `thumbnailSrc` is not on `ProductSearchResult` in your checkout, check `src/services/search/searchService.ts` around the `ProductSearchResult` interface; it is set in `mapProductRowToResult`.

- [ ] **Step 5: Commit**

```bash
git add src/features/search/utils/feedShaping.ts src/features/search/utils/__tests__/feedShaping.test.ts
git commit -m "feat(search): pure feed shaping for looks and pieces"
```

---

### Task 3: Studio focus URL

**Files:**
- Modify: `src/features/studio/utils/studioUrlState.ts` (append after `buildStudioUrl`)
- Test: `src/features/studio/utils/__tests__/studioUrlState.test.ts`

**Interfaces:**
- Produces: `buildStudioFocusUrl({ productId, slot, returnTo? }): string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/studio/utils/__tests__/studioUrlState.test.ts
import { describe, expect, it } from "bun:test"

import { buildStudioFocusUrl, parseStudioSearchParams } from "../studioUrlState"

describe("buildStudioFocusUrl", () => {
  it("puts the product in its slot and focuses that zone", () => {
    const url = buildStudioFocusUrl({ productId: "p1", slot: "bottom", returnTo: "/search?scope=lowers" })
    expect(url.startsWith("/studio?")).toBe(true)
    const params = new URLSearchParams(url.slice("/studio?".length))
    const parsed = parseStudioSearchParams(params)
    expect(parsed.slotIds.bottom).toBe("p1")
    expect(parsed.slotIds.top).toBeNull()
    expect(parsed.focus).toBe("bottom")
    expect(parsed.outfitId).toBeNull()
    expect(params.get("returnTo")).toBe(encodeURIComponent("/search?scope=lowers"))
  })

  it("omits returnTo when not given", () => {
    const url = buildStudioFocusUrl({ productId: "p1", slot: "top" })
    expect(url).toBe("/studio?topId=p1&focus=top")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/features/studio/utils/__tests__/studioUrlState.test.ts`
Expected: FAIL, `buildStudioFocusUrl` is not exported.

- [ ] **Step 3: Append the implementation**

```ts
// src/features/studio/utils/studioUrlState.ts — add at the end of the file

/** A piece opened from a feed: worn in its slot on the current look, zoomed to it. */
export function buildStudioFocusUrl(input: {
  productId: string
  slot: StudioProductTraySlot
  returnTo?: string | null
}): string {
  const params = buildStudioSearchParams({ slotIds: { [input.slot]: input.productId }, focus: input.slot })
  if (input.returnTo) {
    params.set("returnTo", encodeURIComponent(input.returnTo))
  }
  return `/studio?${params.toString()}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/features/studio/utils/__tests__/studioUrlState.test.ts`
Expected: PASS (2 tests). If the second test fails on param order, compare against `buildStudioSearchParams` (slot ids are set before `focus`) and fix the expected string, not the builder.

- [ ] **Step 5: Commit**

```bash
git add src/features/studio/utils/studioUrlState.ts src/features/studio/utils/__tests__/studioUrlState.test.ts
git commit -m "feat(studio): buildStudioFocusUrl for feed piece taps"
```

---

### Task 4: `browseProducts` service, key, hook

**Files:**
- Modify: `src/services/search/searchService.ts` (add `browseProducts`, export it in the `searchService` object and as a named export)
- Modify: `src/features/search/queryKeys.ts`
- Create: `src/features/search/hooks/useSearchBrowseProducts.ts`
- Test: `src/services/search/__tests__/browseProducts.test.ts`

**Interfaces:**
- Produces: `searchService.browseProducts({ slot, gender, cursor }): Promise<{ results: ProductSearchResult[]; nextCursor: number | null }>`; `searchKeys.browseProducts(slot, gender)`; `useSearchBrowseProducts({ slot, enabled })` returning a `useInfiniteQuery` result whose `data.pages[i].results` is `ProductSearchResult[]`.
- `BROWSE_PRODUCTS_PAGE = 24`.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/search/__tests__/browseProducts.test.ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

// Records the builder chain so the test can assert filters, order and range.
const calls: Array<[string, unknown[]]> = []
let rows: Record<string, unknown>[] = []
let failWith: { message: string } | null = null

function builder() {
  const chain: Record<string, unknown> = {}
  const step = (name: string) => (...args: unknown[]) => {
    calls.push([name, args])
    return chain
  }
  for (const name of ["select", "eq", "not", "or", "order"]) chain[name] = step(name)
  chain.range = (...args: unknown[]) => {
    calls.push(["range", args])
    return Promise.resolve(failWith ? { data: null, error: failWith } : { data: rows, error: null })
  }
  return chain
}

mock.module("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => { calls.push(["from", [table]]); return builder() } },
}))

const { browseProducts, BROWSE_PRODUCTS_PAGE } = await import("../searchService")

const row = (id: string) => ({ id, product_name: `P ${id}`, brand: "B", price: 1, currency: "INR", image_url: `u/${id}`, thumbnail_url: null, type: "top" })

beforeEach(() => {
  calls.length = 0
  rows = []
  failWith = null
})

describe("browseProducts", () => {
  it("filters by slot type and profile gender, newest first, one page", async () => {
    rows = [row("a"), row("b")]
    const page = await browseProducts({ slot: "top", gender: "female", cursor: 0 })
    expect(page.results.map((r) => r.id)).toEqual(["a", "b"])
    expect(page.nextCursor).toBeNull() // short page = end
    expect(calls).toContainEqual(["from", ["products"]])
    expect(calls).toContainEqual(["eq", ["type", "top"]])
    expect(calls).toContainEqual(["not", ["image_url", "is", null]])
    expect(calls).toContainEqual(["or", ["gender.eq.unisex,gender.eq.female,gender.is.null"]])
    expect(calls).toContainEqual(["order", ["created_at", { ascending: false }]])
    expect(calls).toContainEqual(["range", [0, BROWSE_PRODUCTS_PAGE - 1]])
  })

  it("advances the cursor on a full page and skips the gender filter without a profile gender", async () => {
    rows = Array.from({ length: BROWSE_PRODUCTS_PAGE }, (_, i) => row(`r${i}`))
    const page = await browseProducts({ slot: "shoes", gender: null, cursor: 48 })
    expect(page.nextCursor).toBe(48 + BROWSE_PRODUCTS_PAGE)
    expect(calls).toContainEqual(["range", [48, 48 + BROWSE_PRODUCTS_PAGE - 1]])
    expect(calls.some(([name]) => name === "or")).toBe(false)
  })

  it("throws the Supabase message", async () => {
    failWith = { message: "boom" }
    await expect(browseProducts({ slot: "bottom", gender: "male", cursor: 0 })).rejects.toThrow("boom")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/search/__tests__/browseProducts.test.ts`
Expected: FAIL, `browseProducts` is not a function / not exported.

- [ ] **Step 3: Add the service function**

In `src/services/search/searchService.ts`, directly above `export const searchService = {`:

```ts
export const BROWSE_PRODUCTS_PAGE = 24

const PRODUCT_COLUMNS =
  "id, product_name, brand, price, currency, image_url, thumbnail_url, color, type, type_category, gender, fit, feel, vibes, category_id, color_group, size, product_url, placement, placement_x, placement_y, image_length, body_parts_visible"

interface BrowseProductsInput {
  slot: Database["public"]["Enums"]["item_type"]
  gender: Gender
  cursor?: number | null
}

/** No-query browse for a slot: newest pieces the profile gender can wear. */
export async function browseProducts({ slot, gender, cursor }: BrowseProductsInput): Promise<SearchFunctionResponse<ProductSearchResult>> {
  const from = Math.max(cursor ?? 0, 0)
  let query = supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("type", slot)
    .not("image_url", "is", null)
  if (gender === "male" || gender === "female") {
    query = query.or(`${buildGenderFilter(gender)},gender.is.null`)
  }
  const { data, error } = await query.order("created_at", { ascending: false }).range(from, from + BROWSE_PRODUCTS_PAGE - 1)
  if (error) {
    throw new Error(error.message)
  }
  const results = (data ?? [])
    .map((row) => mapProductRowToResult(row as unknown as Record<string, unknown>))
    .filter((row): row is ProductSearchResult => Boolean(row))
  return { results, nextCursor: results.length === BROWSE_PRODUCTS_PAGE ? from + BROWSE_PRODUCTS_PAGE : null }
}
```

Then add `browseProducts,` to the `searchService` object. `Gender` here is the file's existing local `Gender` type (`"male" | "female" | null`); if the file names it differently, use that name. `fetchProductsByIds` at ~line 405 uses the same column string; replace that literal with `PRODUCT_COLUMNS` so there is one list.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/search/__tests__/browseProducts.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the query key**

In `src/features/search/queryKeys.ts`, inside `searchKeys`:

```ts
  browseProducts: (slot: string, gender: Gender) =>
    [...searchKeys.all, "browse-products", slot, gender ?? "neutral"] as const,
```

- [ ] **Step 6: Write the hook**

```ts
// src/features/search/hooks/useSearchBrowseProducts.ts
import { useInfiniteQuery } from "@tanstack/react-query"

import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { searchKeys } from "@/features/search/queryKeys"
import { browseProducts } from "@/services/search/searchService"
import type { StudioProductTraySlot } from "@/services/studio/studioService"

interface UseSearchBrowseProductsParams {
  slot: StudioProductTraySlot | null
  enabled?: boolean
}

/** For You, pieces: an endless newest-first page of one slot. */
export function useSearchBrowseProducts({ slot, enabled = true }: UseSearchBrowseProductsParams) {
  const { gender, isLoading: isProfileLoading } = useProfileContext()

  return useInfiniteQuery({
    queryKey: searchKeys.browseProducts(slot ?? "none", gender ?? null),
    queryFn: ({ pageParam }) =>
      browseProducts({ slot: slot as StudioProductTraySlot, gender: gender ?? null, cursor: typeof pageParam === "number" ? pageParam : 0 }),
    enabled: enabled && Boolean(slot) && !isProfileLoading,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
```

- [ ] **Step 7: Typecheck the three files**

Run: `bun run typecheck 2>&1 | grep -E "searchService|queryKeys|useSearchBrowseProducts"`
Expected: no lines (the 7 baseline errors are elsewhere).

- [ ] **Step 8: Commit**

```bash
git add src/services/search/searchService.ts src/services/search/__tests__/browseProducts.test.ts src/features/search/queryKeys.ts src/features/search/hooks/useSearchBrowseProducts.ts
git commit -m "feat(search): browseProducts service and hook for the For You rail"
```

---

### Task 5: `useSearchFeed`

**Files:**
- Create: `src/features/search/hooks/useSearchFeed.ts`
- Modify: `src/services/collections/collectionsService.ts` (`perSlot = 20` → `perSlot = 40` in `fetchTrendingProducts`)

**Interfaces:**
- Consumes: Task 1 `scopeToSlot`; Task 2 shaping helpers + `readFeedSeed`; Task 4 `useSearchBrowseProducts`; existing `useHomeAllOutfits`, `useHomeCuratedOutfits` (`@/features/home/hooks/...`), `useSearchBrowseCollections`, `useTrendingProducts` (`@/features/collections/hooks/useMoodboards`).
- Produces:

```ts
export interface FeedSection<T> {
  items: T[]
  isLoading: boolean
  isError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
}
export type FeedSections =
  | { kind: "looks"; hot: FeedSection<FeedLook>; curations: FeedSection<FeedLook>; forYou: FeedSection<FeedLook> }
  | { kind: "pieces"; slot: StudioProductTraySlot; hot: FeedSection<FeedPiece>; curations: FeedSection<FeedPiece>; forYou: FeedSection<FeedPiece> }
export function useSearchFeed(scope: SearchScope, enabled: boolean): FeedSections
```

- [ ] **Step 1: Raise the trending depth**

In `src/services/collections/collectionsService.ts` `fetchTrendingProducts`, change `perSlot = 20` to `perSlot = 40`. Comment stays as is.

- [ ] **Step 2: Write the hook**

```ts
// src/features/search/hooks/useSearchFeed.ts
import { useMemo } from "react"

import { useTrendingProducts } from "@/features/collections/hooks/useMoodboards"
import { useHomeAllOutfits } from "@/features/home/hooks/useHomeAllOutfits"
import { useHomeCuratedOutfits } from "@/features/home/hooks/useHomeCuratedOutfits"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useSearchBrowseCollections } from "@/features/search/hooks/useSearchBrowseCollections"
import { useSearchBrowseProducts } from "@/features/search/hooks/useSearchBrowseProducts"
import {
  flattenBrowseLooks,
  looksFromHomeEntries,
  piecesFromBrowseLooks,
  piecesFromSearchResults,
  piecesFromTrending,
  readFeedSeed,
  type FeedLook,
  type FeedPiece,
} from "@/features/search/utils/feedShaping"
import { scopeToSlot, type SearchScope } from "@/features/search/utils/scope"
import type { StudioProductTraySlot } from "@/services/studio/studioService"

export interface FeedSection<T> {
  items: T[]
  isLoading: boolean
  isError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
}

export type FeedSections =
  | { kind: "looks"; hot: FeedSection<FeedLook>; curations: FeedSection<FeedLook>; forYou: FeedSection<FeedLook> }
  | { kind: "pieces"; slot: StudioProductTraySlot; hot: FeedSection<FeedPiece>; curations: FeedSection<FeedPiece>; forYou: FeedSection<FeedPiece> }

const HOT_PAGE = 24
const FOR_YOU_PAGE = 24
const noop = () => {}

const finite = <T,>(items: T[], isLoading: boolean, isError: boolean): FeedSection<T> => ({
  items, isLoading, isError, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: noop,
})

/** The three feed sections for one scope. Only that scope's queries run. */
export function useSearchFeed(scope: SearchScope, enabled: boolean): FeedSections {
  const { gender } = useProfileContext()
  const fallbackGender: "male" | "female" = gender === "male" ? "male" : "female"
  const slot = scopeToSlot(scope)
  const looksOn = enabled && slot === null
  const piecesOn = enabled && slot !== null
  const seed = useMemo(() => readFeedSeed(window.sessionStorage), [])

  // Looks
  const hotLooks = useHomeAllOutfits("relevance", HOT_PAGE, looksOn)
  const browse = useSearchBrowseCollections({ enabled })
  const forYouLooks = useHomeCuratedOutfits(looksOn ? seed : "", FOR_YOU_PAGE)

  // Pieces
  const trending = useTrendingProducts(piecesOn)
  const forYouPieces = useSearchBrowseProducts({ slot, enabled: piecesOn })

  return useMemo<FeedSections>(() => {
    if (slot === null) {
      return {
        kind: "looks",
        hot: {
          items: looksFromHomeEntries(hotLooks.data?.pages, fallbackGender),
          isLoading: hotLooks.isLoading,
          isError: hotLooks.isError,
          hasNextPage: Boolean(hotLooks.hasNextPage),
          isFetchingNextPage: hotLooks.isFetchingNextPage,
          fetchNextPage: () => void hotLooks.fetchNextPage(),
        },
        curations: finite(flattenBrowseLooks(browse.data, fallbackGender), browse.isLoading, browse.isError),
        forYou: {
          items: looksFromHomeEntries(forYouLooks.data?.pages, fallbackGender),
          isLoading: forYouLooks.isLoading,
          isError: forYouLooks.isError,
          hasNextPage: Boolean(forYouLooks.hasNextPage),
          isFetchingNextPage: forYouLooks.isFetchingNextPage,
          fetchNextPage: () => void forYouLooks.fetchNextPage(),
        },
      }
    }
    return {
      kind: "pieces",
      slot,
      hot: finite(piecesFromTrending(trending.data?.[slot], slot), trending.isLoading, trending.isError),
      curations: finite(piecesFromBrowseLooks(browse.data, slot), browse.isLoading, browse.isError),
      forYou: {
        items: piecesFromSearchResults(forYouPieces.data?.pages, slot),
        isLoading: forYouPieces.isLoading,
        isError: forYouPieces.isError,
        hasNextPage: Boolean(forYouPieces.hasNextPage),
        isFetchingNextPage: forYouPieces.isFetchingNextPage,
        fetchNextPage: () => void forYouPieces.fetchNextPage(),
      },
    }
  }, [browse, fallbackGender, forYouLooks, forYouPieces, hotLooks, slot, trending])
}
```

- [ ] **Step 3: Add `enabled` to the two home hooks and the trending hook**

`useHomeAllOutfits(sortBy, size = 50)` and `useTrendingProducts()` have no `enabled` parameter. Add a trailing optional parameter to each, defaulting to `true`, AND-ed into their existing `enabled` (for `useHomeAllOutfits`: `enabled: enabled && !isProfileLoading`; for `useTrendingProducts`: add `enabled`). `useHomeCuratedOutfits` already disables on an empty seed, which is why the hook passes `""` when looks are off. Existing callers pass no third argument, so nothing else changes.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck 2>&1 | grep -E "useSearchFeed|useHomeAllOutfits|useMoodboards|collectionsService"`
Expected: no lines.

- [ ] **Step 5: Commit**

```bash
git add src/features/search/hooks/useSearchFeed.ts src/features/home/hooks/useHomeAllOutfits.ts src/features/collections/hooks/useMoodboards.ts src/services/collections/collectionsService.ts
git commit -m "feat(search): useSearchFeed composes hot, curations and for-you per scope"
```

---

### Task 6: Primitive touches — `openList` icon, `OutfitCard.footer`

**Files:**
- Modify: `src/design-system/icons/index.ts`
- Modify: `src/design-system/primitives/outfit-card.tsx`

**Interfaces:**
- Produces: `Icons.openList` (lucide `ArrowUpRight`); `OutfitCard` prop `footer?: boolean` (default `true`).

- [ ] **Step 1: Register the icon**

In `src/design-system/icons/index.ts`, add `ArrowUpRight` to the lucide import and, next to `expand: Maximize2,`, add:

```ts
  openList: ArrowUpRight, // rail → its full page
```

- [ ] **Step 2: Add the `footer` prop**

In `outfit-card.tsx`, add to `OutfitCardProps`:

```ts
  /** Off for 96w rail tiles: figure only, no 40h name row. */
  footer?: boolean
```

Destructure `footer = true` in the component and wrap the existing 40h footer element: `{footer ? (<existing footer JSX />) : null}`. The pin and figure are unchanged. Keep `title` required (it still feeds `aria-label` / `alt`).

- [ ] **Step 3: Check the headless route still renders**

Run: `bunx vite --port 5199` in the background, open `http://localhost:5199/design-system/product-card`, confirm outfit cards still show their footer. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/design-system/icons/index.ts src/design-system/primitives/outfit-card.tsx
git commit -m "feat(ds): openList icon and footerless OutfitCard for rails"
```

---

### Task 7: Scope rail, rail, feed, list page components

**Files:**
- Create: `src/features/search/components/SearchScopeRail.tsx`
- Create: `src/features/search/components/SearchRail.tsx`
- Create: `src/features/search/components/SearchFeed.tsx`
- Create: `src/features/search/components/SearchListPage.tsx`

**Interfaces:**
- Consumes: Task 1 (`SEARCH_SCOPES`, `SCOPE_LABELS`, `SearchScope`), Task 2 (`FeedLook`, `FeedPiece`), Task 5 (`FeedSections`, `FeedSection`), Task 6 (`Icons.openList`, `OutfitCard footer`).
- Produces:

```ts
// SearchScopeRail
{ value: SearchScope; onChange: (next: SearchScope) => void }
// SearchRail (generic)
{ title: string; section: FeedSection<FeedLook> | FeedSection<FeedPiece>; kind: "looks" | "pieces"; heightCm: number; onOpenList: () => void; handlers: FeedHandlers }
// SearchFeed
{ sections: FeedSections; heightCm: number; onOpenList: (list: FeedList) => void; handlers: FeedHandlers }
// SearchListPage
{ title: string; kind: "looks" | "pieces"; section: FeedSection<FeedLook> | FeedSection<FeedPiece>; heightCm: number; onBack: () => void; handlers: FeedHandlers }
// shared
export type FeedList = "hot" | "curations"
export interface FeedHandlers {
  onOpenLook: (look: FeedLook, layout: "horizontal_rail" | "vertical_grid", position: number) => void
  onOpenPiece: (piece: FeedPiece, layout: "horizontal_rail" | "vertical_grid", position: number) => void
  isLookSaved: (outfitId: string) => boolean
  onToggleLookSave: (outfitId: string, next: boolean) => void
  onLongPressLookSave: (outfitId: string) => void
  isPieceSaved: (productId: string) => boolean
  onTogglePieceSave: (productId: string, next: boolean) => void
  onLongPressPieceSave: (productId: string) => void
}
```

- [ ] **Step 1: Scope rail**

```tsx
// src/features/search/components/SearchScopeRail.tsx
import { Chip } from "@/design-system/primitives"
import { SCOPE_LABELS, SEARCH_SCOPES, type SearchScope } from "@/features/search/utils/scope"

interface SearchScopeRailProps {
  value: SearchScope
  onChange: (next: SearchScope) => void
}

/** Looks · Tops · Lowers · Kicks. One control for what the page shows and what a search returns. */
export function SearchScopeRail({ value, onChange }: SearchScopeRailProps) {
  return (
    <div role="tablist" aria-label="Scope" className="flex h-[34px] items-center gap-1.5">
      {SEARCH_SCOPES.map((scope) => (
        <Chip key={scope} label={SCOPE_LABELS[scope]} active={scope === value} onClick={() => onChange(scope)} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Shared types and the rail**

```tsx
// src/features/search/components/SearchRail.tsx
import { Icons } from "@/design-system/icons"
import { OutfitCard, ProductTile, SectionHeader } from "@/design-system/primitives"
import type { FeedSection } from "@/features/search/hooks/useSearchFeed"
import type { FeedLook, FeedPiece } from "@/features/search/utils/feedShaping"

export type FeedList = "hot" | "curations"
export type FeedLayout = "horizontal_rail" | "vertical_grid"

export interface FeedHandlers {
  onOpenLook: (look: FeedLook, layout: FeedLayout, position: number) => void
  onOpenPiece: (piece: FeedPiece, layout: FeedLayout, position: number) => void
  isLookSaved: (outfitId: string) => boolean
  onToggleLookSave: (outfitId: string, next: boolean) => void
  onLongPressLookSave: (outfitId: string) => void
  isPieceSaved: (productId: string) => boolean
  onTogglePieceSave: (productId: string, next: boolean) => void
  onLongPressPieceSave: (productId: string) => void
}

type SearchRailProps =
  | { kind: "looks"; section: FeedSection<FeedLook>; title: string; heightCm: number; onOpenList: () => void; handlers: FeedHandlers }
  | { kind: "pieces"; section: FeedSection<FeedPiece>; title: string; heightCm: number; onOpenList: () => void; handlers: FeedHandlers }

const RAIL_LIMIT = 12
// 3.5 × 96 + 3 × 8 = 360: the fourth card is cut at the gutter, as the board asks.
const CARD = "w-[96px] shrink-0"
const TRACK = "h-[136px]"

export function SearchRail(props: SearchRailProps) {
  const { title, section, heightCm, onOpenList, handlers } = props
  const items = section.items.slice(0, RAIL_LIMIT)

  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader
        title={title}
        className="border-t border-hairline pt-2"
        actionSlot={
          <button type="button" aria-label={`Open ${title}`} onClick={onOpenList} className="flex h-8 w-8 items-center justify-center text-ink">
            <Icons.openList className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      />
      <div className={`flex gap-2 overflow-x-auto scrollbar-hide ${TRACK}`} role="list" aria-label={title}>
        {section.isLoading
          ? Array.from({ length: 4 }).map((_, i) => <span key={i} className={`skeleton-shimmer rounded-lg ${CARD} ${TRACK}`} />)
          : props.kind === "looks"
            ? props.section.items.slice(0, RAIL_LIMIT).map((look, index) => {
                const saved = handlers.isLookSaved(look.outfit.id)
                return (
                  <div key={look.id} className={`${CARD} ${TRACK}`} role="listitem">
                    <OutfitCard
                      title={look.title}
                      footer={false}
                      outfitId={look.outfit.id}
                      renderedItems={look.renderedItems}
                      gender={look.gender}
                      heightCm={heightCm}
                      saved={saved}
                      onSelect={() => handlers.onOpenLook(look, "horizontal_rail", index)}
                      onToggleSave={() => handlers.onToggleLookSave(look.outfit.id, !saved)}
                      onLongPressSave={() => handlers.onLongPressLookSave(look.outfit.id)}
                    />
                  </div>
                )
              })
            : props.section.items.slice(0, RAIL_LIMIT).map((piece, index) => {
                const saved = handlers.isPieceSaved(piece.id)
                return (
                  <div key={piece.id} className={CARD} role="listitem">
                    <ProductTile
                      size="small"
                      title={piece.title}
                      imageSrc={piece.imageSrc}
                      saved={saved}
                      cropToContent
                      onSelect={() => handlers.onOpenPiece(piece, "horizontal_rail", index)}
                      onToggleSave={() => handlers.onTogglePieceSave(piece.id, !saved)}
                      onLongPressSave={() => handlers.onLongPressPieceSave(piece.id)}
                    />
                  </div>
                )
              })}
        {!section.isLoading && items.length === 0 ? (
          <p className="self-center text-xs text-taupe">Nothing here yet.</p>
        ) : null}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: The feed**

```tsx
// src/features/search/components/SearchFeed.tsx
import { useEffect, useRef } from "react"

import { OutfitCard, ProductTile, SectionHeader } from "@/design-system/primitives"
import type { FeedSections } from "@/features/search/hooks/useSearchFeed"
import { SearchRail, type FeedHandlers, type FeedList } from "@/features/search/components/SearchRail"

interface SearchFeedProps {
  sections: FeedSections
  heightCm: number
  onOpenList: (list: FeedList) => void
  handlers: FeedHandlers
}

const GRID = "grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4"

/** Hot Styles · Atlyr Curations · For You, for the active scope. */
export function SearchFeed({ sections, heightCm, onOpenList, handlers }: SearchFeedProps) {
  const { forYou } = sections
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = forYou

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const rails =
    sections.kind === "looks" ? (
      <>
        <SearchRail kind="looks" title="Hot Styles" section={sections.hot} heightCm={heightCm} onOpenList={() => onOpenList("hot")} handlers={handlers} />
        <SearchRail kind="looks" title="Atlyr Curations" section={sections.curations} heightCm={heightCm} onOpenList={() => onOpenList("curations")} handlers={handlers} />
      </>
    ) : (
      <>
        <SearchRail kind="pieces" title="Hot Styles" section={sections.hot} heightCm={heightCm} onOpenList={() => onOpenList("hot")} handlers={handlers} />
        <SearchRail kind="pieces" title="Atlyr Curations" section={sections.curations} heightCm={heightCm} onOpenList={() => onOpenList("curations")} handlers={handlers} />
      </>
    )

  return (
    <div className="flex flex-col gap-5">
      {rails}
      <section className="flex flex-col gap-2.5">
        <SectionHeader title="For You" className="border-t border-hairline pt-2" />
        {forYou.isLoading ? (
          <div className={GRID}>
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className={`skeleton-shimmer rounded-lg ${sections.kind === "looks" ? "h-[250px]" : "h-[215px]"}`} />
            ))}
          </div>
        ) : sections.kind === "looks" ? (
          <div className={GRID}>
            {sections.forYou.items.map((look, index) => {
              const saved = handlers.isLookSaved(look.outfit.id)
              return (
                <div key={look.id} className="h-[250px]">
                  <OutfitCard
                    title={look.title}
                    outfitId={look.outfit.id}
                    renderedItems={look.renderedItems}
                    gender={look.gender}
                    heightCm={heightCm}
                    saved={saved}
                    tiltIndex={index}
                    onSelect={() => handlers.onOpenLook(look, "vertical_grid", index)}
                    onToggleSave={() => handlers.onToggleLookSave(look.outfit.id, !saved)}
                    onLongPressSave={() => handlers.onLongPressLookSave(look.outfit.id)}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <div className={GRID}>
            {sections.forYou.items.map((piece, index) => {
              const saved = handlers.isPieceSaved(piece.id)
              return (
                <ProductTile
                  key={piece.id}
                  title={piece.title}
                  imageSrc={piece.imageSrc}
                  saved={saved}
                  cropToContent
                  onSelect={() => handlers.onOpenPiece(piece, "vertical_grid", index)}
                  onToggleSave={() => handlers.onTogglePieceSave(piece.id, !saved)}
                  onLongPressSave={() => handlers.onLongPressPieceSave(piece.id)}
                />
              )
            })}
          </div>
        )}
        <div ref={sentinelRef} className="h-2" />
        {isFetchingNextPage ? (
          <div className={GRID}>
            {Array.from({ length: 2 }).map((_, i) => (
              <span key={i} className={`skeleton-shimmer rounded-lg ${sections.kind === "looks" ? "h-[250px]" : "h-[215px]"}`} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: The full-page list**

```tsx
// src/features/search/components/SearchListPage.tsx
import { useEffect, useRef } from "react"

import { Icons } from "@/design-system/icons"
import { OutfitCard, ProductTile } from "@/design-system/primitives"
import type { FeedSection } from "@/features/search/hooks/useSearchFeed"
import type { FeedHandlers } from "@/features/search/components/SearchRail"
import type { FeedLook, FeedPiece } from "@/features/search/utils/feedShaping"

type SearchListPageProps =
  | { kind: "looks"; section: FeedSection<FeedLook>; title: string; heightCm: number; onBack: () => void; handlers: FeedHandlers }
  | { kind: "pieces"; section: FeedSection<FeedPiece>; title: string; heightCm: number; onBack: () => void; handlers: FeedHandlers }

const GRID = "grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4"

/** A rail, opened: 32h header then the whole list in two columns. */
export function SearchListPage(props: SearchListPageProps) {
  const { title, section, heightCm, onBack, handlers } = props
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = section

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  return (
    <div className="flex flex-col gap-2.5">
      <header className="flex h-8 items-center gap-2">
        <button type="button" aria-label="Back" onClick={onBack} className="flex h-8 w-8 items-center justify-center text-ink">
          <Icons.carouselPrev className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="font-display text-title font-medium text-ink">{title}</h1>
      </header>
      {section.isLoading ? (
        <div className={GRID}>
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className={`skeleton-shimmer rounded-lg ${props.kind === "looks" ? "h-[250px]" : "h-[215px]"}`} />
          ))}
        </div>
      ) : props.kind === "looks" ? (
        <div className={GRID}>
          {props.section.items.map((look, index) => {
            const saved = handlers.isLookSaved(look.outfit.id)
            return (
              <div key={look.id} className="h-[250px]">
                <OutfitCard
                  title={look.title}
                  outfitId={look.outfit.id}
                  renderedItems={look.renderedItems}
                  gender={look.gender}
                  heightCm={heightCm}
                  saved={saved}
                  tiltIndex={index}
                  onSelect={() => handlers.onOpenLook(look, "vertical_grid", index)}
                  onToggleSave={() => handlers.onToggleLookSave(look.outfit.id, !saved)}
                  onLongPressSave={() => handlers.onLongPressLookSave(look.outfit.id)}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div className={GRID}>
          {props.section.items.map((piece, index) => {
            const saved = handlers.isPieceSaved(piece.id)
            return (
              <ProductTile
                key={piece.id}
                title={piece.title}
                imageSrc={piece.imageSrc}
                saved={saved}
                cropToContent
                onSelect={() => handlers.onOpenPiece(piece, "vertical_grid", index)}
                onToggleSave={() => handlers.onTogglePieceSave(piece.id, !saved)}
                onLongPressSave={() => handlers.onLongPressPieceSave(piece.id)}
              />
            )
          })}
        </div>
      )}
      <div ref={sentinelRef} className="h-2" />
    </div>
  )
}
```

Check the Bodoni title class: `grep -rn "font-display\|text-title" src/design-system/primitives/*.tsx | head` and use whatever class the Collections header uses for its Bodoni title. If the existing back glyph is registered under a different name than `carouselPrev` in `Icons` (look for `ChevronLeft`), use that name.

- [ ] **Step 5: Typecheck the four files**

Run: `bun run typecheck 2>&1 | grep -E "SearchScopeRail|SearchRail|SearchFeed|SearchListPage"`
Expected: no lines.

- [ ] **Step 6: Commit**

```bash
git add src/features/search/components/SearchScopeRail.tsx src/features/search/components/SearchRail.tsx src/features/search/components/SearchFeed.tsx src/features/search/components/SearchListPage.tsx
git commit -m "feat(search): scope rail, feed rails, for-you grid and list page"
```

---

### Task 8: Bottom dock and keyboard hook

**Files:**
- Create: `src/design-system/utils/useDockAboveKeyboard.ts`
- Create: `src/features/search/components/SearchDock.tsx`

**Interfaces:**
- Produces: `useDockAboveKeyboard(navHeight: number): number` (the `bottom` px to apply); `SearchDock({ children })`.
- `src/design-system/utils/` already exists (untracked in git status); add the file beside whatever is there.

- [ ] **Step 1: The hook**

```ts
// src/design-system/utils/useDockAboveKeyboard.ts
import { useEffect, useState } from "react"

/**
 * Bottom offset for a fixed dock so it rides above the soft keyboard.
 * Fixed elements sit on the layout viewport; the keyboard shrinks the visual one.
 */
export function useDockAboveKeyboard(navHeight: number): number {
  const [bottom, setBottom] = useState(navHeight)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      // With the keyboard up the nav is under it, so the dock sits on the keyboard edge.
      setBottom(covered > 0 ? covered : navHeight)
    }
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [navHeight])

  return bottom
}
```

- [ ] **Step 2: The dock**

```tsx
// src/features/search/components/SearchDock.tsx
import type { ReactNode } from "react"

import { useDockAboveKeyboard } from "@/design-system/utils/useDockAboveKeyboard"

export const NAV_HEIGHT = 55
export const DOCK_HEIGHT = 56 // 40 field + 2 × 8 padding

/** The search bar's home: fixed above the nav, hairline on top. */
export function SearchDock({ children }: { children: ReactNode }) {
  const bottom = useDockAboveKeyboard(NAV_HEIGHT)
  return (
    <div className="fixed inset-x-0 z-30 border-t border-hairline bg-background" style={{ bottom }}>
      <div className="mx-auto w-full max-w-[24.5rem] px-4 py-2 md:max-w-[47rem] lg:max-w-[62rem] xl:max-w-[78rem]">{children}</div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck 2>&1 | grep -E "useDockAboveKeyboard|SearchDock"`
Expected: no lines.

- [ ] **Step 4: Commit**

```bash
git add src/design-system/utils/useDockAboveKeyboard.ts src/features/search/components/SearchDock.tsx
git commit -m "feat(search): bottom search dock that rides above the keyboard"
```

---

### Task 9: Wire `SearchScreen`

**Files:**
- Modify: `src/features/search/SearchScreen.tsx`

**Interfaces:**
- Consumes everything above. Existing names in the file you will touch: `searchParams`, `setSearchParams`, `modeParamValue` (line ~83), `activeFilter` / `setActiveFilter` (~138), `isResultsMode` (~136), `mergedProductFilters` (~514), `handleProductSelect` (~783), `handleFilterChange` (~1330), `handleQuickSearch` (~1073), `launchStudio`, `productSaveActions`, `favoriteIds`, `handleToggleOutfitById`, `handleLongPressOutfitById`, `originPath`, `trackItemClicked`, `analytics`, `heightCm`, `profileGender`.

- [ ] **Step 1: Imports**

Add:

```ts
import { SearchDock } from "@/features/search/components/SearchDock"
import { SearchFeed } from "@/features/search/components/SearchFeed"
import { SearchListPage } from "@/features/search/components/SearchListPage"
import { SearchScopeRail } from "@/features/search/components/SearchScopeRail"
import type { FeedHandlers, FeedList } from "@/features/search/components/SearchRail"
import { useSearchFeed } from "@/features/search/hooks/useSearchFeed"
import type { FeedLook, FeedPiece } from "@/features/search/utils/feedShaping"
import { resolveScope, scopeToMode, scopeToSlot, slotToScope, type SearchScope } from "@/features/search/utils/scope"
import { buildStudioFocusUrl } from "@/features/studio/utils/studioUrlState"
```

Remove the `SearchResetState` import (the file stays on disk).

- [ ] **Step 2: Scope state from the URL**

Right after `const modeParamValue = ...`:

```ts
  const scope = useMemo(() => resolveScope(searchParams), [searchParams])
  const scopeSlot = scopeToSlot(scope)
  const listParam = searchParams.get("list")
  const openList: FeedList | null = listParam === "hot" || listParam === "curations" ? listParam : null
```

Change the `activeFilter` initialiser so it derives from scope: `useState<"products" | "outfits">(() => scopeToMode(resolveScope(searchParams)))`. In the effect that syncs `activeFilter` from `modeParamValue` (the one at ~line 1190 that reads `const target = modeParamValue`), replace `modeParamValue` with `scopeToMode(scope)` and add `scope` to its deps.

- [ ] **Step 3: Scope change handler**

Below `handleFilterChange`:

```ts
  const handleScopeChange = useCallback(
    (next: SearchScope) => {
      if (next === scope) return
      // Mode is the legacy name for the same choice; the analytics commit point lives there.
      handleFilterChange(scopeToMode(next))
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          params.set("scope", next)
          params.set("mode", scopeToMode(next))
          params.delete("list")
          return params
        },
        { replace: true },
      )
      window.scrollTo({ top: 0, behavior: "auto" })
    },
    [handleFilterChange, scope, setSearchParams],
  )
```

`handleFilterChange` already guards its analytics emission on results mode, so calling it from the feed is safe.

- [ ] **Step 4: Slot filter on product results**

In `mergedProductFilters`, add the scope's slot as the item type, mirroring `studioService.searchAlternatives`:

```ts
    return {
      ...productFilters,
      fits: merge(productFilters.fits, csv("fits")),
      feels: merge(productFilters.feels, csv("feels")),
      vibes: merge(productFilters.vibes, csv("vibes")),
      typeCategories: scopeSlot ? [scopeSlot] : productFilters.typeCategories,
    }
```

Add `scopeSlot` to the memo deps. The filter is part of the product results query key already (`serializeFilters`), so changing scope refetches.

- [ ] **Step 5: Every URL write carries scope and mode**

`updateUrlState`, `handleQuickSearch` and `handleSheetApply` each build a fresh `URLSearchParams`. In each, after `params.set("mode", ...)`, add `params.set("scope", scope)` (and where `mode` is set from an argument, set it from `scopeToMode(scope)` instead, dropping the `mode` argument from `handleQuickSearch` since the feed no longer calls it with a mode). Add `scope` to their deps.

- [ ] **Step 6: Piece tap goes to Studio focus**

Replace the body of `handleProductSelect`:

```ts
  const handleProductSelect = useCallback(
    (productId: string, slot: StudioProductTraySlot | null) => {
      const target = slot ?? scopeSlot ?? "top"
      navigate(buildStudioFocusUrl({ productId, slot: target, returnTo: originPath }))
    },
    [navigate, originPath, scopeSlot],
  )
```

Import `type StudioProductTraySlot` from `@/services/studio/studioService` if not already present. In `handleProductGridSelect` pass the result's own type: `handleProductSelect(item.id, isStudioSlot(item.type) ? item.type : null)` — `item.type` is on `ProductSearchResult`; make sure the mapped `productResultItems` carry `type` through (add `type: item.type` in that `useMemo` if it is not there), and import `isStudioSlot` from `@/features/studio/utils/studioUrlState`.

- [ ] **Step 7: Feed handlers**

Below `longPressOutfitSave` (near the end of the view function):

```ts
  const feedHandlers = useMemo<FeedHandlers>(
    () => ({
      onOpenLook: (look: FeedLook, layout, position) => {
        trackItemClicked(analytics, { entity_type: "outfit", entity_id: look.outfit.id, layout, position })
        void launchStudio(look.outfit)
      },
      onOpenPiece: (piece: FeedPiece, layout, position) => {
        trackItemClicked(analytics, { entity_type: "product", entity_id: piece.id, layout, position })
        handleProductSelect(piece.id, piece.slot)
      },
      isLookSaved: isOutfitSaved,
      onToggleLookSave: toggleOutfitSave,
      onLongPressLookSave: longPressOutfitSave,
      isPieceSaved: (id) => productSaveActions.isSaved(id),
      onTogglePieceSave: (id, next) => productSaveActions.onToggleSave(id, next, { layout: "vertical_grid" }),
      onLongPressPieceSave: (id) => productSaveActions.onLongPressSave(id, { layout: "vertical_grid" }),
    }),
    [analytics, handleProductSelect, launchStudio, productSaveActions],
  )
```

Check `useProductSaveActions` for the exact names of its saved-lookup and toggle functions (`grep -n "isSaved\|onToggleSave\|onLongPressSave" src/features/collections/hooks/useProductSaveActions.ts`) and match them. `isOutfitSaved`, `toggleOutfitSave`, `longPressOutfitSave` are already defined just above the return.

- [ ] **Step 8: Feed data and list navigation**

```ts
  const feed = useSearchFeed(scope, !isResultsMode)
  const handleOpenList = useCallback(
    (list: FeedList) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          params.set("list", list)
          return params
        },
        { replace: false },
      )
      window.scrollTo({ top: 0, behavior: "auto" })
    },
    [setSearchParams],
  )
  const handleCloseList = useCallback(() => navigate(-1), [navigate])
```

- [ ] **Step 9: Swap the JSX**

Replace the fixed top header block, the ghost block, and the content block (from `{/* The bar is the header. ... */}` through the closing of the `SearchResetState` branch) with:

```tsx
      {/* Scope rail is the header now. Fixed, ghost block under it. */}
      {openList ? null : (
        <div className="fixed inset-x-0 top-0 z-30 bg-background">
          <div className="mx-auto w-full max-w-[24.5rem] px-4 md:max-w-[47rem] lg:max-w-[62rem] xl:max-w-[78rem]">
            <SearchScopeRail value={scope} onChange={handleScopeChange} />
          </div>
        </div>
      )}
      <div className={cn("shrink-0", openList ? "h-2" : "h-[34px]")} aria-hidden="true" />

      <div className="mx-auto w-full max-w-[24.5rem] px-4 pb-[calc(56px+55px+16px)] md:max-w-[47rem] lg:max-w-[62rem] xl:max-w-[78rem]">
        {isResultsMode ? (
          <>
            {activeFilter === "products" ? renderProductResultsContent() : renderOutfitResultsContent()}
            <div ref={loadMoreRef} className="h-6 w-full" />
            {isFetchingMore ? <ResultsSkeleton kind={activeFilter} count={2} /> : null}
          </>
        ) : openList ? (
          feed.kind === "looks" ? (
            <SearchListPage kind="looks" title={openList === "hot" ? "Hot Styles" : "Atlyr Curations"} section={feed[openList]} heightCm={heightCm ?? 170} onBack={handleCloseList} handlers={feedHandlers} />
          ) : (
            <SearchListPage kind="pieces" title={openList === "hot" ? "Hot Styles" : "Atlyr Curations"} section={feed[openList]} heightCm={heightCm ?? 170} onBack={handleCloseList} handlers={feedHandlers} />
          )
        ) : (
          <SearchFeed sections={feed} heightCm={heightCm ?? 170} onOpenList={handleOpenList} handlers={feedHandlers} />
        )}
      </div>

      <SearchDock>
        <SearchBar
          mode={isResultsMode ? "results" : "idle"}
          value={searchTerm}
          onValueChange={handleSearchChange}
          onSubmit={() => {
            handleSubmit()
            ;(document.activeElement as HTMLElement | null)?.blur()
          }}
          onClear={handleClearAll}
          thumbSrc={uploadedImageUrl}
          onClearThumb={handleClearImage}
          onPickImage={handleImageUpload}
          isUploading={isUploading}
          onFilter={() => setIsFilterOpen(true)}
          onFindItems={handleFindItems}
        />
      </SearchDock>
```

`chip` / `onChipChange` are no longer passed, which hides the Products · Outfits segment. The sheets and drawers below stay untouched. `resolvedGender` and the old reset-state props can be deleted from this file if now unused (lint will say).

- [ ] **Step 10: Typecheck and lint the screen**

Run: `bun run typecheck 2>&1 | grep -E "SearchScreen"` → expected: no lines.
Run: `bun run lint 2>&1 | grep -A 30 "SearchScreen.tsx"` → expected: no new errors versus `git stash; bun run lint ...; git stash pop` on the same file (unused-var warnings for removed props are fixable; fix them).

- [ ] **Step 11: Run all search tests**

Run: `bun test src/features/search/utils/__tests__/scope.test.ts src/features/search/utils/__tests__/feedShaping.test.ts src/services/search/__tests__/browseProducts.test.ts src/features/studio/utils/__tests__/studioUrlState.test.ts`
Expected: all PASS.

- [ ] **Step 12: Manual check on the headless route**

Run `bunx vite --port 5199` in the background and open `http://localhost:5199/design-system/search`. Verify:
1. Scope rail on top, four chips, Looks active.
2. Hot Styles and Atlyr Curations rails show 3½ cards at 390 wide; ↗ opens a 2-col page with a back chevron; back returns to the feed.
3. Tapping Tops swaps all three sections to product tiles; For You paginates on scroll.
4. Search bar sits above the nav; typing and Enter shows the full-screen results grid with the rail still on top; × clears back to the feed.
5. Tap a product tile → `/studio?…Id=…&focus=…`; tap a look → `/studio?outfitId=…`. (Both need auth and are Naman's to verify on :8080.)
6. On a phone or DevTools device mode with the keyboard: the dock stays visible above the keyboard.
Stop the server.

- [ ] **Step 13: Commit**

```bash
git add src/features/search/SearchScreen.tsx
git commit -m "feat(search): scoped feed, bottom dock, piece taps open studio focus"
```

---

### Task 10: Docs, reviewers, final checks

**Files:**
- Modify: `docs/redesign/SEARCH_SCREEN.md`

- [ ] **Step 1: Rewrite the build notes**

Replace the "Layout at 390", "What is built where", "Data" and "Decisions and stubs" sections with the v2 content from the spec (§2, §3, §4, §6, §7, §9, §11), keeping the file's header and the "Unmounted, not deleted" convention. Add a line that the Products · Outfits segment is replaced by the scope rail and that `SearchResetState.tsx` is unmounted.

- [ ] **Step 2: Run the two repo reviewers on the diff**

Dispatch `supabase-layering-reviewer` on the branch diff (`git diff master...HEAD --stat` for the file list) and `posthog-spec-auditor` on the same. Expected: layering clean (all Supabase calls in `src/services`); tracking unchanged, `section` omitted, `layout` values locked. Fix anything they flag in the file it names.

- [ ] **Step 3: Baseline comparison**

Run: `bun run typecheck 2>&1 | tail -3` → expected: the same 7 baseline errors, none in touched files.
Run: `bun test src/features/search src/services/search src/features/studio/utils` → expected: new tests pass; pre-existing failures (listed in `CLAUDE.md`) unchanged.

- [ ] **Step 4: Commit and stop**

```bash
git add docs/redesign/SEARCH_SCREEN.md
git commit -m "docs(search): v2 build notes for the scoped feed"
```

Do not open a PR or push. Report the commit list and the six manual checks from Task 9 Step 12 to Naman; he tests on :8080 and shows the team before the PR.

---

## Self-review

- **Spec coverage:** §2 frame → Tasks 7, 8, 9. §3 scope rail and mode mapping → Tasks 1, 7, 9 (steps 2-5). §4 data → Tasks 4, 5 (trending depth, seed, curated pieces derivation). §5 results → Task 9 step 4 (slot filter) and step 9 (full-screen grid). §6 taps → Tasks 3, 9 (steps 6-7). §7 dock and keyboard → Task 8, Task 9 step 9 (blur on submit). §8 analytics → Task 9 step 7 (layout values, no section), Task 10 step 2 (auditor). §9 files → file map. §10 tests → Tasks 1-4; hook tests dropped for lack of a renderer, replaced by pure-function coverage. §11 decisions are unchanged inputs.
- **Placeholders:** none; every code step has its code. Two "check the exact name" notes (Bodoni title class, `useProductSaveActions` function names, `carouselPrev`) are lookups against files that exist, with the grep given.
- **Type consistency:** `FeedLook` / `FeedPiece` (Task 2) used unchanged in Tasks 5, 7, 9. `FeedSection<T>` / `FeedSections` (Task 5) match Task 7 props. `FeedHandlers` / `FeedList` / `FeedLayout` defined once in `SearchRail.tsx` and imported elsewhere. `buildStudioFocusUrl` signature identical in Tasks 3 and 9. `browseProducts` input `{ slot, gender, cursor }` identical in Tasks 4 (service, test, hook).
