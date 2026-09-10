# Atlyr — Redesign Brief (engineering companion)

**For:** the dev team (refactor the code against the screens). Claude Design does not read this file.
**Canonical set:** `docs/redesign/` — `design.md` (visual system, type, sizes, header pattern, icon vocabulary, copy whitelist, working-copy rule), `Atlyr_Redesign_Brief.md` (layout budgets, shared components, per-frame changes, engineering summary), `CLAUDE_DESIGN_PROMPT.md`, `REVIEW_HANDOFF.md`. Anything that appears on a screen is specified there; where this file and `docs/redesign/` differ, `docs/redesign/` wins. This file keeps the code-level detail the canonical brief compresses: motion primitives, gesture map, platform rules, per-component refactor tables.
**Base:** current app in `Atlyr_/src`; the design canvas `Atlyr App Design System_v2 Claude/` (originals, never edited) and its `updated` working copy in the Claude Design project.
**Supersedes:** `Atlyr_Flow_Changes_v1/v2`, `Atlyr_System_Redesign_v3`, `Atlyr_Emotional_Design_Layer_v1`.

Legend: `EXTEND` modify in place · `NEW` net-new · `MOVE` relocate · `KILL` delete · `BE` backend/edge/schema · `[P2]` design now, build later.

---

## 1. Intent

The app is for **trying and exploring outfits**, not shopping. Price and brand leave every primary surface. "Buy" is replaced by one action, **Find items** (`Globe`), which runs the inspiration web-match loop and surfaces retailer links.

Three loops: (1) Inspiration → Studio → Try on → Save / Share / Find. (2) Studio-first iteration. (3) Boards as the collection layer (`[P2]` nested + shared).

Three feelings, one per level of emotional design:

| Level | Feeling | Where it lives |
|---|---|---|
| Visceral | "clean, smooth, it responds to me" | every touch · motion primitives · the mannequin |
| Emotional | "I'm learning, making, finding" | Studio as a workbench · the wait · exploration |
| Signalling | "I have an eye — look what I built" | boards as lookbooks · sealed share cards · the process replay · taste card |

---

## 2. Design laws (apply to every screen)

### 2.1 Visual system — `docs/redesign/design.md`
Cream `#F3ECDF` ground · ink `#2E2A24` text and structure · **one persistent terracotta `#B3542E` fill per screen** (transient toasts and the job pill are exempt) · gold `#C9A227` = provenance only (seal, ✦ mark, wordmark on exports; never a border, button or callout) · Bodoni Moda 500 for titles and moments, Hanken Grotesk for interface · type scale with a 10.5 px floor · buttons 44 / 40 · radii 3 / 5 / 6 · hairlines · warp-weft grid. Full tokens, scale and header pattern in `design.md`; `tokens.css` mirrors it. No new colours, sizes or components outside that file. Three laws that shape the code below: a control appears once per screen (no floating toolbar duplicates an action-bar or row control); Studio never shows the look's name or a caption; outfit cards carry a name only, no counts.

### 2.2 Motion policy — **still at rest · alive on touch · busy while working**
Animation only on (a) user-caused state change, (b) content arrival, (c) a job in flight. One idle exception: the mannequin breathes (translateY 0→−2 px, 4 s sine). `prefers-reduced-motion` collapses all to opacity fades. `Tilt` is feed/boards only — never in Studio, never on a transactional surface.

Primitives (`features/motion/` `NEW`, on `framer-motion`; `gsap` only for the reveal curtain and process replay):

| Primitive | Use | Spec |
|---|---|---|
| `SpringTap` | any tappable | scale .97 press, spring `{500, 30}`; haptic light |
| `Tilt` | feed/board tiles | ±0.6° fixed at mount; +1° toward scroll direction |
| `StaggerIn` | lists/grids/rails mount | 40 ms stagger, 240 ms, `ease.out`, y 8→0 |
| `Land` | piece arriving on mannequin | y −12→0, scale 1.04→1, spring `{380, 26}`; haptic medium |
| `Slide` | piece leaving; sheets; tab content | 200 ms `ease.inOut` |
| `Reveal` | try-on result | existing ink curtain + gold seal popIn |
| `Breathe` | mannequin at rest | as above |
| `Pulse` | job in flight | opacity .6↔1, 1.6 s |

Tokens: `motion.fast 120 · base 240 · slow 420`; `ease.out [.2,.8,.2,1]`, `ease.inOut [.7,0,.2,1]` → `tokens.css`. Haptics via `lib/haptics.ts` `NEW` (`navigator.vibrate` — **Android Chrome only; iOS has no API**, so haptics are progressive enhancement and never part of a described interaction) on wear · save · reveal · export. **No sound.**

Performance floor: **iPhone-class**. Devices that drop below ~45 fps during the first progressive dressing (measured via `requestAnimationFrame` deltas) are switched to the reduced-motion path for the session. Regardless: mannequin layers `will-change: transform`, images pre-decoded (`img.decode()`) before `Land`, no animated `filter`/`box-shadow`, `Tilt` only on tiles inside the viewport (IntersectionObserver), history stores product ids not images.

### 2.3 Copy budget — whitelist
Icons everywhere; words only here (the full list, including section labels, tabs, buttons and headers, is the Copy whitelist in `design.md` — that table is canonical). Bodoni for the moment, Hanken for the tool:

