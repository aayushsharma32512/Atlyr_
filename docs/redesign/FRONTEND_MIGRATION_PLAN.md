# Frontend migration plan

Companion to [COMPONENTS.md](COMPONENTS.md) (what to build),
[design.md](design.md) (visual law) and
[Atlyr_Redesign_Brief.md](Atlyr_Redesign_Brief.md) (why, plus backend
contracts). [DESIGN_NOTES.md](DESIGN_NOTES.md) carries 29 behavioural notes
that override the brief.

## What this is

The redesign is **not a new visual language**. Its palette (`#F3ECDF`,
`#2E2A24`, `#B3542E`, `#C9A227`) is the Kalagriha/Tantu ramp already
declared in `tailwind.config.ts` and `src/index.css`. What the bundle adds
is precision. So this is an adoption problem:

| Signal | Count at start |
|---|---|
| `text-[Npx]` arbitrary font sizes | **528** |
| `text-fluid-*` token uses | 41 |
| Raw palette classes (`neutral/stone/gray/…`) | 478 |
| `rounded-[3px]` — the one radius with no token | 57 |
| Raw `#rrggbb` in `.tsx` | 115 |
| Hand-written `overflow-x-auto scrollbar-hide` rails | 30 files |
| Inline empty states (while `ui/empty-state.tsx` has **0** consumers) | ~20 |
| Product-card implementations | 8 |
| Grid implementations (tilt hash duplicated 4×) | 9 |
| Overlay stacks (Dialog / vaul / Sheet / hand-rolled `fixed inset-0`) | 5 |

**Goal:** one component per meaning, where a call site changes only `size`
and a small variant set. The design stays thematic because there is exactly
one place a theme lives.

## Ground rules

**Scope: the user-facing app only** — `src/features/**`,
`src/design-system/**`, `src/layouts/`.

**Additive only.** Nothing is deleted. Commerce fields survive as optional
props. This diverges from brief §3.1 (delete the legacy tree) and §3.2
(strip price/brand/rating) by decision: lower risk, at the cost of duplicate
implementations persisting until a later pass.

**Phases 0–5 need no new backend.** They ship against the existing API. The
repo already has 23 edge functions; new backend starts at phase 6 and is
mostly extensions, not new services.

### Out of scope

| Excluded | Why |
|---|---|
| `components/hitl/` (5341 ln), `components/ingestion-automated/` (25 files), `components/ingestion-v2/`, `pages/admin/` | Operator tooling, already on a separate theme (`data-surface="ops"` via `useSurfaceTheme.ts`). The bundle specifies none of it |
| `features/landing-page/` + `reactbits-components/` (18 files) | Own parallel visual system; separate project |
| `components/ui/` (55 shadcn files) | The substrate primitives build on. Only `similarity-badge.tsx` (hardcoded `bg-green-500/90`) gets tokenised, because app surfaces render it |
| Legacy `components/{home,studio,search,collections,profile}` | Guest-only via `pages/Index.tsx`; additive-only leaves it |

Lint rules must not fire on any of these.

## Backend reality

Already live, covering more of brief §12 than it implies:

| Existing edge functions | Cover |
|---|---|
| `inspiration-import`, `inspiration-import-detector-callback` | The whole Find-items loop |
| `search-v2`, `search-outfits-v2`, `vector-search`, `search` | Search, alternates ranking |
| `tryon-generate`, `tryon-generate-summary`, `vto` | Try-on |
| `likeness-*` (8 functions) | Avatar / likeness |
| `summaries`, `enrich-outfit`, `*-batch-enrichment` | Enrichment |

Genuinely new, all phase 6+:

| Brief | Needs | Phase |
|---|---|---|
| 12.6 | **Extend** `inspiration-import`: `sourceUrl`, `mode:"single"`+slot, detector adds shoes | 6 |
| 12.9 / 12.13 | `garment_lore`, `craft_facts`, `user_vocabulary` + wait-deck payload | 7 |
| 12.12 | `push_subscriptions`, `send-push` (VAPID) | 7 |
| 12.8 | `outfits.is_public` respected in the community feed | 8 |
| 12.5 | RPC `similar_outfits_for_board` | 8 |
| 12.1 / 12.2 / 12.4 / 12.7 | `implied_name`, `get_product_facets`, `search-tags`, `wardrobe-ingest` | 9+ |

Phase 5's filter work wants 12.2 but ships without it — the brief allows a
client-side bucket map behind the same `useProductFilterOptions` hook.

## Phase 0 — Foundations

No visual change. Everything later consumes this.

- `src/design-system/tokens/` **NEW** — `CONTROL`, `RADIUS`, `ICON`,
  `LAYOUT` as TS constants, mirrored as CSS vars so `className` and inline
  style resolve to one source.
- `tailwind.config.ts`: add `borderRadius.control: 3px`; the seven
  `fontSize` roles; `height.control-*`; and wire the existing `--shadow-*`
  ladder into the theme — it is declared at `index.css:185` but reachable
  from no utility today, so components fall back to raw `rgba()` in
  `.shadow-premium`.
- `src/design-system/icons.ts` **NEW** — the registry from COMPONENTS.md.
- **Fix three silent bugs found while mapping the token layer:**
  - `.pin-tilt-1..6`, `.animate-pop-in` and `.scrollbar-hide` are each
    defined **twice** in `src/index.css` with different values; the later
    definition silently wins.
  - `stat-chip.tsx` builds a `size-` class dynamically from its `iconSize`
    prop, which Tailwind purges — that prop does nothing.
  - `MiniStudioTour.tsx` uses `font-outfit`, a family absent from
    `tailwind.config.ts`, so it silently no-ops. (Landing page — fix only if
    convenient; it is out of scope.)
