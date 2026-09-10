# Atlyr component spec sheet

The reference for building app UI. Everything here is derived from
[design.md](design.md) (visual law) and the Claude Design bundle's
`updated/*.dc.html` sources. **design.md wins any conflict**, and
[DESIGN_NOTES.md](DESIGN_NOTES.md) overrides the brief on behaviour.

Prop signatures below are transcribed from each component's `data-props`
schema in the bundle, so they are the design's actual contract, not a
paraphrase.

Frame: **390 × 844**. Mobile web first — iOS Safari, Android Chrome,
in-app browsers. Desktop is kept, not designed for.

## The one idea

Every component is a single renderer. A call site changes **size** and a
small closed variant set — nothing else. The design was authored this way:
its own controls are size knobs.

| Component | Size knob | Range |
|---|---|---|
| `ProductSheet` | `mediaWidth` | 84–300 px (default 156) |
| `Figure` | `pad` | 0–20 % (default 0) |
| `CuratedCollectionRows` | `perRow` | 2–6 (default 4) |
| `ProductTile` | `size` | `default` \| `small` |
| `OutfitCard` | `tilt` | −0.6…0.6° |

Where a screen needs more than size, it picks a **preset**, never raw
values. This is the pattern
[outfit-inspiration-presets.ts](../../src/design-system/primitives/outfit-inspiration-presets.ts)
already proves in this codebase — 7 presets over 1 renderer, reaching 11
files, with AGENTS.md enforcing the invariant.

## Foundations

### Colour
| Token | Hex | Use |
|---|---|---|
| cream | `#F3ECDF` | ground |
| ink | `#2E2A24` | text, icons, structure |
| ink-deep | `#24201A` | dark rooms |
| terracotta | `#B3542E` | **exactly one persistent filled action per screen** |
| gold | `#C9A227` | provenance only — कलागृह mark, seals, ✦ YOURS, export wordmark. Never a border, button or callout |
| muted | `#EDE5D4` | image blocks |
| hairline | `#E4DAC8` | all 1 px borders |
| taupe | `#A79C88` | secondary text |

These already exist as `--ink`, `--terracotta`, `--gold`, `--hairline`,
`--taupe` in [src/index.css](../../src/index.css). This is a formalisation,
not a new palette.

Transient toasts and the job pill are exempt from the one-terracotta rule.
A disabled primary is **outlined, never a lighter terracotta**.

### Type — fixed px, 10.5 floor
| Role | Token | Spec |
|---|---|---|
| Screen title | `text-title` | Bodoni Moda 500 · 26 in-header / 34 page-top · line 1.05 |
| Moment line | `text-moment` | Bodoni Moda 400 · 22 |
| Row label / button | `text-label` | Hanken 600 · 15 |
| Body / row value | `text-body` | Hanken 400 · 14 (taupe when secondary) |
| Card name | `text-card` | Hanken 600 · 13 · one line, ellipsis |
| Section label | `text-section` | Hanken 600 · 10.5 · tracking .14em · uppercase · taupe |
| Eyebrow / chip | `text-chip` | Hanken 500 · 11 · tracking .08em |
| कलागृह mark | `font-deva` | Noto Serif Devanagari · Collections header only |

Two families carry the app: **Bodoni Moda** for titles and moments,
**Hanken Grotesk** for anything you operate. Nothing below 10.5 px anywhere.

Desktop scaling comes from redefining these seven variables once inside
`@media (min-width:1024px)` — never from per-component clamps. The existing
`--fluid-*` ramp is not used on app surfaces: it bottoms out at 6.5–9.5 px
and cannot express the 10.5 floor. `--fluid-mark-firstrun` and
`--fluid-mark-landing` stay — brand marks are exempt from the UI scale.

### Sizes and radii
```ts
CONTROL = { primary:44, secondary:40, icon:40, field:40,
            chip:26, pieceRow:34, detailRow:64,
            header:32, headerTitle:52, nav:55 }
RADIUS  = { control:3, card:5, frame:6, seal:2 }
ICON    = { bar:20, row:16, chip:14 }
LAYOUT  = { gutter:16, gap:8, frame:390 }
```
Borders are 1 px hairline. No shadows except a frame's own. Two columns at
phone width — never `auto-fit`.