| Moment | Line |
|---|---|
| Collections, no boards | "Start a board. Anything you long-press lands here." |
| Try-on started | "Cooking. Keep styling — the pill turns gold when it's ready." (installed + push granted: "…we'll tap you.") |
| After first reveal, once | "Add Atlyr to your home screen — looks land even when you're away." |
| Result ready | "Your look is ready." |
| Wait deck footer | "+1 · {n} terms in your vocabulary" |
| Board / look share | "{n} looks · curated by {name}" / "Look #{n} · styled by {name}" |

### 2.4 Icon registry — `design-system/icons.ts` `NEW`
Screens import `Icons.*`, never `lucide-react` directly.

| Meaning | lucide |
|---|---|
| save / saved | `Bookmark` outline / filled |
| tryOn | `SquareUserRound` |
| findItems | `Globe` |
| share | `Share` |
| undo / redo | `Undo2` / `Redo2` |
| restore | `RotateCcw` |
| alternatives | `LayoutGrid` |
| addInspiration / addWardrobe | `Plus`+`Link` / `Plus`+`Shirt` |
| slot top / bottom / shoes / `[P2]` layer | `Shirt` / `BottomsGlyph` / `Footprints` / `Layers` |
| source wardrobe / saves / explore | hanger glyph (new SVG) / `Bookmark` / `Compass` |
| camera · filter · close · profile | `Camera` · `ListFilter` · `X` · `UserRound` |
| carousel step | `ChevronLeft` / `ChevronRight` |

### 2.5 Gesture map (Studio family)

| Gesture | On | Result |
|---|---|---|
| tap | worn piece on mannequin, or its slot row | **focus** (zoom state + piece sheet, §6.6) |
| tap | details area of the focus sheet | Alternatives for that slot (§7) |
| long-press | worn piece on mannequin | nothing (no toolbar; the OS image sheet is suppressed) |
| pinch | mannequin | visual zoom only, no state |
| tap | rack tile | wear (`Land`) and return to Studio focus on that slot |
| tap | `Bookmark` on a rack tile | save in place, stay on Alternatives |
| long-press | any tile anywhere | save to board (picker) |
| swipe row ← / → | slot row | remove / alternatives |
| `[P2]` drag | rack tile → mannequin zone | wear |

Browser rules for these gestures (all mandatory, see §2.6): long-press targets carry `-webkit-touch-callout:none; user-select:none; touch-action:manipulation` and cancel `contextmenu`; row swipe is recognised only when the touch starts > 24 px from the left screen edge (iOS edge-swipe = Back) and after horizontal intent lock; pinch is handled with pointer events on a container with `touch-action:none` (never on a scrolling ancestor); every gesture has a tap equivalent (alternatives via the row's `LayoutGrid`, remove via `X`, save via the sheet's `Bookmark`).

### 2.6 Platform — mobile web first, installable

Targets: **iOS Safari, Android Chrome, in-app browsers (Instagram / WhatsApp)**. Desktop layouts kept but not designed for. The app ships as a **PWA**: `vite-plugin-pwa` service worker (app shell + image runtime cache), Web Push for installed users, `manifest` fixed to ink `theme_color #2E2A24` / cream `background_color #F3ECDF` (currently slate/white — the splash flashes).

| Concern | Rule |
|---|---|
| Viewport height | `100dvh` / `visualViewport.height` everywhere a bar is pinned; never `100vh` |
| Safe areas | bottom nav, action bar, Collections footer, Alternatives search bar pad `env(safe-area-inset-*)` |
| Keyboard | any focused input hides bottom nav, Collections footer and action bar (`visualViewport.resize`); inputs are top-anchored, with one exception: the Alternatives search bar is bottom-docked and is repositioned to `visualViewport.height − barHeight` on `resize`/`scroll` of `visualViewport` so it sits directly above the keyboard (never `position: fixed; bottom: 0` alone — iOS Safari does not move fixed elements with the keyboard) |
| Pull-to-refresh | `overscroll-behavior-y: contain` on every scroll container; the app's own rail refresh is explicit |
| Zoom | drop the meta-tag zoom lock as the mechanism (iOS ignores it); `touch-action` per container instead |
| Background jobs | polling only runs foregrounded; job status is re-fetched on `visibilitychange`; push (installed only) covers the away case |
| Share with files | `navigator.share({files})` must be called inside the tap gesture with a **pre-rendered** blob (render on result/board load, not on tap); fallback when `canShare` is false or `share` is absent (in-app browsers): full-screen image + "long-press to save" + copy link |
| Exports / snapshots | only Supabase-hosted, CORS-enabled images on any exportable surface (`modern-screenshot` taints otherwise → blank export); retailer images are proxied through storage before display on those surfaces |
| In-app browsers | share links open in view-only mode (`useStudioShareMode` exists); no install/push prompts there; "Open in browser" hint on the first CTA |
| Install nudge | once, after the first reveal: Android `beforeinstallprompt`; iOS two-step hint sheet (Share → Add to Home Screen). Never repeated if dismissed. Installed → standalone chrome, push eligible |
| Push consent | asked only after install and only from the try-on flow ("Tell me when looks are ready") — never on load |

---

## 3. Cross-cutting refactors (first)

