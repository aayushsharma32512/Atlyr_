# Search screen v2 — feed, scope rail, bottom bar

Source: whiteboard (2026-09-11) + Naman's two footnotes. Supersedes the reset-state
half of `docs/redesign/SEARCH_SCREEN.md`. Results, filter sheet, saves, URL sync
and analytics from the first build carry over unless named below.

Route stays `/search`, third nav tab, nav 55h stays.

## 1. What changes, in one paragraph

The reset state becomes a feed: a **scope rail** (Looks · Tops · Lowers · Kicks)
on top, then **Hot Styles** (horizontal rail, 3½ cards visible, expands to a
full-page 2-col grid), **Atlyr Curations** (same shape), and **For You** (2-col,
vertical, infinite). The **search bar moves to the bottom**, docked above the nav.
A search replaces the whole page with a full-screen infinite 2-col grid. Tapping a
product opens Studio **in focus** on that piece; tapping a look opens Studio on
the **full figure**.

## 2. Frame at 390 × 844 (reset state)

| Row | Height | Content |
|---|---|---|
| Scope rail | 34 | Four chips, 26h, gap 6, 16px gutters. Active = ink fill. Fixed at top with a ghost block under it |
| Hot Styles | header 20 + rail 136 | `SectionHeader` with ↗ (`ArrowUpRight`, 16px) on the right. Rail: 96w cards, gap 8, 16px lead gutter, free scroll, no snap |
| Atlyr Curations | same | same |
| For You | header 20 + grid | 2 col, gap 8, `OutfitCard` 250h / `ProductTile` default (215h). Sentinel-driven infinite scroll |
| Search bar | 40 + 16 pad | Fixed, `bottom: 55px`, cream ground, hairline top. `SearchBar` unchanged internally |
| Nav | 55 | unchanged |

Section gap 20 (matches `CuratedCollectionRows`). Page bottom padding = bar + nav
so the last row clears the dock.

**Rail cards (96 wide).** 3.5 × 96 + 3 × 8 = 360 ≈ the 358 content width, so the
fourth card is cut at the gutter, which is what "3½ visible" asks for.
- Looks: `OutfitCard` figure only, no 40h footer at this width. New prop
  `footer?: boolean` (default true) on `OutfitCard`. Card = 96 × 136.
- Pieces: `ProductTile size="small"` (square, no footer) = 96 × 96, top-aligned
  in the same 136 track so both rails share one height.

**Full-page view** (`?list=hot` or `?list=curations`): header 32h, back chevron
+ Bodoni title ("Hot Styles" / "Atlyr Curations"); then a 2-col grid of the same
items at full size, infinite where the source paginates. The scope rail is hidden
here; the bar and nav stay. Back returns to the feed (a param on the same route,
so the browser restores scroll).

## 3. Scope rail

`?scope=looks|tops|lowers|kicks`, default `looks`. Persisted in the URL so Studio's
`returnTo` lands back on the same scope.

| Scope | Feed shows | A search runs as |
|---|---|---|
| looks | outfits | outfit search (`mode=outfits`) |
| tops | products, slot `top` | product search, `mode=products`, slot filter `top` |
| lowers | products, slot `bottom` | product search, slot filter `bottom` |
| kicks | products, slot `shoes` | product search, slot filter `shoes` |

The slot filter is the same slot → `item_type` merge into `ProductSearchFilters`
that `studioService.searchAlternatives` does for the rack. No edge-function change.

**The rail replaces the Products · Outfits chip segment.** Same destination, one
control (COMPONENTS law 5). `SearchBar` keeps its `chip` props for other callers;
Search simply stops passing them. The legacy `mode` URL param is still written
(derived from scope) so old links, analytics `mode`, and `returnTo` strings keep
working. A URL with `mode` but no `scope` maps `outfits` → `looks`, `products` →
`tops`.

Filter sheet stays reachable from the bar's filter icon in both feed and results.

## 4. Data per section

| Section | Looks | Tops / Lowers / Kicks |
|---|---|---|
| Hot Styles | `useHomeAllOutfits("relevance")`: rating-sorted, paginated. Rail shows the first 12; the full page is the same infinite query | `useTrendingProducts()[slot]`: pieces ranked by how many public looks they appear in. `perSlot` raised 20 → 40 so the full page has depth. Finite |
| Atlyr Curations | `useSearchBrowseCollections()` flattened across collections, deduped by outfit id, collection order kept. Finite | Pieces worn in those curated looks: from each `SearchBrowseOutfit.studioOutfit.renderedItems`, take the item for the slot, dedupe by product id, keep first-seen order. Derived in `select`, no new query |
| For You | `useHomeCuratedOutfits(seed)`: seeded shuffle, infinite. Seed = per-session value in `sessionStorage` (`search.feedSeed`), minted on first visit, so back-navigation is stable and the next session differs | **New** `searchService.browseProducts({ slot, gender, cursor })`: plain `products` query, `type = slot`, gender in (profile gender, unisex, null), `image_url` not null, `created_at desc`, `range(cursor, cursor + 23)`. New key `searchKeys.browseProducts(slot, gender)`, new hook `useSearchBrowseProducts` (`useInfiniteQuery`, 24/page, `staleTime` 5 min) |

Every feed hook is `enabled` only for its active scope, so switching scope does not
fan out four queries. Rail queries share keys with their full-page views, so
opening ↗ is instant.

## 5. Results (after a search)

- Full-screen: the feed unmounts; the results grid takes the whole scroll area
  under the scope rail. Existing skeleton / no-results / error cards stay.
