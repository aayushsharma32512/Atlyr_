# Studio screen — build notes

Screen 3 of the migration (after Collections and Search). Source of truth:
`04 Studio.dc.html` (identical to the Studio section of `08 Full View.dc.html`),
`ProductSheet.dc.html`, `SlotRow.dc.html`, `ProductCard.dc.html`,
`SearchBar.dc.html`, `Figure.dc.html`, and the interactive prototype
`Atlyr App.dc.html` — the only bundle file with real behaviour. Plus brief §6/§7
and `COMPONENTS.md` §1/§4/§5/§7. `design.md` wins any conflict; `DESIGN_NOTES.md`
overrides the brief on behaviour.

Routes: `/studio` (landing and focus) and `/studio/alternatives`.

The design has no nav on Focus or Alternates. We keep it on all three: the nav is
5 tabs by decision (see the redesign notes), and it is rendered by
`AppShellLayout`, which `StudioLayout` wraps. Every Studio frame therefore
reserves `calc(100dvh - 55px)` — the old `2.5rem` left content 15px underneath
the fixed 55h bar.

## Frames at 390 × 844

| Screen | Rows | Nav |
|---|---|---|
| Landing | header 52 · container 567 · card 170 · nav 55 | yes |
| Focus | header 52 · container 567 · sheet dock 225 | no |
| Alternates | header 52 · (figure 50% ∣ rack 50%) 564 · piece card 225 | no |

The card is `flex-none` and the container `flex-1` — never hard-coded. With the
layer slot on, the landing card grows to 204 and the container flexes to 533.

## Landing

**Header 52h.** Back chevron only, plus the focus exit on the right. The artboard
draws an Import pill there; it is **not** built. The try-on job pill takes that
spot while a job runs.

**No category rail here** (Bipin/Naman, Sep 2026). It was tried as a vertical
rail on the canvas's left edge, then in the header, then above the slot rows, and
read badly in all three. The slot rows already reach Alternates for every
category, so the rail was a second control for the same destination —
COMPONENTS.md law 5. `CategoryRail.tsx` stays on disk, unrendered, for whenever
it is wanted again.

This matches the artboard, which draws no such rail on the landing. On Alternates
the categories do exist, as the artboard's own 36h row at the top of the rack —
that column has the room and it costs the figure nothing.

**Container.** Figure edge to edge, plus two groups of 32px discs at a 12px
inset: History (Undo over Redo) bottom-left, Look (Reset over Share)
bottom-right. Nothing overlaps the figure's torso.

`Shuffle` is gone (brief §6.2) — `useStudioRemix` stays on disk, unused.

**Card 170h**, 10px 16px inset, sitting directly on the cream ground with no
white card (DESIGN_NOTES). Three `SlotRow` primitives (32h, gap 2), then the
action bar.

**Action bar.** `[pin 40×40] [Try on — terracotta, flex-1] [Find items — dashed,
flex-1]`, 44h, gap 8. Try on is the screen's one fill. No price, no brand, no
receipt stub.

**Gestures.** Two doors, no overlap: a garment **on the figure** focuses; a
**row** (anywhere, or its `⊞`) opens Alternates; `×` removes. This follows
DESIGN_NOTES ("tapping anywhere on a filled ProductRow opens Alternates") over
brief §6.4, which has the row body focusing.

## Focus — `?focus=slot`, in place

A URL param on `/studio`, not a route, so Back exits focus without leaving Studio
and share links carry it. `resolveSurface` keys on pathname only
(`surface.ts:99`), so the surface stays `studio_main`: **no tracking change, no
`ENGAGEMENT_TRACKING_SPEC.md` edit.**

The container keeps its 567. The figure grows inside it so the zone fills the
frame.