### 3.1 `KILL` the legacy tree
`pages/Index.tsx` hosts a second app (`components/{home,studio,search,collections,profile,layout,checkout}`) behind `/app/*` for guests, navigating via `window.dispatchEvent`. Delete it. `Index.tsx` → redirect to `/collection`; `GuestAvatarPrompt` moves to `AppShellLayout`. `KILL` `/checkout`, `useCart`. Keep `components/ui/*` and admin/HITL/ingestion dashboards.

### 3.2 One product-card family
Nine components render a product with inconsistent brand/price/rating. Collate to three primitives on one DTO:

```ts
export interface ProductCardData {
  id: string
  name: string                 // implied_name ?? product_name
  imageUrl: string | null
  images?: string[]
  slot: "top" | "bottom" | "shoes" | "layer"
  attributes?: { fit?: string[]; feel?: string[]; vibe?: string[]; colour?: string | null; material?: string | null }
  productUrl?: string | null   // Find items result rows only
  isSaved?: boolean
}
```

| Primitive | Replaces | Shape |
|---|---|---|
| `ProductTile` `NEW` | `ProductAlternateCard`, `ShortProductCard`, `ProductResultsGrid` item, `ItemCard`, `EnhancedProductCard`, `components/product/ProductCard` | image + name; `Bookmark` overlay; `SpringTap`; `onSelect / onToggleSave / onLongPressSave` |
| `ProductRow` `NEW` | `StudioSlotRows` row, Creations piece rows | `[X?] [slot icon] name … [trailing?]`; swipe actions |
| `ProductSheet` `EXTEND` ← `ProductPeekCard` | `ProductPeekCard`, `ProductSummaryCard`, split-view left panel | always horizontal: square carousel 176 × 176 (dots inside the bottom edge + `ChevronLeft`/`ChevronRight`, no thumbnails) on one side, details on the other (name · slot tag · attribute chips · `Bookmark` + `SquareUserRound`); `carousel: "left" \| "right"`; `onOpenAlternatives?` (focus only) |

Mapper `mapToProductCardData()` in `services/shared/transformers/productTransformers.ts`. `KILL` `PriceDisplay`, `StatChip`(rating), `ProductReviews`, `ServiceTags` from app surfaces. Strip `brand/price/currency/rating/reviewCount` from `StudioProductTrayItem`, `StudioAlternativeProduct`, `SavedProduct`, `CollectionProduct` once unread (keep `productUrl`).

### 3.3 Feed hooks leave Home
`features/home/hooks/*` + `services/home/homeService.ts` → `MOVE` `features/feed/` (`useFeedRecentStyles`, `useFeedCuratedOutfits`, `useFeedAllOutfits`, `feedService`). `HomeScreen.tsx` `KILL` after §5 parity; its board-detail branch becomes §5.6.

### 3.4 Filter facets server-side
`getProductFilterOptions()` selects every `products` row client-side per drawer open. `BE` RPC `get_product_facets(slot, gender)` → bucketed `{categories, fits, feels, vibes}` via `facet_bucket_map(facet, raw_value, bucket)`. `useProductFilterOptions({slot, gender})`. Drop brand/size/price/colour from `ProductFilterOptions` and `ProductSearchFilters`.

### 3.5 Studio URL state
`studioUrlState.ts` gains `focus?: StudioSlot` and `source?: "yours" | "saves" | "alternates"`; both in `useStudioHistory` snapshots so undo/restore/share links carry them. Alternatives is entered with `focus` set and returns with it still set, so wearing a rack tile lands on Studio focus for that slot (`handleWear` → `navigate(-1)`, focus param preserved). Rule: no `window.dispatchEvent` navigation anywhere; anything a share link should carry goes through URL state.

---

## 4. Navigation & shell

**3 tabs:** Collections (landing) · Studio · Search. Home and Profile tabs removed; Profile only via the Collections header avatar.

| Component | Op | Change |
|---|---|---|
| `bottom-nav-bar.tsx` | EXTEND | `NAV_ITEMS = [collections, studio, search]`, `justify-around`; `SpringTap` |
| `AppShellLayout.tsx` | EXTEND | drop `home`/`profile` nav cases; `/profile/*` → no active tab; mount `GuestAvatarPrompt` |
| `pages/Index.tsx` | EXTEND | pure redirect → `/collection` |
| `App.tsx` | EXTEND | `/home`, `/design-system/home` → `Navigate /collection`; remove `/checkout`; add `/collection/board/:slug` |
| posthog `homeBrowseDepth`, route policy | MOVE | surface `home` → `collections`; generic `observeFeedCard(surface)` |

---

## 5. Collections (landing)

Base `features/collections/CollectionsPage.tsx` — split into shell + one component per tab.

**Header:** "Your boards" · `+` · `UserRound` → `/profile`. **Tabs (`?tab=`):** Moodboards · Creations · Products · Explore (default Moodboards). **Footer** (Moodboards + Products only, fixed above nav): `+` new board · **Add link** field (`Link` leading, `Camera` trailing) → Find items, whole look.