- Infinite scroll: existing `loadMoreRef` sentinel. Outfit search still returns a
  single fixed page from `search-outfits-v2` (`nextCursor: null`). Backend limit,
  unchanged here.
- Product results are already slot-filtered by scope; the old client-side
  collection filter still applies on top.

## 6. Tap targets

| Tap | Goes to |
|---|---|
| Look (rail, full page, For You, results) | `useLaunchStudio(outfit)` → `/studio?outfitId=…&topId=…&returnTo=`: full figure. Unchanged |
| Piece (rail, full page, For You, results) | **Studio focus**: `/studio?<slot>Id=<productId>&focus=<slot>&returnTo=<here>`. Studio's cold-start effect injects the user's last look; the `<slot>Id` param overrides that slot; `focus` zooms the zone and raises the `ProductSheet` dock. Slot = the scope's slot in scoped views, else the product's `type` |

The product page (`/studio/product/:id`) is no longer opened from Search. The
route, screen and its nav-highlight logic stay for Collections.

New helper `buildStudioFocusUrl({ productId, slot, returnTo })` in
`features/studio/utils/studioUrlState.ts` owns this URL so Collections can adopt
it later.

## 7. Bottom bar

- Wrapper: `fixed inset-x-0 bottom-[55px] z-30 bg-background border-t border-hairline`,
  inner `max-w` + 16px gutters as today, `py-2`. Ghost spacer at the page end.
- Keyboard: while the input is focused the bar tracks `window.visualViewport`
  (`bottom = layoutHeight − vv.height − vv.offsetTop + 55`), reset on blur. Small
  hook `useDockAboveKeyboard(ref)` in `design-system/utils`. Verified on iOS
  Safari and Android Chrome before PR.
- Submitting blurs the input so the keyboard drops and results are visible.
- Results-mode extras (clear ×, Find items globe) behave as before.

## 8. Analytics

Surface stays `search_results` for `/search` (pathname-keyed), so no new
surface. `?scope` and `?list` are query-only changes and do not rotate it.
- Rails emit `items_seen_summary` with `layout=horizontal_rail`; grids use
  `vertical_grid`. `section` is **omitted**: there is no locked value for Search
  and we do not add one.
- `item_clicked` unchanged; `entity_type` product / outfit as today.
- `search_submitted.mode` keeps `products|outfits` from the scope mapping.
- No change to `ENGAGEMENT_TRACKING_SPEC.md` expected. `posthog-spec-auditor`
  runs on the diff to confirm.

## 9. Files

New:
- `features/search/components/SearchScopeRail.tsx`: the four chips.
- `features/search/components/SearchFeed.tsx`: Hot / Curations / For You.
- `features/search/components/SearchRail.tsx`: header + 96w card rail, generic
  over looks or pieces.
- `features/search/components/SearchListPage.tsx`: full-page 2-col for a rail.
- `features/search/components/SearchDock.tsx`: the fixed bottom bar wrapper.
- `features/search/hooks/useSearchFeed.ts`: per-scope selection of the three
  sources; returns `{ hot, curations, forYou }`, each `{ items, isLoading,
  fetchNextPage?, hasNextPage? }` in one card-ready shape.
- `features/search/hooks/useSearchBrowseProducts.ts` + `searchService.browseProducts`.
- `features/search/utils/scope.ts`: `SearchScope` type, slot map, mode map, URL
  parse/build. Pure, tested.
- `design-system/utils/useDockAboveKeyboard.ts`.

Changed:
- `SearchScreen.tsx`: render `SearchScopeRail` + (`SearchListPage` | `SearchFeed`
  | results) + `SearchDock`; scope → mode plumbing; product tap → focus URL.
- `design-system/primitives/outfit-card.tsx`: `footer` prop.
- `features/studio/utils/studioUrlState.ts`: `buildStudioFocusUrl`.
- `services/collections` trending `perSlot` default 40.
- `features/search/queryKeys.ts`: `browseProducts`.
- `docs/redesign/SEARCH_SCREEN.md`: rewritten to describe v2.

Unmounted, not deleted (additive rule): `SearchResetState.tsx`,
`CuratedCollectionRows` on this screen, the occasion chip row, the trending
prompt tiles.

## 10. Tests

- `scope.test.ts`: parse/build, mode fallback, slot map.
- `searchService.browseProducts`: mocked Supabase chain — filters, range, cursor.
- `useSearchBrowseProducts`: `renderHook` + `QueryClientProvider`, next-page cursor.
- `useSearchFeed`: curated-pieces derivation from `renderedItems` (dedupe, slot
  pick, order).
- `studioUrlState.buildStudioFocusUrl`.
- Manual: `/design-system/search` on `bunx vite --port 5199`; on-device keyboard
  check for the dock.

## 11. Decisions and assumptions to confirm

1. **Rail card width 96 (3½ visible)** instead of the bundle's 150 × 210. Taken
   from the whiteboard. Looks at 96 wide lose the footer name.
2. **Rail replaces the Products · Outfits segment.** If you want both, it is a
   one-line revert in `SearchScreen`.
3. **Copy**: "Lowers" and "Kicks" are not in the brief §2.3 whitelist. Used as
   written on the board; swap to "Bottoms" / "Shoes" if the team objects.
4. **For You (looks)** = seeded shuffle, not newest-first. Newest-first is a
   one-token change (`useHomeAllOutfits("newly_added")`).
5. **Atlyr Curations** = the existing browse collections, flattened. There is no
   house-curated *products* table, so pieces are derived from those looks.
6. **Product tap skips the product page.** The page still exists for Collections.
7. Outfit search stays single-page (backend cap). Not fixed here.
