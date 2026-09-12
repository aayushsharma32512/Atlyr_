# Search screen — build notes

Screen 2 of the migration (after Collections). Source of truth: `05 Search.dc.html`,
`SearchBar.dc.html`, `CuratedCollectionRows.dc.html` in the design bundle, the brief §10,
`COMPONENTS.md` §5 / §8, and the whiteboard of 2026-09-11
(`docs/superpowers/specs/2026-09-11-search-feed-design.md`), which rebuilt the reset state
into a feed. `design.md` wins any conflict on what's left of the original brief; the
whiteboard wins on the feed, scope rail and dock; the code in the working tree wins over
both where they differ.

Route: `/search`, third nav tab. Nav (55h) stays. The bar now docks above the nav instead
of sitting at the top.

## Layout at 390

| Row | Spec |
|---|---|
| Scope rail | 34h, fixed top, `role="group"`. Four `aria-pressed` `Chip`s (Looks · Tops · Lowers · Kicks), gap 6, active = ink fill. Ghost spacer under it |
| Hot Styles | 20h header (`SectionHeader`, ↗ action) + 136h rail. 96w cards, gap 8, free scroll, no snap, 3½ visible |
| Atlyr Curations | same shape as Hot Styles |
| For You | 20h header + 2-col grid (`OutfitCard` 250h / `ProductTile` 215h), gap 8. Sentinel-driven infinite scroll |
| List page (`?list=hot|curations`) | 32h header (back chevron + Bodoni title), then the same items as a full 2-col grid. Scope rail hidden; bar and nav stay |
| Dock | 40h field + 16 py, fixed above the nav, hairline top. Tracks the keyboard when open |
| Nav | 55h, unchanged |

Content bottom padding is 127px (56 dock + 55 nav + 16 breathing room), so the last row
clears the dock. Results mode replaces the feed with a full-screen 2-col grid under the
scope rail; no count header, no boards shelf.

## Scope

`?scope=looks|tops|lowers|kicks`, default `looks`. One control for what the feed shows and
what a search returns — it replaces the old Products · Outfits chip segment (`SearchBar`
keeps its `chip`/`onChipChange` props for other callers; Search stops passing them).

| Scope | Feed | Search mode | Slot |
|---|---|---|---|
| looks | outfits | outfits | — |
| tops | products | products | `top` |
| lowers | products | products | `bottom` |
| kicks | products | products | `shoes` |

The slot merges into `ProductSearchFilters.typeCategories` the same way
`studioService.searchAlternatives` merges a slot for the rack — no edge-function change.
It overrides a filter-sheet Category pick while scoped (`mergedProductFilters` in
`SearchScreen.tsx`).

The legacy `mode` param is still written next to `scope` (`scopeToMode`), and is also kept
in the search session-restore state (`sessionStorage`). A `mode`-only link (no `scope`)
maps `products` → `tops`, `outfits` → `looks` (`resolveScope`).

## What is built where

New:
- `features/search/utils/scope.ts` — `SearchScope`, chip labels, scope↔slot↔mode maps,
  `resolveScope`. Pure, tested.
- `features/search/utils/feedShaping.ts` — turns raw hook data into `FeedLook[]` /
  `FeedPiece[]`: `flattenBrowseLooks`, `piecesFromBrowseLooks`, `looksFromHomeEntries`,
  `piecesFromTrending`, `piecesFromSearchResults`, `readFeedSeed`.
- `features/search/hooks/useSearchFeed.ts` — per-scope selection of Hot / Curations / For
  You, one `FeedSections` shape (`kind: "looks" | "pieces"`). Only the active scope's
  queries run.
- `features/search/hooks/useSearchBrowseProducts.ts` + `searchService.browseProducts` —
  For You for product scopes: plain `products` query, `type = slot`, gender in (profile
  gender, unisex, null), `image_url` not null, newest first, 24/page.
- `features/search/components/SearchScopeRail.tsx` — the four chips.
- `features/search/components/SearchRail.tsx` — header + 96w rail, generic over looks or
  pieces (`SearchRail`/`FeedHandlers`/`FeedList`/`FeedLayout` types live here).
- `features/search/components/FeedGrid.tsx` — the shared 2-col grid + skeleton. Used by
  `SearchFeed` (For You) and `SearchListPage`. Shows "Nothing here yet." when empty.
- `features/search/components/SearchFeed.tsx` — Hot / Curations rails + For You grid,
  sentinel-driven `fetchNextPage`.
- `features/search/components/SearchListPage.tsx` — a rail's full page.
- `features/search/components/SearchDock.tsx` — the fixed bottom bar wrapper.
- `design-system/utils/useDockAboveKeyboard.ts` — bottom offset from `visualViewport`.

Changed:
- `SearchScreen.tsx` — scope plumbing, dock, list page, piece tap now goes through
  `buildStudioFocusUrl`.