| Component | Op | Change |
|---|---|---|
| `CollectionsPage.tsx` | EXTEND | keeps tab URL state, header, `MoodboardPickerDrawer`; `renderContent` → `{MoodboardsTab, CreationsTab, ProductsTab, ExploreTab}`; remove ghost-header hack (`useElementHeight`) |
| `CollectionsHeader.tsx` | EXTEND | add `onOpenProfile`; remove `sortValue/onSortChange`; header owns the tab row (page no longer duplicates it) |
| `MoodboardsTab.tsx` | NEW | §5.1 |
| `CreationsTab.tsx` | EXTEND | §5.2 |
| `ProductsTab.tsx` | NEW | §5.3 |
| `ExploreTab.tsx` | NEW | `CuratedCollectionRows` (§8.2) |
| `CollectionsFooter.tsx` + `AddLinkField` | NEW | §5.4 |
| `MoodboardCard.tsx` | EXTEND | navigate `/collection/board/:slug`; `variant="cover"` (§5.5); `Tilt` |
| `BoardDetailScreen.tsx` | NEW | §5.6 |

### 5.1 Moodboards tab (top → bottom)
1. **Recent creations rail** — `RecentStylesRail`, `items = useFeedRecentStyles(10)`, new preset `squareThumb` (1:1; try-on image if present else mannequin); `StaggerIn`; tap → `useLaunchStudio`.
2. **Search bar** — `FilterSearchBar`, "search your boards & saves", sort Recent / A–Z, no filter button, no image upload.
3. **Boards grid** — square `MoodboardCard` cover tiles, `Tilt`, system boards first (Favourites · Wardrobe · Try-ons), user boards, dashed "+ New board". Empty: copy line from §2.3.
4. **For you** — hairline draws left→right (300 ms) + small-caps "FOR YOU"; `useFeedCuratedOutfits` infinite; square `OutfitInspirationTile`s (→ `OutfitCard`: footer name only, no piece count); **no reason chips** (tiles stay clean). Mounts after boards settle.
5. Footer.

### 5.2 Creations tab
Tile front = try-on if it exists, else mannequin; flip badge stays (default inverted when try-on exists). Under the tile: creation name (inline edit) + one `ProductRow` per piece (slot icon + name). No image/brand/price rows.

### 5.3 Products tab
`ProductTile` grid, name only; tap → `/studio/product/:id?returnTo=`. Two fixed outline buttons: **`+ Inspiration`** → Find items (look) · **`+ Wardrobe`** → `WardrobeUploadSheet` `NEW` (photo → `BE` `wardrobe-ingest`, §12.7).

### 5.4 Add link field
URL submit → `openFindItems({scope:"look", sourceUrl})`; `Camera` → `sourceFile`. `BE` §12.6 (URL ingestion).

### 5.5 Boards as lookbooks
Cover = auto-collage of top 4 items on cream, Bodoni title. Share (board header) → **lookbook card** 9:16: collage, title, "{n} looks · curated by {name}", ATLYR wordmark at foot; `useShareCard` `NEW` (canvas render → Web Share with file, fallback download).

### 5.6 Board detail — `/collection/board/:slug`
`BoardDetailScreen` = the moodboard branch extracted from `HomeScreen`: header (back · Bodoni title · `Share` lookbook · overflow rename/delete) · cover collage settles from ±3° to ±0.6° on open · `useMoodboardItems(slug)` → `MixedMasonryGrid` · **"MORE LIKE THIS BOARD"** infinite via `useBoardSimilarOutfits(slug)` (`BE` §12.5). `[P2]` stacked tile for board-in-board; `Share` for collaborators.

### 5.7 Item open (feed view)
Unchanged: `useLaunchStudio(outfit)` → `/studio?outfitId=&returnTo=`. `TryOnPreviewOverlay` `MOVE` → `features/tryon/components/`, opened from Try-ons board and the rail for try-on items.

---

## 6. Studio — the workbench

Base `features/studio/StudioScreen.tsx`. Frame: **header · mannequin container · slot rows · action bar · nav.**

**Header (32 h):** back chevron only · no title · **job pill** at the right when a try-on is running (`Pulse` → gold dot when ready). Studio never shows the look's name, a draft line or any caption: the auto-name (from implied names, "Cream tee · indigo wide-leg · kolhapuris") is stored on the draft by `useCreateDraftOutfit` on each history snapshot, silently, and surfaces only on the Creations tile, where it is edited inline. `KILL` the drawer's name field and any header title component.

### 6.1 Cold state — "Start from"
No outfit → header "Your look" (32 h) · START FROM label · three starter looks (`useStarterOutfit`) as `OutfitCard` 150 × 210 tiles (name only, no count) in a rail + dashed `Camera` tile → Find items. No sentence, no other text. Replaces the empty mannequin.

### 6.2 Controls — 4, in two vertical stacks on the container's bottom corners
`CanvasControlCluster` `EXTEND`: `placement: "left" | "right"`, **vertical** (`flex-direction: column`, 8 px gap, 12 px inset, 32 × 32 discs). Left column `Undo2` above `Redo2` (undo shows step-depth as a tiny superscript); right column `RotateCcw` above `Share`. Hidden while the focus sheet is up. Remove `Shuffle`; `KILL` `useStudioRemix` (whole-look shuffle dropped). `Share` → sheet: **Share look** (§9.4) · **Share the making** (§9.5).