- `eslint.config.js`: ban `text-[Npx]`, `rounded-[Npx]`, raw hex in
  `className`, and raw palette classes — scoped to in-scope paths, **as
  warnings**. Without this the counts above regrow.
- Re-measure every grep baseline against in-scope paths only, and record the
  numbers here.

## Phase 1 — Shell

`Nav` 5→3 (third item open), `AppShellLayout`, `ScreenHeader`,
`SectionLabel`. Platform base from brief §2.6: `100dvh` everywhere a bar is
pinned (never `100vh`), `env(safe-area-inset-*)`, `overscroll-behavior-y:
contain`, keyboard hides bottom bars, manifest colours to ink/cream (they
are slate/white today, so the splash flashes).

**Decide here:** if the Home tab goes, `/home` needs a redirect and
`HomeScreen` (2147 ln) becomes present-but-unreachable. Additive-only keeps
the file either way.

## Phase 2 — Motion + the card family

- `src/features/motion/` **NEW** on the installed `framer-motion@12` —
  `SpringTap`, `Tilt`, `StaggerIn`, `Land`, `Slide`, `Breathe`, `Pulse`.
  `src/lib/haptics.ts` **NEW** (Android-only progressive enhancement).
- `ProductTile` / `ProductRow` / `ProductSheet` on one `ProductCardData`
  DTO, commerce optional. Mapper goes in `services/shared/transformers/`
  (the directory exists).
- **Fix the inverted layering:** `outfit-inspiration-tile.tsx` and
  `recent-styles-rail.tsx` import from `@/features/studio/*` — the design
  system depends on feature code. Move the shared types down.
- **Resolve the name collision:** `design-system/primitives/product-summary-card.tsx`
  and `features/studio/components/ProductSummaryCard.tsx` both export
  `ProductSummaryCard` from different implementations.

## Phase 3 — Collections (`03 Collections.dc.html`)

Tab split (Moodboards · Creations · Products · Explore), board cover tiles,
For-you, footer, board detail at `/collection/board/:slug`.
`Rail` and `ResultsGrid` land here first. **Lint rules → error.**

## Phase 4 — Studio (`04 Studio.dc.html`)

Vertical control stacks (Undo2 over Redo2 left, RotateCcw over Share right,
32 px discs), slot rows on `ProductRow`, action bar, progressive dressing,
starter looks. The brief calls progressive dressing + starter looks the
highest feel-per-effort in the whole redesign.

## Phase 5 — Alternatives

Full-width 208 h piece card (`ProductSheet` with the carousel right),
right-aligned source and slot rows, `SearchBar dock="bottom"` riding the
keyboard via `visualViewport`, wear-and-return to Studio focus.

## Phase 6 — Focus + Find items (`07 Inspiration Loop.dc.html`)

`?focus=slot` zooming inside the container, 253 px sheet, six-door
`useOpenFindItems()`.

**`/inspiration-import` already works** — a 742-line screen,
`CandidatePicker`, `CatalogueMatchRack`, `WebMatchRack`,
`InspirationSourceInput`, `ImportMannequinPreview`, a service, query keys,
**6 test files**, and two live edge functions. This phase re-wires entry
points into machinery that already runs; it does not build a loop. Backend
§12.6 **extends** the existing function rather than adding one.

Keep those 6 tests green — this is the only in-scope feature area with real
coverage. Note the two match racks are also touched in phase 2, where they
collapse into `ProductTile` + `Rail`.

## Phase 7 — Try-on

`WaitDeck`, reveal, result header. Needs §12.9, §12.10, §12.13.
PWA lands here or earlier — `vite-plugin-pwa` is the one missing dependency
(`framer-motion`, `gsap`, `modern-screenshot`, `vaul` are all installed).

## Phase 8 — Search + Profile (`05 Search.dc.html`, `06 Profile.dc.html`)

Reset state, curated rows, community attribution, taste card. Needs §12.8.

## Phase 9 — Artefacts

Lookbook card, sealed look card, process replay.

## Open decisions

1. **Nav third tab** — Search (design.md + brief §4) or Profile
   (`Nav.dc.html`). One-line change in `NAV_ITEMS`. Blocks phase 1.
2. **Home / Feed** — keep, redirect, or leave present-but-unreachable.
   `02 Feed.dc.html` exists in the bundle, but the brief kills `HomeScreen`.
3. **PWA timing** — install `vite-plugin-pwa` now or with phase 7.

## Verification, every phase

- `bun run typecheck` / `bun run lint` no worse than the known-red baseline
  in `CLAUDE.md` (7 type errors, 275 lint errors / 143 warnings). New lint
  rules must not add errors in files the phase does not touch.
- `bun test` — 8 known failures, no new ones. Add tests for the tokens
  module and each preset table. Use `bun test <path>`, **not `bunx jest`**
  (no TS transform is configured; every `.test.ts` fails to parse).
- `bun run dev`, then compare each migrated screen at **390 × 844** against
  its artboard in `08 Full View.dc.html` and the bundle's
  `project/screenshots/`.
- Grep gates — counts that only fall: `text-\[[0-9.]+px\]`,
  `rounded-\[3px\]`, raw hex in `className`, `overflow-x-auto` outside
  `Rail`.
- The nine laws in [COMPONENTS.md](COMPONENTS.md), per screen.
- `prefers-reduced-motion` audit once phase 2 lands.
- Mobile web, on real devices: no `100vh`; bars clear the Safari toolbar and
  home indicator; pull-down never reloads; row swipe from the left edge does
  not navigate Back; pinch on the mannequin does not zoom the page.