Zoom geometry is a **static per-zone band** (`FOCUS_BANDS` in `StudioCanvas`),
expressed as a fraction of figure height. Deriving it from the worn item's
`placementY` / `imageLength` would need `pxPerCm`, `chinOffsetPx` and
`globalTopOffsetPx`, which are internal to `AvatarRenderer` and not exposed
through `OutfitInspirationTile`. Static bands frame the zone without depending on
placement data being present, which unplaced products do not have. Exact bounds
via `onItemBoundsChange` is a follow-up if the framing reads loose.

The window is `1 / zoom` of the figure, and when it is taller than its band the
slack spills past the anchored edge. Bottoms anchor on the ankle, so at the
shared 2.2 cap that slack all landed on the top's hem: a band of 0.44–0.84 was
shown as 0.386–0.84. Bottoms now run 0.53–0.90 with their own 2.7 cap, so
the window is 0.530–0.900 and the hem is out of frame. The cap stays near 2.7:
above that, wide-leg trousers clip at the sides, since the box scales in both
axes. Raising the shared cap instead would have retuned the shoes zoom, which is
already settled. Resulting windows: top 0.080–0.535, bottom 0.530–0.900, shoes
0.693–1.147, the last deliberately running past the feet onto ground.

**The zoom is layout, never a CSS transform.** `OutfitInspirationCard` sizes
itself from `parentElement.getBoundingClientRect()` inside a `ResizeObserver`
(`OutfitInspirationCard.tsx:314`). That rect includes ancestor transforms, but
the observer only fires on layout changes — so a scaled ancestor made the figure
scale a second time on the way in, and never re-measured on the way out, leaving
the canvas stuck zoomed. `focusBox()` grows the figure's box instead
(`width`/`height`/`left`/`top`), which the observer tracks in both directions.
The 220ms `ease.inOut` is dropped with it: animating those properties would
re-run the observer every frame.

Header right becomes `Minimize2` (exit focus). Both control stacks hide. Starting a try-on clears focus. The `layer` zone focuses to the same band
as `top`.

A 225 dock slides up **covering the slot rows and the action bar**, carrying
`ProductSheet`:
`corner="alternatives"`, `actions="icons"` (Save · Try on · Find items),
`mediaSize=176`. Details tap opens Alternates for the slot.

**Two movements, deliberately separate:**

- The chevrons inside the image frame step through **that product's photos** —
  `ProductSheet`'s existing carousel, per the bundle.
- A horizontal **swipe on the sheet** steps to the **next worn piece**
  (top → bottom → shoes → layer), and the figure re-zooms to the new zone.

## Alternates

Layout follows the artboard's split, not brief §7's stacked version.

| Part | Spec |
|---|---|
| Header 52 | Back chevron left; source segment right, 195 wide — hanger · pin · globe (Wardrobe · Saves · Explore), 26h, flex-1, active = 2px ink underline, no fill. Persists in URL `source`, default Explore |
| | The existing `RackMode` values map straight across: `yours`→Wardrobe, `saves`→Saves, `alternates`→Explore (brief §7). The URL carries the new names; `RackMode` itself is unchanged |
| Figure pane | Left 50%, hairline right. Carries the same two control stacks as the landing: Undo/Redo bottom-left, Reset/Share bottom-right |
| Slot icons 36 | Top of the rack column, under the source segment, as the artboard draws it. Top · Bottom · Shoes (· Layer), flex-1, active = 2px ink underline |
| Query line 34 | Tops the rack when a search or similarity is active. One ellipsised line + a clearing × |
| Rack | 2 columns, gap 6, 8px inset. `ProductTile size="small"` |
| Web search | Closes the **catalogue** rack only (`source === "explore"`): a full-width dashed row, 44h, centred globe + "Web Search". It means "not in the catalogue? look on the web", which says nothing under an empty Wardrobe or Saves. Drawn per design, **disabled** — see Stubs |
| Search bar | Collapsed 40×40 at the rack's bottom-right; expands over the rack. See below |
| Piece card 225 | 10px 16px inset. The Focus card with `corner="similar"` |