### 6.3 Piece actions — no toolbar
There is no floating piece toolbar. Every piece action has exactly one control: remove = row `X`; alternatives = row `LayoutGrid` or the focus sheet's details tap; save = the focus sheet's `Bookmark`; find = the action bar's `Globe` while focused. `KILL` any `PieceToolbar` component and its long-press handler; the long-press on a worn piece only suppresses the OS image sheet.

### 6.4 Slot rows (`StudioSlotRows` on `ProductRow`)
`[X] [slot icon] name … [LayoutGrid]`. No brand/price. Trailing → `onOpenAlternates(slot)`. Body tap → **focus**. Swipe ← remove, → alternatives. Text crossfades on wear. `[P2]` `layer` row with dashed "Add layer".

### 6.5 Progressive dressing
On outfit open and on restore: pieces `Land` bottom → top → shoes, 120 ms apart. On wear / undo / redo: outgoing `Slide`, incoming `Land`. `AvatarRenderer` `EXTEND`: per-zone layer transforms from `renderBox`/`mannequinAnchors`; optimistic wear (render before the query resolves; skeleton never spinner).

### 6.6 Focus (zoom) — `?focus=slot`, in place
The mannequin container keeps its 593 px; the figure scales and translates inside it so the zone fills the container (220 ms `ease.inOut`). A **253 px piece sheet** (30 % of the screen) `Slide`s up over the bottom of the content area — from y 482 to the action bar — covering the slot rows and the lower 143 px of the container; the control stacks hide. Inside: `ProductSheet carousel="left"` — square carousel at the left (dots + chevrons, no thumbnails), details at the right (name · slot tag · attribute chips fit · feel · vibe · colour · material · `Bookmark` + `SquareUserRound`). No brand/price/description. Details tap → Alternatives for the slot (`?source=` preserved). Exit: `X` top-right of the sheet, tap the visible container, back gesture (`focus=null`, does not leave Studio). Starting a try-on clears focus (the wait deck takes the region). `ProductPageScreen` (`/studio/product/:id`) keeps the deep link but renders the same sheet, stripped of price/brand/reviews.