`RADIUS.control` (3 px) is the one value in the documented scale with no
Tailwind token today, which is why `rounded-[3px]` appears 57 times —
including inside the design system itself.

### Icons — one per meaning
Screens import `Icons.*` from `src/design-system/icons.ts`, never
`lucide-react` directly.

`Bookmark` save (outline/filled) · `SquareUserRound` try on · `Globe` find
items · `Share` · `Undo2`/`Redo2` · `RotateCcw` restore · `LayoutGrid`
alternatives · `Shirt`/bottoms glyph/`Footprints`/`Layers` slots · hanger /
`Bookmark` / `Compass` sources · `Camera` · `ListFilter` · `X` ·
`UserRound` · `ChevronLeft`/`ChevronRight`.

**Save is the bookmark everywhere — never a heart.** Active nav is the ink
icon: no pill, no fill.

## The nine components

Each **extends** an existing file. None starts from scratch.

### 1. Figure — the placement mannequin
Extends [AvatarRenderer.tsx](../../src/features/studio/components/AvatarRenderer.tsx)
(922 ln); absorbs `PlacementAvatarRenderer.tsx` (741). Uses the canonical
[renderBox.ts](../../src/features/studio/constants/renderBox.ts).

```ts
{ top?: boolean         // default true  — slot filled
  bottom?: boolean      // default true
  shoes?: boolean       // default true
  layer?: boolean       // default false — [P2], nothing sets it
  dark?: boolean        // default false — ink-deep ground
  breathe?: boolean     // default true  — the only idle animation in the app
  focusZone?: 'none'|'top'|'bottom'|'shoes'   // scales so the zone fills the frame
  pad?: number }        // 0–20 %
```

Fills its container edge to edge. Filled plate = worn garment; dashed
plate = open slot. Focusing a slot scales the figure so that zone fills the
frame.

### 2. OutfitCard — the look tile
Extends [OutfitInspirationCard.tsx](../../src/features/studio/components/OutfitInspirationCard.tsx)
(671) with its existing tile + presets. Already the correct shape — copy
this pattern, don't replace it.

```ts
{ title: string
  by?: string           // community rails only
  saved?: boolean
  dark?: boolean        // one tile in five, community rails
  tilt?: number         // −0.6…0.6°, fixed at mount
  top?, bottom?, shoes?: boolean }
```

Image to the hairline, then a **fixed 40 h footer carrying the name alone**,
one line ellipsised, so a grid stays level whatever the titles do. Bookmark
top-right with a 32 px hit area. **No piece count, ever.**

### 3. ProductTile — the piece tile
Extends [product-alternate-card.tsx](../../src/design-system/primitives/product-alternate-card.tsx)
(6 consumers). Absorbs `short-product-card.tsx` and the inline card bodies
in `RackGrid`, `CatalogueMatchRack`, `WebMatchRack` — the last two are near
byte-identical to each other.

```ts
{ title: string
  size?: 'default'|'small'   // small drops the footer and the mark
  saved?: boolean
  worn?: boolean             // 2 px ink border + ✓ disc; does not respond
  mark?: boolean             // default true
  price?, brand?: string }   // OPTIONAL, default off — see additive-only note
```

Square image to the hairline with nothing over it but the bookmark; 40 h
footer, name only. Flat and square in the grid.

> The design specifies no price or brand. `price`/`brand` exist as optional
> props because this migration is additive — see
> [FRONTEND_MIGRATION_PLAN.md](FRONTEND_MIGRATION_PLAN.md). Brief §3.2
> removes them entirely; that is a later pass.

### 4. ProductRow — one worn piece
Extends `StudioSlotRows`; absorbs `CreationsTab` piece rows. **34 h.**

```ts
{ slot: 'top'|'bottom'|'shoes'
  label?: string
  empty?: boolean          // dashed row, plus glyph + slot name
  removable?: boolean      // default true  — leading X
  alternatives?: boolean } // default true  — trailing LayoutGrid
```

