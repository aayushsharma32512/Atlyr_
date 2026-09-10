# Search screen — build notes

Screen 2 of the migration (after Collections). Source of truth: `05 Search.dc.html`,
`SearchBar.dc.html`, `CuratedCollectionRows.dc.html` in the design bundle, the brief §10,
and `COMPONENTS.md` §5 / §8. `design.md` wins any conflict.

Route: `/search`, third nav tab. Nav (55h) stays. The header is the search bar itself.

## Layout at 390

| Part | Spec |
|---|---|
| Bar | 40h white field, hairline, radius 3, 16px gutters. Leading filter (32×32). Then thumb chip (photo search) or nothing. Input 14/400. Trailing: clear X (results + text), camera (no thumb), globe = Find items (results only), ink 32×32 search square. |
| Segment | Results only. Products · Outfits chips (26h), active = ink fill. Sits 8px under the bar. |
| Reset | 34h chip row (occasions, outline, gold ✦ only on Handloom) → Trending now (150×86 dark tiles, cream name bottom-left) → curated rows (150×210 outfit cards, one row per collection) → From the community (2-col, 250h, maker first name under the title). |
| Results | 2-col grid, gap 8. Products = `ProductTile` (square + 40h footer = 215h). Outfits = `OutfitCard` at 250h. No count header, no boards shelf. |
| Filter sheet | Bottom sheet from 180px. Handle, active chips (ink fill + X), 44h group rows with chevron. Open group = 36h inline search, top-match chips, 2-col checkbox grid. Footer: Clear (40h outline) + Apply (44h terracotta — the screen's one fill). |
| States | Shimmer blocks (215h). No results = dashed card: query line + dashed "Find items" button. Error = muted card with a restore icon button. |

## What is built where

- `design-system/primitives/search-bar.tsx` — `SearchBar` (mode idle / results, chip segment, thumb, callbacks).
- `design-system/primitives/chip.tsx` — `Chip` 26h outline / on, optional gold mark and remove X.
- `design-system/primitives/outfit-card.tsx` — `OutfitCard`: figure area (Studio renderer, same path as `MoodboardCard`), pin top-right, 40h footer with name, optional `by` line.
- `design-system/primitives/curated-collection-rows.tsx` — section label + rail of `OutfitCard`s.
- `features/search/components/SearchResetState.tsx` — chips, trending, curated rows, community grid.
- `features/search/components/SearchFilterSheet.tsx` — the sheet above, fed by the existing filter categories.
- `features/search/components/SearchResultStates.tsx` — skeleton, empty, error cards.
- `features/search/SearchScreen.tsx` — keeps URL sync, analytics, saves, pagination. JSX swapped to the parts above.

Unmounted, not deleted: `SearchRoomScreen.tsx`, `FilterSearchBar` on this screen.

## Data

| Surface | Hook |
|---|---|
| Occasion chips | `useSearchFacets()` → occasion group |
| Trending now | hardcoded prompts (no curated source yet) — tap runs the prompt as an outfit search |
| Curated rows | `useSearchBrowseCollections()` |
| Community | `useHomeAllOutfits("newly_added")`, first name from `outfit.created_by` |
| Results | `useSearchProductResults` / `useSearchOutfitResults` (unchanged) |
| Filters | `useProductFilterOptions` (unchanged); sheet shows Category, Gender, Fit, Feel, Vibe, Boards |

## Decisions and stubs

- Chip tap = search for that occasion in outfits mode. Filter with nothing typed = Apply seeds the query from the picked words (what the old search room did) and lands on products.
- Sort is gone from the UI (brief: no sort). State stays at "similarity".
- Brand, type-category and price groups are not shown in the sheet (brief 12.3). Code paths remain.
- Community feed is not filtered by a public flag — `outfits.is_public` (12.8) does not exist yet.
- Find items goes to `/inspiration-import` until `useOpenFindItems` lands (phase 6).
- Trending prompts are hardcoded, like Products › Trending on Collections.