**The two stacked segments read as one doubled rail until the icons differ.**
The source segment is 195px right-aligned in the header — exactly the rack column
width — so the slot row sits directly beneath it. That is the artboard's own
arrangement and it works, but only because Wardrobe is a **hanger**. The registry
had `sourceWardrobe: Shirt` behind a TODO, which is also `slotTop`, so the same
glyph appeared twice one above the other. `HangerGlyph` (path lifted from the
bundle's own segment) is now in `icons/glyphs.tsx` and the two rows are legible.

The 50/50 split is kept as designed.

**The piece card's globe is the commercial exit.** Where the piece has a
`productUrl` it opens that listing in a new tab (`trackProductBuyClicked`);
without one it falls back to Find items. This is what `icons.ts` means by
`findItems: Globe // replaces "Buy" everywhere` — on a card about one specific
product, the web is that product's listing. The action bar's globe on the canvas
is still Find items for the whole look.

**The piece card is one component with Focus.** Only the corner differs: Focus
carries the 4-square (open Alternates); Alternates carries `⟳` — an
image-similarity search off the worn piece's image, surfaced as a clearable
"Similar to this item" line in the query row. This is the bundle's own
`altQueryOn` / `altQueryLine` behaviour and DESIGN_NOTES' "similar to this item".

**Rack order is never reshuffled.** Three deletions in
`StudioAlternativesScreen.tsx`:

- the "pin the currently selected product to the front" splice (~L300–306)
- the client-side sort switch (~L284–291)
- the sort control, `sortValue`, `sortOptions`, `handleSortChange`

Order is whatever `search-v2` returned. The worn item is marked in place — 2px
ink ring + `✓` disc — not moved. Brief §7 kills sort outright.

## Search bar and the reference-image dialog

Three states, from the `Alternates` / `Alternates search` / `Alternates camera`
artboards:

| State | Spec |
|---|---|
| Inactive | 40×40 lens button, `right:8 bottom:8` of the **rack pane**, translucent white |
| Active | 40h field spanning the **whole frame** — `left:8 right:8` of 390, not of the rack column — sitting 8px above the keyboard. The collapsed lens hides. Leading `ListFilter`; then the thumb chip when a reference is set; input; clear ×; camera; ink 32×32 submit square |

The two states live in different boxes, so `open` is held by the screen rather
than the component: the button is a child of the rack column, the open bar a
child of the frame. `AlternatesSearchDock.tsx` exports both halves.

The bar is offset by `visualViewport`, never `position:fixed; bottom:0` — iOS
Safari does not move fixed elements with the keyboard (brief §2.6). The keyboard
drawn in the artboard is a mock (blank spans, no letters); its 291px is one
device and never appears in code. The OS keyboard is the only one — the 8px gap
above it is the real constant.

**Dismissing it.** Brief §7: "× at the right closes". That × is always present,
not only when text has been typed: the collapsed lens hides while the bar is
open, so an empty field otherwise left no way out. Escape and a submit also
close. **Blur does not**, though the brief lists it — the reference-image dialog
opens from this bar and takes focus, and the picked photo has to land back in
the field as a chip, so closing on blur would tear the bar away mid-flow.
Clearing a *committed* search stays the query line's job.
| Dialog | Overlay `rgba(46,42,36,.5)`; card inset 32, cream, radius 6, padding 12, gap 8 |

The dialog is a **two-option picker** — DESIGN_NOTES' "keep current piece ·
replace with photo" — over two 1:1 tiles, with a 44h terracotta **Apply** below:

- **Left, selected by default** — the worn item's `thumbnailUrl` on a 2px ink
  border. The prototype draws a cropped mannequin here; we use the item
  thumbnail, matching the inspiration-import pipeline.
- **Right** — dashed tile holding a centred 44×44 white camera button that opens
  the browser file picker. Picking a photo fills the tile and moves the ink
  border to it.

Apply commits the selected tile as the reference and closes; the thumb chip then
appears in the field beside the ×. Chip × clears it. The rack stays visible
behind a `rgba(46,42,36,.5)` scrim.

## Layering — built, flagged off

`LAYERING_ENABLED = false` in `features/studio/constants/layering.ts`, mirroring
the bundle's own `altLayerOn: false`. Off, nothing renders and nothing changes.

A layer is a **second `top`-type product in a client-side zone**, which is why
the prototype can swap layer and top freely. No migration: the `item_type` enum
(`top | bottom | shoes | accessory | occasion`) is untouched, and
`StudioProductTraySlot` stays 3-wide in the service layer. The studio feature
adds `StudioCanvasSlot = StudioProductTraySlot | "layer"`; a layer query asks for
`top`.

On, it adds:

- a 4th `Layers` disc in the category rail and a 4th icon in the Alternates slot row
- a 4th slot row labelled **"Layer over top"**, dashed when empty
- a swap control on that row when both layer and top are filled, flipping which
  garment sits on top

Rendering needs no renderer change at all. `AvatarRenderer` groups items by zone
and stacks within a zone as `baseZ + index` (`AvatarRenderer.tsx:600`), while
`slotOrder` only orders the zones against each other, earlier = higher
(`:617-621`). So the layer is simply the **second item in the `top` zone**, later
in the array, and lands above the base top on its own. `slotOrder` stays 3-wide
and `StudioRenderedZone` is untouched.

`DESIGN_NOTES.md` records that Bipin removed layering in Sep 2026. The flag keeps
that decision intact until the team reverses it; flipping the constant is the
whole reversal.

## What is built where

**New**

| File | What |
|---|---|
| `features/studio/constants/layering.ts` | `LAYERING_ENABLED`, `StudioCanvasSlot`, slot order |
| `features/studio/hooks/useStudioFocus.ts` | reads/writes `?focus=`, next/prev slot stepping |
| `features/studio/components/StudioCanvas.tsx` | container: figure, rail, control stacks, focus transform |
| `features/studio/components/CategoryRail.tsx` | the left vertical rail |
| `features/studio/components/StudioPieceRows.tsx` | the card's rows, on the `SlotRow` primitive |
| `features/studio/components/StudioFocusSheet.tsx` | the 225 dock + slot-stepping swipe |
| `features/studio/components/AlternatesHeader.tsx` | back + source segment |
| `features/studio/utils/rackOrder.ts` | `selectRackProducts` — which list the rack shows, in arrival order |
| `features/studio/components/AlternatesRack.tsx` | tile grid + query line + web-search row |
| `features/studio/components/AlternatesSearchDock.tsx` | collapsed ⇄ active bar, keyboard tracking |
| `features/studio/components/ReferenceImageDialog.tsx` | the add-image dialog |

**Edited**

| File | Change |
|---|---|
| `StudioScreen.tsx` | rebuilt on the parts above |
| `StudioAlternativesScreen.tsx` | rebuilt; sort and reordering deleted |
| `components/StudioActionBar.tsx` | drop `total`/`pieceCount`/`onDetails`, add `onFindItems`, `findItemsScope` |
| `utils/studioUrlState.ts` | `focus?: StudioCanvasSlot`, `source?: "wardrobe" \| "saves" \| "explore"` |
| `primitives/product-sheet.tsx` | `corner="similar"` |
| `primitives/product-tile.tsx` | `size="small"` keeps the pin when `mark` is set |
| `design-system/icons/index.ts` | `similar: RefreshCw`, `swap: ArrowUpDown` |
| `design-system/primitives/slot-row.tsx` | `layer` slot + optional `onSwap` |
| `src/index.css`, `tailwind.config.ts` | `--hairline-dashed` (#C9C0AD). `border-hairline-dashed` was already written in `slot-row.tsx` but resolved to nothing |
| `src/types/bun-test.d.ts` **NEW** | maps `bun:test` onto @types/jest so `.test.ts` files typecheck |
| `features/studio/hooks/useStudioTour.ts` | drops `remix` and the receipt steps; `click-details` → `find-items` |

**Untouched, still live:** `StudioSlotRows.tsx` and `ProductTray.tsx` — `TraySheet`
and `CreationsTab` still consume them. `ProductPeekCard`, `WearingCard`,
`RackHeader`, `RackGrid` fall out of use but stay on disk (additive-only).

## Data

| Surface | Hook |
|---|---|
| Worn pieces | `useStudioOutfit`, `useStudioProductTray`, `useStudioResolvedSlots` (unchanged) |
| Focus carousel | `useStudioProductImages(productId)` |
| Rack | `useStudioAlternatives` / `useStudioSearchResults` (unchanged) |
| Similarity `⟳` | `useStudioSearch.handleForceSearch(wornImageUrl)` |
| Search + reference | `useStudioSearch` (unchanged) |
| Filters | `useProductFilterOptions({ typeFilters: [slot] })` (unchanged) |
| History | `useStudioHistory` (unchanged) |

## Removals (brief §6.2 / §6.7 / §7)

- price and brand on every Studio surface — rows, action bar, focus card
- rack reordering and the sort control
- `Shuffle` on the canvas; `useStudioRemix` unused
- `StudioScrollUpScreen` and `openScrollUp` — its job was price and details. The
  route stays registered; nothing opens it

## Known data gaps

Measured against the live catalogue while building this screen — none of it is a
frontend bug, but all of it shows up on this screen first.

| Slot | Menswear rack | Womenswear rack |
|---|---|---|
| Tops | 112 of 112 placed | 814 of 815 |
| Bottoms | 62 of 64 | 296 of 296 |
| **Shoes** | **15 of 21** | 59 of 64 |

- **Shoes are the thinnest category by far** — 85 pairs against 927 tops, and
  only 21 of those are menswear. A male figure sees 15 shoes. This reads as
  "shoes are broken"; it is catalogue coverage.
- Products dropped from a rack are dropped by `isPlaceableOnMannequin`, which is
  deliberate: without a `<mannequin>:bodytype1` transform, tapping the tile would
  update the slot and leave the figure unchanged.
- **40 of the 85 shoes have no scraped image at all.** They were ingested
  through a manual path — 37 via `ingestion-automated/manual_shoes/segmented`,
  3 via `<id>/manual` — which saved only the segmented cutout. Compare tops
  (922 of 927 have one) and bottoms (359 of 359). 15 of the 40 are menswear, out
  of only 21 menswear shoes in total, so it bites hardest on a male figure.

  All 40 carry a `product_url`, so a re-scrape can backfill them. Until then the
  only image is the segmented placement asset — a 1536×2752 transparent canvas
  with the garment in the bottom sliver, which in a square card reads as empty.
  Ingestion job, not a UI change.

## Cropping the placement canvas

Segmented cutouts are authored on the full placement canvas, so a pair of shoes
is a **2.5% sliver at the bottom of a 1536×2752 transparent image** and renders
as an apparently empty card. `GarmentImage` frames the garment instead.

**Display only — the stored asset is never touched.** `products.image_url` *is*
the render asset: `placementY`, `imageLength` and the warp transforms are all
authored against those exact pixels, so cropping the file would move every
garment on the mannequin. Cropping happens in CSS at paint time.

| Piece | Where |
|---|---|
| Alpha probe (fractional bbox + image aspect) | `design-system/utils/image-alpha-bounds.ts` |
| Placement maths | `design-system/utils/garment-crop.ts` |
| The component | `design-system/primitives/garment-image.tsx` |

- **What gets cropped** is decided by measurement, not by slot or path: crop when
  the opaque box covers less than `CROP_AREA_THRESHOLD` (0.6) of the image. A
  scraped JPEG has no alpha and measures exactly **1.0**, so photographs can
  never be caught by it.
- **The maths takes the frame's aspect.** CSS resolves `width`/`left` against the
  frame's width and `height`/`top` against its height, so a square-only formula
  skews on the piece card's 176×205 frame. `GarmentImage` measures its own frame
  with a `ResizeObserver` — safe here, unlike the focus zoom, because nothing in
  this subtree is transformed.
- **The box ignores speckle.** A raw min/max box is decided by its single most
  extreme pixel, so a few faint specks of segmentation noise stretch it across
  the image — one sneaker asset was 2% opaque pixels but measured a 25%-wide
  box, giving a useless 1.2x zoom. `trimmedRange` drops the outermost 0.5% of
  opaque mass per edge, which fixes that asset (0.250 → 0.140 area, 2.1x zoom)
  and is a no-op on clean cutouts (0.025 → 0.024) and photos (1.0 → 0.99).
- **Fill leaves room for the overlays.** `GarmentImage` takes a `fill`; the
  default 0.86 suits the piece card, but a rack tile carries the pin over its
  top-right corner and the worn check over the bottom-right, so `ProductTile`
  uses **0.7** (`CROP_FILL`). A tall garment is height-constrained, so at 0.86 it
  cleared the top by only 7% and touched the pin; 0.7 gives 15% top and 31% side.
- **Probes are cached per URL** for the life of the tab, so a rack of repeated
  garments pays one decode per image rather than one per tile.
- Every failure path (CORS, taint, decode error, no `ResizeObserver`) falls back
  to the previous `object-contain` rendering.
- `features/studio/utils/imageAlphaBounds.ts` is now a re-export of the design
  system copy, so the placement editor's import keeps working — and the design
  system stops depending on feature code, per FRONTEND_MIGRATION_PLAN phase 2.

Enabled on the Alternates rack tiles and both piece cards. Off by default
everywhere else.

## Two bugs the speckle explains

Both were reported as "impossible" and share one root cause: a garment cutout's
opaque bounds being decided by its most extreme pixel.

**The figure slid left of centre.** `PlacementAvatarRenderer` frames the whole
composition — it starts from the mannequin's bounds and `growFrame`s them by
every garment's alpha bounds, then centres the world on that union. The Men
White Sneakers placement cutout (`manual/segmented.png`) carries specks of
segmentation noise 275px to the right of the shoe, so its raw box is that much
wider and the frame's centre moves right, pushing the figure left. The specks
are in both the PNG and its webp.

**Decision: the renderer stays as on master.** A first attempt trimmed the
renderer's probe, which also sets the garment's pivot; saved transforms are
authored in `PlacementMeshEditor` against the raw box's centre, and with scales
around 0.4–0.5 a different pivot slid garments (a tee 26px lower on the
Creations tab). Changing how the renderer measures a garment means changing the
editor identically, or every stored placement shifts. One dirty cutout is a data
problem: clean or re-segment that asset rather than guard the renderer.

**Undo, redo and reset reset the rails.** `applySnapshot` rebuilt the URL from
the history snapshot alone, which carries only the outfit — so `slot` and
`source` were dropped and Alternates fell back to Top / Explore. It now carries
the current `slot`, `source` and `focus` through. `productId` is deliberately
not carried: the hero derives from the slot ids the snapshot just restored, so
keeping the old one would show a stale piece.

**Undo, redo and reset sometimes did nothing.** Each one assigned its snapshot
inside the `setHistory` updater and read it on the next line. React runs an
updater there only as an optimisation, and only while the component has no
other update pending (`fiber.lanes === NoLanes`, react-dom 18.3.1), so a second
click before the first had rendered skipped `applySnapshot` entirely: the stack
advanced, the URL did not, and `canUndo` / `canRedo` stopped matching the
figure. The three transitions now read a ref that mirrors the stack and commit
state and snapshot together. Never read a value assigned inside a state
updater; the reducers in `studioHistoryState.ts` stay pure and are the only
place the transition is decided.

*Note: this has no hook-level regression test. The repo has no React renderer
for tests (no @testing-library/react, no jsdom), so only the pure reducers are
covered.*

**Back went nowhere, or only un-zoomed.** The header chevron was a bare
`navigate(-1)`. Entering focus pushes its own entry, so while zoomed a press
only un-zoomed and read as a dead button; and a visitor who arrived by a share
link or a refresh had nothing to pop, so the press either did nothing or left
the app. `handleBack` now exits focus first, then pops only when
`window.history.state.idx` is above zero. That index is the router's own, and it
survives the replace navigations Studio does constantly, which is why
`location.key === "default"` (used elsewhere in the app) is not reliable here.
With no entry behind us it goes to `/home`, or to `/` for a guest on a shared
look.

**Alternates' back must not pop.** It pushes a Studio URL built from the live
context, which duplicates Studio in the history stack, and that is deliberate.
A swap on Alternates is client-only: `swapSlot` writes the query cache and
`setSlotProductId` writes StudioContext, and nothing reaches the server.
`StudioContext` re-syncs itself FROM `location.search` on every change, so
popping restores the older Studio URL and then overwrites the context with it,
losing the swap. The swap handler also rebuilds the query string without
`returnTo`, so after the first swap back falls through to `openStudio()`, which
is what carries the new ids forward. Changing this to `navigate(-1)` was tried
and reverted.

Only StudioScreen's own chevron uses `hooks/useGoBack.ts`. Prefer
`hasAppHistory()` over `location.key === "default"` there; Studio's constant
replace navigations make the key unreliable.

**Alternates had no way to save.** The redesign dropped the hero panel and the
peek card, which were the only two things calling `setIsSaveDrawerOpen(true)`.
`SaveOutfitDrawer` stayed mounted and unreachable, so the outfit could not be
saved from that screen at all. Save is now a pin in the canvas `lookControls`,
between reset and share, and it opens the same `StudioSaveCard` Studio uses —
in the piece-card slot, in place of `ProductSheet`. That slot drops its fixed
225h while the card is open: the card's Save row is `mt-auto`, so a fixed height
pools all the slack in one gap right above the buttons. Content height is what
Studio does too, and the figure row above absorbs the difference. `SaveOutfitDrawer` is
gone from this screen; category and occasion come from the outfit rather than
from fields, as on Studio.

`handleSaveFromCard` also carried a stale `handleSaveOutfit`: its dependency
array listed only the avatar's category and occasion, behind an
`exhaustive-deps` disable, so it kept whichever closure existed when those last
changed and saved the slot ids from that moment. It now depends on the handler
and is declared after it.

## Share links

Share mints a short link, `/s/<slug>`, instead of handing out the long
`/studio?outfitId=…&topId=…&share=1` URL.

| Piece | Where |
|---|---|
| Table + RLS | `supabase/migrations/20260911100000_share_links.sql` — anyone resolves, signed-in users mint; `path` is CHECK-constrained to a relative path and UNIQUE |
| Slug + safety (pure, tested) | `services/share/shareLinkSlug.ts` — 8 chars, base58-style alphabet (no 0/O/I/l), `isSafeSharePath` |
| Service | `services/share/shareLinksService.ts` — `createShareLink` reuses the slug a path already has, else mints one (retrying a slug collision); `resolveShareLink` |
| Hook | `features/share/hooks/useShareLink.ts` — `useShareLook()` is the one share path for both screens |
| Resolver | `features/share/ShareLinkRedirect.tsx` at `/s/:slug`, registered **outside** `ShareAccessGuard` |

- **One look, one link.** `path` is unique, so re-sharing the same look returns
  the same slug and the table grows per distinct look, not per tap. A unique
  clash on insert is re-read by path (a concurrent mint of the same look) before
  being treated as a slug collision.
- **Shortening is best-effort.** If the insert fails — a guest with no session,
  the network — the long URL is shared instead. A share never fails for lack of a
  slug.
- **Never an open redirect.** The resolver only navigates to a relative path,
  and the table refuses anything else at the CHECK constraint; both are covered
  by tests.
- The resolver redirects to the long path, which carries `share=1`; the existing
  guard already admits that without a session, so nothing about access changed.
- Migration applied 2026-09-11. `types.ts` carries only the `share_links` block
  from that regeneration: a full `gen types` output changes an RPC return type
  and breaks `collectionsService`, so the rest of the file was left as committed.

## Decisions and stubs

- **Piece cards hide only the try-on render, and filter on PATH, not `kind`.**
  `kind` cannot separate them: a virtual try-on render of the photoreal mannequin
  is stored as `model`, and so is a scraped retailer photo. Measured across all
  9,643 `product_images` rows:

  | Storage path | kinds | What it is |
  |---|---|---|
  | `ingested_inventory/raw/<id>` | model, flatlay, detail | scraped from the retailer |
  | `ingestion-automated/<id>/raw` | model, detail, flatlay | scraped from the retailer |
  | `ingested_inventory/staging/ghost_mannequins` | ghost | segmented product shot |
  | `ingestion-automated/segmentation/<id>` | ghost, flatlay | segmented product shot |
  | `ingestion-automated/manual_shoes/segmented` | flatlay | segmented placement asset |
  | **`ingestion-automated/<id>/tryon`** | **model** | **our mannequin try-on — hidden** |
  | **`ingestion-automated/jobs/<id>`** | **model** | **`vton_*` renders — hidden** |

  `utils/productImages.ts` hides the last two (831 of 9,643). Scraped photos and
  segmented shots are both kept. No product depends on a try-on render as its
  only image, and none uses one as `products.image_url`, so nothing goes blank.
  Note `kind` also has values the TS union does not list (`ghost`), and the
  service maps a null `kind` to `"model"` — both reasons not to key on it.

- **Web search** is drawn and inert. Real results need brief §12.6's
  single-piece import mode (`mode:"single"` + slot), which does not exist. When
  it lands the row swaps the rack to web results inline, as the design intends.
- **Find items** goes to `/inspiration-import`, the same stopgap Search uses,
  until `useOpenFindItems()` lands in phase 6.
- **A refresh starts a clean search.** `slotSearchStates` is persisted per outfit
  in `sessionStorage`, which outlives a reload, so F5 brought the old query back
  into the bar. `utils/searchSession.ts` now stamps each payload with a
  `DOCUMENT_ID` minted per module evaluation — new on every page load, stable
  within one — and restores only on a match. Leaving Studio and coming back still
  keeps your place.

  Counting mounts does **not** work here: `<React.StrictMode>` mounts the
  provider twice, so "restore on the second mount" restores on every load. There
  were also two readers — the lazy `useState` initializer and a second one inside
  the outfit-change effect, which is the one that actually fires as
  `selectedOutfitId` goes `null → id` on load. Both now share one reader and one
  writer, covered by `__tests__/searchSession.test.ts`.
- **Cold state is out of scope.** DESIGN_NOTES says a first-ever Studio visit
  shows the Moodboards page; today it opens a starter look via
  `useStarterOutfit`. Unchanged in this pass.
- **Wardrobe source** stays the empty state it is today — there is no wardrobe
  ingest yet (brief §12.7).
- Focus zoom falls back to static per-zone bands whenever placement data is
  missing, so an unplaced product still focuses sanely.

## Verification

Per `FRONTEND_MIGRATION_PLAN.md`, against the known-red baseline in `CLAUDE.md`
(7 type errors · 275 lint errors / 143 warnings · 8 failing tests) — no new ones.

- `bun run typecheck`, `bun run lint`
- `bun test` — use `bun test <path>`, not `bunx jest`
- New tests: `studioUrlState` focus round-trip · focus slot stepping ·
  rack order preserved · layer flag off/on shape
- `bun run dev`, compare each screen at 390 × 844 against its artboard
- The nine laws in `COMPONENTS.md`, per screen — in particular: exactly one
  terracotta fill (Try on on the landing, Find items in the piece card, Apply in
  the dialog — one per screen), nothing below 10.5px, radii only 2/3/5/6, and
  Studio never shows the look's name