### 6.7 Action bar (`StudioActionBar` `EXTEND`)
`Bookmark` **Save** (gold outline) · `SquareUserRound` **Try on** (terracotta — the screen's fill; on tap morphs into the ink job pill and lifts to the header, 200 ms) · `Globe` **Find items** (dashed outline). Props: remove `total, pieceCount, onDetails`; add `onFindItems, findItemsScope`. Find items scope: no focus → look; focus → piece (§8). `KILL` `StudioScrollUpScreen` + `openScrollUp` (its job was price/details). `StudioTour`: `details` step → `findItems`.

---

## 7. Alternatives

Base `StudioAlternativesScreen.tsx` → split into `AlternativesScreen` + `AlternativesHeader`, `PieceCard`, `SourceSegmented`, `SlotIconRow`, `Rack`, `AlternativesSearchBar`.

**Layout (390 × 844, nav hidden):** header 32 (back · "Alternates" · **40 px mannequin thumb** as the only right action → back to Studio) · **piece card 208, full width** (`ProductSheet carousel="right"`: details left, square carousel right, hairline below) · source row 36, right-aligned · slot row 36, right-aligned · rack 476 (two columns) · **search bar 56, docked at the bottom**. **No full avatar; no split view; no search or filter icons in the header.**

| Part | Op | Change |
|---|---|---|
| `SourceSegmented` (from `RackHeader`) | EXTEND | `yours→Wardrobe`, `saves→Saves`, `alternates→Explore`; 26 h chips, icon + 11 px label, active = ink fill; `justify-content: flex-end` to the 16 px gutter; persists in URL `source`; default Explore |
| `SlotIconRow` | EXTEND | icons only, 40 × 40, active filled ink, `justify-content: flex-end`; `[P2]` `Layers` |
| `AlternativesSearchBar` | NEW | `SearchBar dock="bottom"`: 56 h bar fixed at the bottom, safe-area padded — 40 h field (`Search` leading, `Camera` trailing) + `ListFilter` 40 × 40 at the right. Focus → bar repositions above the keyboard via `visualViewport` (§2.6), reference chip (worn thumb + `×`) at the left of the field, `×` at the right closes; collapses on submit / blur / `Escape`. Wraps `useStudioSearch` |
| Reference image | EXTEND `useStudioSearch` | on slot change, if no draft image, seed `draftImageUrl = wornItem.imageUrl` (`referenceSource:"worn"`). Chip tap → `ReferenceImageSheet` `NEW`: keep current piece · replace with photo. Chip `X` → clear |
| `PieceCard` | EXTEND `ProductSheet` | `carousel="right"`, 208 h incl. 16 px padding; details: name · slot tag · attribute chips · `Bookmark` + `SquareUserRound` (try on); the details area is not tappable here |
| `Rack` (`RackGrid`/`AlternativesGrid`) | EXTEND → `ProductTile` | two columns, 8 px gap; `StaggerIn` on source/slot switch; **tile tap = wear + `navigate(-1)` back to Studio focus on this slot** (§3.5); tile `Bookmark` = save in place; worn tile = 2 px ink hairline + `✓` disc; end/empty state = one `Globe` **Find items** (piece; carries query + image + filters) |
| Sort | KILL | no sort control; similarity order from `search-v2` |
| Filters | EXTEND | from `useProductFilterOptions({slot, gender})`: category (bucketed), fit, feel, vibe, `collection:*` boards. No brand. `filter-drawer` gains per-group **tag search** (`useTagSearch` → `BE` §12.4), top-5 as chips |

---

## 8. Find items — one loop, six doors

### 8.1 `useOpenFindItems()` `NEW`
```ts
type FindItemsIntent =
  | { scope:"look"; sourceUrl?:string; sourceFile?:File; outfitId?:string; snapshotRef?:RefObject<HTMLElement> }
  | { scope:"piece"; slot:StudioSlot; productId?:string; imageUrl?:string|null; query?:string; filters?:ProductSearchFilters }
```
`look` → `startImageImport` / `startUrlImport` (`BE`) → `/inspiration-import/:id` (existing: lens → catalogue → web → commit → pre-dressed Studio with progressive dressing). `piece` → session `mode:"single"` + slot (`BE`, skips detect) → web results **inline** as `WebMatchRack` in the caller's region; select → `import-commit` → ingest → `handleWear`.

| Door | Intent |
|---|---|
| Collections › Moodboards footer Add link / `Camera` | look |
| Collections › Products `+ Inspiration` | look |
| Studio cold "From a photo" | look |
| Studio action bar, no focus | look (mannequin snapshot) |
| Studio action bar with focus | piece |
| Alternatives rack end/empty `Globe` | piece (+ query, image, filters) |
| Try-on result `Globe` | look (try-on image) |

Every web result shows `listingUrl` + `merchantDomain` — the only commercial exit. `BE` detector adds `shoes`.

### 8.2 `CuratedCollectionRows` `NEW`
Shared by Collections › Explore and Search reset: one Atlyr-curated collection per row (name header → `/search?collection=`), horizontal rail of `OutfitInspirationTile` (`homeCurated`), `StaggerIn`. Extracted from `SearchScreen` `visibleCollections`.

---

## 9. Try-on — the wait, the reveal, the artefacts

Try-on runs for minutes in the background (`JobsContext`, 4 s poll). Rule: **the wait is dismissible, useful, and pulls the user back.**

### 9.1 WaitDeck `NEW`
On start, a card deck `Slide`s into the region under the container (focus cleared). Cards rotate every ~8 s or on swipe:

| Card | Content | Source |
|---|---|---|
| **Garment** | worn piece's construction, fabric, one line of lore | `garment_summary` + `garment_lore` `BE` (seeded from `docs/kalagriha-study-compendium.html`) |
| **Fact** | one-line craft/textile fact tied to a facet of the look | `craft_facts` `BE` |
| **Prompt** | thinking nudge with one-tap action ("Would this hold in a lighter fabric? Swap the top →" → Alternatives) | client template |
| **Exit** (always last) | "While this cooks — 4 pieces that pair with your top" → Alternatives (`useStudioComplementaryProducts`) · "3 boards near this look" → Collections | existing hooks |

Quotes only if short, attributed, from a curated table; never lyrics/poems. Each garment card adds its term to `user_vocabulary` `BE`; footer ticks "+1 · {n} terms". Deck is dismissible; the header pill keeps the job alive while the tab is foregrounded; on return (`visibilitychange`) status is re-fetched and `NotificationTray` shows "Your look is ready" → `Reveal`. Installed users with push granted get the same line as a push (`BE` §12.12); nobody else is promised an away notification.

Wait content is pre-fetched with the try-on request (one call returns the deck) so the deck renders instantly, and the first three cards are cached in the service worker for offline flips.

### 9.2 Reveal — unchanged
Ink curtain, gold seal popIn, Bodoni "Your look is ready", progressive dressing on the result.

### 9.3 Result header
`Share` (two options) · `Globe` Find items (look). One ink text link "Share this look" under the image, dismissed on scroll. No per-piece Buy, no prices. Save = toast only.

### 9.4 Sealed look card (share)
Result image, gold seal, implied names in small caps beneath ("CREAM COTTON TEE · INDIGO WIDE-LEG · KOLHAPURI"), "Look #{n} · styled by {name}", grid + wordmark. `useShareCard` pre-renders the blob when the result mounts (§2.6 share rule); the `Share` tap only calls `navigator.share`. Same for the lookbook card (rendered on board-detail mount) and the process strip (rendered when the share sheet opens, before the option is tapped).

### 9.5 Process replay — "Share the making"
`ProcessReplay` `NEW`: history snapshots rendered as a **6-frame vertical strip** (first → last, final frame sealed) — works everywhere. `[P2]` 3–4 s MP4 via `gsap` timeline → `MediaRecorder`. Entry: control-cluster `Share`.

---

## 10. Search

Base `SearchScreen.tsx`. `KILL` `SearchRoomScreen` (facet room).

| Component | Op | Change |
|---|---|---|
| `SearchScreen.tsx` | EXTEND | `!isResultsMode → <SearchResetState/>`; bar `X` clears params + `scrollTo(0)`; extract `SearchResults.tsx` |
| `SearchResetState.tsx` | NEW | top bar · **occasion chip row** (`useSearchFacets`, outlined; gold ✦ only on handloom) · `CuratedCollectionRows` · "FROM THE COMMUNITY" + `useFeedAllOutfits("newly_added")` infinite, public only, **creator name + "styled in Atlyr"** on each tile (`resolveOutfitAttribution`) · `StaggerIn` |
| Results | EXTEND | unchanged toggle; filter drawer gains vibe/fit/feel/occasion with tag search |

---

## 11. Profile (via Collections header only)

`ProfilePage` `EXTEND`: add **Taste card** — vocabulary count + top three facets from saves/creations ("boxy · indigo · handloom"); private by default; "Share taste card" → 1:1 card. `BE` view `user_taste_summary`. Everything else unchanged (avatar, likeness, limits).

---

## 12. Backend contracts (`BE`)

| # | Change | Consumers |
|---|---|---|
| 12.1 | `products.implied_name` from the garment-summary prompt; backfill; all names read `implied_name ?? product_name` | `mapToProductCardData`, services |
| 12.2 | `facet_bucket_map` + RPC `get_product_facets(slot, gender)`; later enum in ingestion + backfill | `useProductFilterOptions` |
| 12.3 | `ProductSearchFilters` drops brands/sizes/price/colour; `search-v2` ignores them | `useStudioSearch` |
| 12.4 | `facet_tag_embeddings`, `tag_query_cache(user_id, facet, query_hash, tag_ids)`, `search-tags` edge fn | `useTagSearch` |
| 12.5 | RPC `similar_outfits_for_board(slug, limit)` over `outfits.embedding_v1` | `useBoardSimilarOutfits` |
| 12.6 | `import-session-create`: `sourceUrl`; `mode:"single"` + slot; detector adds `shoes` | `useOpenFindItems` |
| 12.7 | `wardrobe-ingest`: photo → slot classify → `products` with `owner_user_id`, private RLS | `WardrobeUploadSheet`, rack Wardrobe |
| 12.8 | `outfits.is_public` respected in community feed | `SearchResetState` |
| 12.9 | `garment_lore`, `craft_facts`, `user_vocabulary(user_id, term, first_seen)`, view `user_taste_summary` | `WaitDeck`, Taste card |
| 12.10 | draft outfit autosave on history snapshot (existing `useCreateDraftOutfit`; add `is_draft` cleanup); auto-name stored on the draft, shown on the Creations tile only | Studio (silent) |
| 12.11 | `[P2]` `products.type` + `outfits.layer_id`; `moodboards.parent_slug`, `moodboard_members` | layering, collab |
| 12.12 | PWA: `vite-plugin-pwa` SW (shell precache, image runtime cache, `navigateFallback`); `push_subscriptions(user_id, endpoint, keys)`; `tryon-generate` completion → `send-push` edge fn (VAPID); manifest colours fixed | install nudge, WaitDeck away-case |
| 12.13 | Wait-deck payload returned with `tryon-generate` response (cards for the worn pieces) | `WaitDeck` |
| 12.14 | Image proxy: retailer/web-result images copied to Supabase storage before they appear on exportable surfaces (CORS-safe snapshots) | Find items results, share cards |

---

## 13. Build order (each step shippable)

1. §3.1 legacy tree · §4 nav · `/home → /collection` · profile via header · **§2.6 platform base** (dvh, safe areas, overscroll, keyboard hide, manifest colours, `visibilitychange` refetch).
2. §2.4 icons · §2.2 motion primitives + haptics · §3.2 product-card family (migrate Products + Creations first).
3. §3.3 feed hooks · §5 Collections (rail, boards, For you, footer, Explore, board detail) · `KILL HomeScreen`.
4. §6.2 controls · §6.4 rows · §6.7 action bar (look scope) · **§6.5 progressive dressing · §6.1 starter looks** (highest feel-per-effort — ship before anything below).
5. §7 Alternatives (thumb, source URL state, full-width piece card, right-aligned source + slot rows, bottom-docked search + worn reference, wear-and-return, filters). Needs 12.2 or a client bucket map behind the same hook.
6. §6.6 focus (overlay sheet, zone zoom, details tap → Alternatives) · §8 piece scope · §9.3 result header. Needs 12.6.
7. §9.1 WaitDeck + vocabulary · §6 silent auto-name on the draft. Needs 12.9, 12.10, 12.13.
7b. **PWA**: service worker, install nudge after first reveal, push subscription + `send-push` (12.12). Share-with-files pre-render + in-app-browser fallback (§2.6), image proxy (12.14).
8. §10 Search reset + attribution. Needs 12.8.
9. §5.5 lookbooks · §9.4 sealed card · §9.5 process strip · §11 taste card.
10. 12.1, 12.4, 12.5, 12.7.
11. `[P2]` drag-to-wear · layering · nested/shared boards · MP4 replay.

---

## 14. Verification (per PR)

- 3 nav items; `/home`, `/design-system/home`, `/app/*` redirect; no import of the legacy `components/*` screens.
- No `PriceDisplay`/`brand`/`price` on any `features/**` app surface (grep + 390 px snapshots).
- Board tap → `/collection/board/:slug`; back restores scroll.
- Studio: no title in the header; corner stacks = `Undo2` over `Redo2` (left) and `RotateCcw` over `Share` (right); row trailing = `LayoutGrid`; `?focus=` zooms inside the 593 px container and shows the 253 px sheet without leaving Studio; no long-press toolbar exists; progressive dressing 60 fps on a mid-range Android; try-on start clears focus and shows the deck.
- Alternatives: `?source=` round-trips; piece card full width with the carousel at the right; source and slot rows right-aligned; search bar docked at the bottom, rises with the keyboard, worn piece pre-loaded as reference; tapping a rack tile wears it and returns to Studio focus for that slot; no sort; no brand group; ≤ 15 category buckets per slot.
- Find items: all six doors create a session with the right scope; single-slot skips the lens; every web result shows a retailer link.
- Search: tab tap / bar `X` → chips + curated rows + community feed with attribution.
- Motion: `prefers-reduced-motion` audit; no idle animation except mannequin breath; `Tilt` absent from Studio/Alternatives.
- Terracotta: exactly one persistent fill per screen (Try on in Studio; none on Collections / Search reset / Alternatives).
- Exports (lookbook, sealed card, process strip, taste card) carry grid + wordmark + seal.
- Tests: existing suites pass; add `studioUrlState` (`focus`, `source`), `mapToProductCardData`, `useOpenFindItems` scope routing.
- Mobile web (run on a real iPhone Safari, Android Chrome, and Instagram's in-app browser): no `100vh`; bars clear the Safari toolbar and the home indicator; keyboard open hides bottom bars except the Alternatives search bar, which sits directly above the keyboard; pull-down never reloads; long-press on a worn piece never shows the OS image sheet; row swipe from the left edge does not navigate Back; pinch on the mannequin does not zoom the page and scroll still works above/below it; share from result/board/replay opens the native sheet with an image attached, and in Instagram falls back to the save-image screen; exports are never blank (CORS); Lighthouse PWA installable; push arrives on an installed iOS 16.4+ device with the app closed.

---

## 15. Decision log

| Decision | Outcome |
|---|---|
| Working copy | design originals never edited; all canvas work in the `updated` copy (folder `updated/`, or ` updated`-suffixed files); "updated" is a file name only, never on a screen |
| Tabs | Collections · Studio · Search; Profile via Collections header only |
| Explore | inline 4th Collections tab; shares `CuratedCollectionRows` with Search reset |
| Layering | `[P2]` design only |
| Nested / shared boards | `[P2]`; reserve `Share` + stacked tile |
| Find items scope | state-aware: look vs piece; six doors |
| Studio header | back chevron only; no look title, no ✦, no draft line; job pill at the right while a try-on runs; auto-name lives on the Creations tile |
| Studio controls | two vertical stacks of 32 px discs on the container's bottom corners: Undo2 over Redo2 (left), RotateCcw over Share (right) |
| Focus | container keeps 593 h, zone zooms inside it; 253 h overlay sheet (30 % of the screen) with a square carousel at the left (dots + chevrons, no thumbnails), details right; details tap → Alternatives |
| Piece toolbar | **none** — a control appears once per screen; row X / LayoutGrid, sheet Bookmark, action-bar Globe cover every piece action |
| Outfit cards | name only; no piece count anywhere (community grid alone adds a creator line) |
| Cold start | "Your look" 32 h header · START FROM label · tiles; no sentence |
| Alternatives layout | full-width 208 h piece card (details left, carousel right) · source and slot rows right-aligned · two-column rack · search bar docked at the bottom, rides up on the keyboard, worn piece pre-loaded as reference |
| Alternatives wear | tile tap wears and returns to Studio focus on that slot; tile Bookmark saves in place |
| For you | board-aware similarity in board detail; curated feed after boards; **no reason chips** |
| Share nudge | after try-on result only |
| Split-view avatar | dropped; 40 px header thumb; no split view |
| Category source | `type_category` bucketed via map, then ingestion enum |
| Buy | replaced by Find items everywhere; no price in-app |
| Facet room | removed; occasion chips under the bar |
| Motion policy | still at rest · alive on touch · busy while working; mannequin breath only idle |
| The wait | WaitDeck (garment · fact · prompt · exit) + vocabulary; no streaks/rewards |
| Signalling | lookbooks · sealed card · process replay · taste card · community attribution |
| Whole-look shuffle | dropped |
| Drag-to-wear | `[P2]`; tap + focus sheet first |
| Process replay | 6-frame strip now, MP4 `[P2]` |
| Sound | none |
| Platform | mobile web first: iOS Safari · Android Chrome · in-app browsers; desktop kept, not designed for; inputs top-anchored except the bottom-docked Alternatives search bar |
| Away notification | PWA + Web Push gated on install; in-app pill for everyone; no promise made to uninstalled users |
| Install nudge | once, after first reveal (A2HS is still the web app — no store build) |
| Haptics | Android-only progressive enhancement; never described in UI |
| Perf floor | iPhone-class; frame-drop detection switches to reduced motion |
| Share cards | pre-rendered on mount; native share inside the tap; save-image fallback in in-app browsers |

**Conflicts resolved:** piece-action redundancy → one control per screen, no toolbar (gesture map §2.5) · one `Share` icon → two-option sheet · "no callouts" → copy whitelist in `design.md`, no Studio title · terracotta rule → transient exemption · focus sheet vs WaitDeck → try-on clears focus · Studio header load → chevron + job pill only · Find items doors 7 → 6 · top-anchored inputs vs. Alternatives search → bottom-docked, one documented exception.