`[X] [slot icon] name … [LayoutGrid]`. Swipe ← removes, → opens
alternatives. Body tap focuses; tapping the item name opens details. No
brand, no price.

### 5. SearchBar
Extends [filter-search-bar.tsx](../../src/design-system/primitives/filter-search-bar.tsx)
(492 ln, 5 consumers). Absorbs `filter-sort-bar.tsx` (1 consumer) and
`category-filter-bar.tsx`.

```ts
{ mode: 'idle'|'focused'|'results'|'collapsed'
  value?: string
  chip?: 'wardrobe'|'saves'|'explore'|'products'|'outfits'
  thumb?: boolean          // reference image rides inside the field as a chip
  dock?: 'top'|'bottom' }  // bottom = Alternatives, rides the keyboard
```

40 h field, hairline on white, lens leading and camera trailing. Once there
are results the camera gives way to a clear, and the source segment sits
below the field. Where space is tight the bar collapses to two icons and
springs open over the row beneath.

Search bars in Products / Outfits tabs **scroll with content** — not sticky.

### 6. Nav
Extends [bottom-nav-bar.tsx](../../src/design-system/primitives/bottom-nav-bar.tsx).
**55 h**, safe-area padded, `justify-around`.

```ts
{ active: 'collections'|'studio'|<third> }
```

`NAV_ITEMS` drops from 5 to 3. Active = ink icon, no pill, no fill. Present
on Collections, Studio and the third tab only; absent from Import,
Alternatives, try-on result, share sheets and read-only views.

> **OPEN DECISION:** the third tab is **Search** per [design.md](design.md)
> ("bottom nav on Collections, Studio, Search only") and brief §4, but
> `updated/Nav.dc.html` ships a `profile` button. Two sources against one.
> Resolve before phase 1 — it is a one-line change in `NAV_ITEMS`.

### 7. ProductSheet — one piece in full
Extends `ProductPeekCard`. Absorbs **both** `ProductSummaryCard`s — and
resolves the name collision between
`design-system/primitives/product-summary-card.tsx` and
`features/studio/components/ProductSummaryCard.tsx`, which currently export
the same symbol from different implementations.

```ts
{ layout: 'sheet'|'panel'          // sheet rises from the bottom; panel is a full-height column
  title: string                    // NB: `title`, not `name`
  slot: 'top'|'bottom'|'shoes'
  showSlot?: boolean               // default false
  attributes?: string              // pipe-delimited → chips
  mediaWidth?: number              // 84–300 px, default 156
  corner?: 'none'|'close'|'alternatives'|'search'
  actions?: 'icons'|'primary'|'save-search'|'save-try'|'none'
  saved?: boolean }
```

Always horizontal: a square carousel with its dots inside the bottom edge
and chevrons — **no thumbnails** — on one side, details on the other: name,
its slot, its attributes as chips, then bookmark and try-on as icon
buttons. No brand, price or description.

As a sheet it rises from the bottom under the focused figure; as a panel it
fills a narrow full-height column beside the rack and the two sides stack.

### 8. CuratedCollectionRows
Extract `visibleCollections` from `SearchScreen.tsx`. Built on the new
`Rail`. Shared by Collections › Explore and the Search reset state.

```ts
{ collections: string[]    // one curated collection per row
  perRow?: number }        // 2–6, default 4
```

Collection name as the section label, then a horizontal rail of 150 × 210
look tiles that scrolls on its own.

### 9. WaitDeck
`NEW`, in `src/features/tryon/` (the directory exists). **164 h**, sits
under the figure while a look renders.

```ts
{ card: 'garment'|'fact'|'prompt'|'exit'
  term: string             // set in Bodoni
  attributes?: string
  terms?: number }         // 1–999, footer "+1 · {n} terms in your vocabulary"
```

Four kinds of card — the garment, its provenance, an invitation, and the
way out — with dots for position in the deck. Cards rotate ~8 s or on
swipe; `exit` is always last. Dismissible.

**WaitDeck keeps its white card** — it is a deck. Every other bottom card on
Studio-family screens sits directly on the cream ground with no card.