- `design-system/primitives/outfit-card.tsx` — `footer?: boolean` (default true).
- `design-system/primitives/product-tile.tsx` — `size="small"`, `cropToContent`.
- `features/studio/utils/studioUrlState.ts` — `buildStudioFocusUrl`, `parseStudioPath`.
- `services/collections/collectionsService.ts` — `fetchTrendingProducts` `perSlot`
  default raised 20 → 40.
- `features/search/queryKeys.ts` — `browseProducts`.

## Data

| Section | Looks | Tops / Lowers / Kicks |
|---|---|---|
| Hot Styles | `useHomeAllOutfits("relevance")`, first 12 on the rail, same infinite query on the full page | `useTrendingProducts()[slot]`, `perSlot` 40, finite |
| Atlyr Curations | `useSearchBrowseCollections()` → `flattenBrowseLooks`, finite | `useSearchBrowseCollections()` → `piecesFromBrowseLooks(slot)`, derived in `useSearchFeed`, no new query |
| For You | `useHomeCuratedOutfits(seed)`, seed minted once per session in `sessionStorage` (`atlyr:search:feedSeed`) | `useSearchBrowseProducts({ slot })` → `searchService.browseProducts`, infinite, 24/page |
| Results | `useSearchOutfitResults` / `useSearchProductResults` (unchanged) | same |
| Filters | `useProductFilterOptions` (unchanged); sheet shows Category, Gender, Fit, Feel, Vibe, Boards | same |

Every feed hook is `enabled` only for the active scope's kind, so switching scope does not
fan out four queries at once.

## Taps

- Look (rail, list page, For You, results) → `useLaunchStudio(outfit)`: full figure.
  Unchanged.
- Piece (rail, list page, For You, results) → Studio **focus**. `SearchScreen` reads the
  nav's remembered Studio path via `readStudioLastPath(gender)`, parses its `outfitId` and
  slot ids with `parseStudioPath`, and `buildStudioFocusUrl({ productId, slot, returnTo,
  outfitId, slotIds })` wears the piece in its slot on that look with `?focus=<slot>`. If
  nothing is remembered, Studio's cold-start restore picks a look. `StudioScreen`'s
  "slot emptied while focused" guard waits for the look and its slots to load before
  closing focus, so a deep-linked focus survives the fetch. Slot = the scope's slot when
  scoped, else the product's `type`.
- The product page (`/studio/product/:id`) is no longer opened from Search. Route, screen
  and nav-highlight logic stay for Collections.

## Dock and keyboard

`SearchDock` is `fixed inset-x-0`, bottom set by `useDockAboveKeyboard(NAV_HEIGHT)`: while
the input is focused it tracks `window.visualViewport` and sits on the keyboard edge;
on blur it resets to 55 (above the nav). Submitting blurs the input so the keyboard drops.
Results-mode extras (clear ×, Find items globe) behave as before.

## Analytics

Surface stays `search_results` for `/search` (pathname-keyed); `?scope` and `?list` are
query-only and do not rotate it.
- A lateral scope change between product scopes (tops/lowers/kicks) while results are
  showing emits `search_submitted` with the locked trigger `filters_apply`; looks↔products
  still goes through `mode_change`. `filters` canonicalise the merged product filters,
  which carry the scope slot as `typeCategories`. No new events, no `section`.
- `item_clicked` unchanged; `entity_type` product / outfit as today.
- `search_submitted.mode` keeps `products|outfits` from the scope mapping.
- Feed rail and grid impressions are not wired to `items_seen_summary` yet — only the
  results grid observes cards (`observeSearchResultsCard` in `SearchScreen.tsx`). The
  whiteboard's `layout=horizontal_rail` / `vertical_grid` split for the feed is not built.
- No change to `ENGAGEMENT_TRACKING_SPEC.md`.

## Decisions and stubs

- Rail card width 96 (3½ visible), not the bundle's 150 × 210. Looks at 96 wide lose the
  footer name (`OutfitCard footer={false}`).
- Scope rail replaces the Products · Outfits segment; reverting is a one-line change in
  `SearchScreen`.
- "Lowers" and "Kicks" are not in the brief §2.3 whitelist. Used as written on the board.
- For You (looks) is a seeded shuffle, not newest-first; a one-token change to
  `useHomeAllOutfits("newly_added")` would switch it.
- Atlyr Curations is the existing browse collections, flattened. There is no house-curated
  products table, so pieces are derived from those looks' rendered items.
- Outfit search stays single-page: `search-outfits-v2` returns a fixed page
  (`nextCursor: null`), a backend cap, not fixed here.
- Brand, type-category and price groups are not shown in the filter sheet (brief §12.3).
  Code paths remain.
- Community feed is not filtered by a public flag — `outfits.is_public` (brief §12.8)
  does not exist yet.
- Find items goes to `/inspiration-import` until `useOpenFindItems` lands (phase 6).
- Sort is gone from the UI (brief: no sort). State stays at "similarity".

Unmounted, not deleted: `SearchResetState.tsx`, `CuratedCollectionRows` on this screen,
occasion chips, trending prompt tiles, the Products · Outfits chip segment on `SearchBar`
(props kept for other callers).