Needs backend §12.9 / §12.13.

## Supporting primitives

| Primitive | Replaces | Spec |
|---|---|---|
| `Button` / `Chip` | 94 files importing `ui/button` ad hoc | 44 primary (terracotta, one per screen) · 40 secondary/icon · 26 chip · radius 3 |
| `Rail` `NEW` | 30 hand-written `overflow-x-auto scrollbar-hide` sites, `RecentStylesRail`, `FeedHeroBand`, both match racks | one scroller; `itemWidth`, `gap` |
| `ResultsGrid` | `product-results-grid`, `outfit-inspiration-grid`, `MixedMasonryGrid`, `AlternativesGrid`, `RackGrid`, `TryOnGrid` | 2 explicit columns at frame width, gap 8; **one** tilt hash (today duplicated 4×) |
| `EmptyState` / `Moment` | ~20 inline empty states; adopts the unused [ui/empty-state.tsx](../../src/components/ui/empty-state.tsx) | cold = Bodoni 22 in a dashed panel; notice = hairline card. Only copy-whitelist lines |
| `DetailRow` | `ProfileRow`, `ExpandableDetailCard`, `MenuItemButton` | 64 min-h · label 15/600 · value 14 taupe right · chevron last. Counts stated as facts |
| `ScreenHeader` | `CollectionsHeader`, `RackHeader`, 3 inline wordmark headers | 32 h (52 h with page-top title): back chevron when there is somewhere to go back to · Bodoni title · one action. Collections swaps the title for the कलागृह mark + "Your boards" and is the only screen carrying the mark. Search's header is the search bar itself |
| `SectionLabel` | [section-header.tsx](../../src/design-system/primitives/section-header.tsx) (2 consumers) | 10.5/600/.14em uppercase taupe |
| `Sheet` | Dialog + vaul + shadcn Sheet + hand-rolled `fixed inset-0` (5 parallel stacks) | one vaul-backed surface; `side`, `size` |
| `icons.ts` `NEW` | direct `lucide-react` imports | the registry above |

**Every screen names itself in the 52 px header row only** — Studio,
Alternates, Find items, Boards, Profile, Wardrobe.

## Motion

**Still at rest · alive on touch · busy while working.** Animation only on a
user action, on content arrival, or while a job runs. One idle exception:
the mannequin breathes. `prefers-reduced-motion` collapses all to opacity
fades.

| Primitive | Use | Spec |
|---|---|---|
| `SpringTap` | any tappable | scale .97 press, spring {500,30}; haptic light |
| `Tilt` | feed / board tiles **only** | ±0.6° fixed at mount; +1° toward scroll direction |
| `StaggerIn` | lists, grids, rails on mount | 40 ms stagger, 240 ms, ease.out, y 8→0 |
| `Land` | piece arriving on the mannequin | y −12→0, scale 1.04→1, spring {380,26}; haptic medium |
| `Slide` | piece leaving; sheets; tab content | 200 ms ease.inOut |
| `Reveal` | try-on result | ink curtain + gold seal popIn |
| `Breathe` | mannequin at rest | translateY 0→−2 px, 4 s sine |
| `Pulse` | job in flight | opacity .6↔1, 1.6 s |

Tokens: `motion.fast 120 · base 240 · slow 420`;
`ease.out [.2,.8,.2,1]`, `ease.inOut [.7,0,.2,1]`.

**`Tilt` never appears in Studio, Alternatives, or any screen with a form.**

Haptics are Android-only progressive enhancement (`navigator.vibrate`; iOS
has no API) and are never part of a described interaction. No sound.

## Laws — check every screen against these

1. Exactly one persistent terracotta fill (toasts and the job pill exempt).
2. Gold only where something is owned or made.
3. Nothing below 10.5 px.
4. Radii only 2 / 3 / 5 / 6.
5. A control appears once per screen — no floating toolbar duplicating a
   row or action-bar control.
6. Outfit cards carry a name only; no counts.
7. Studio never shows the look's name or a caption.
8. Words only from the copy whitelist in [design.md](design.md); everything
   else is an icon.
9. No idle animation except the mannequin breath.
