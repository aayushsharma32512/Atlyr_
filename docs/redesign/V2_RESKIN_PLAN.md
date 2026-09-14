# V2 reskin plan — Kalagriha cream → charcoal/violet

Source of truth: `Atlyr App Design System Creativity Focus/updated/`
- `09 Full View v2.dc.html` lines **21–826** = V2 (28 screens). Lines **827+** are the old baseline, kept for comparison — **do not read tokens from there.**
- `10 Design Doc.dc.html` — the written spec (§2 Visual system is binding).
- `CLAUDE.md` in that folder — running decision log from Bipin.

---

## 0. Scope — LOCKED

**In:** colour · radius · icons · the "no white cards" fill rule. Purely what a pixel sees.

**Out — not touched, not in this PR, not "while I'm in there":**
- ❌ No wiring. No hooks, services, query keys, routes, props, state, handlers.
- ❌ No layout changes. Nothing moves, resizes, reflows, or restacks.
- ❌ No copy or IA changes. The design doc bundles a rename (Collections→Boards, lowercase everything, outfit→look, tops/lowers/kicks) — **we are not doing it here.** It touches routing.
- ❌ No new screens. V2 introduces Import inspiration, Selections, Find items, Kalagriha float, save-card bands — **none of it.**
- ❌ No control-height changes (see §1.6).

The geometry already matches. This is a token replacement plus one fill rule.

---

## 1. What changes

### 1.1 Palette — full replacement

V2 uses exactly **14 colours**. Measured by frequency across the V2 section:

| Role | V2 | Current | Note |
|---|---|---|---|
| Ground | `#F8F8F7` | `#F3ECDF` cream | every screen, every band |
| Ink | `#161616` | `#2E2A24` | text, icons, primary buttons |
| Charcoal | `#2B2B2B` | — | filled chips/callouts, voice type |
| Hairline | `#DCDCDA` @ **0.5px** | `#E4DAC8` @ 1px | *all* structure |
| Grey text | `#8A8A87` | `#A79C88` taupe | meta, counters, empty-slot icons |
| Body grey | `#6B6B69` | body-ink | secondary copy |
| Disabled | `#C6C6C2` | — | dimmed nav, inactive undo/redo |
| Accent | `#B94FE8` violet | `#B3542E` terracotta | **punctuation only** |
| Accent deep | `#8E2FC2` | `#C9A227` gold | |
| Accent tint | `#F5EAFB` | `#EAE1CE` editorial | |
| Fill greys | `#ECECEA` `#E2E2E0` `#E6E6E4` | `#EFEADF` `#F6F1E6` … | skeletons, wells |
| White | `#FFF` | `#FFF` | **reserved**: render figure, inputs, secondary buttons |

**Everything warm dies.** `--terracotta`, `--gold`, `--gold-deep`, `--gold-muted`, `--warp`, `--editorial`, `--on-ink-1/2/3`, `--placeholder-grid`, the `--hairline-2/3/4` ladder — all replaced by one hairline.

> **Trap, and it is the same trap twice.** `tailwind.config.ts` already warns that `gold` must never become `--accent` or every dropdown hover turns into a provenance cue. **Violet carries the identical constraint** — the spec says "punctuation only: active tab underline, selected heart, selected board chip, Studio nav icon, unread dot." Keep it a raw brand token (`--violet`). Never `--accent`.

### 1.2 Radius — the scale inverts

| Token | Current | V2 |
|---|---|---|
| `--radius-control` (buttons, fields) | 3px | **8px** |
| `--radius` (cards) | 5px | **8px** |
| `--radius-frame` | 6px | **8px** |
| `--radius-chip` | `9999px` (pill) | **6px** |
| `--radius-badge` | 2px | *(unused in V2 — leave the var, retarget later)* |

Today chips are the roundest thing on screen and buttons the sharpest. V2 flips both. Measured in the V2 section: 147× `8px`, 67× `6px`, and essentially nothing else.

### 1.3 Type — three new faces, one new role

| Role | V2 | Current |
|---|---|---|
| Screen title (h1) | **DM Serif Display** 400 · 22px/1.08 | Bodoni Moda |
| UI text | **Inter** 400/500 · 11–15px | Hanken Grotesk |
| Voice | **Fraunces italic** 500 · 14px · `#2B2B2B` | — **new role** |
| Devanagari | unchanged | Noto Serif Devanagari |

Font-*family* swaps are reskin and are in. **Font-size changes are not** — V2's h1 is 22px against your current `--type-title` 26px, but resizing type reflows layout, so the size ramp stays as is. Faces swap, sizes don't.

`--font-voice` is a new token (Fraunces italic). Adding the variable is in scope; *applying* it to specific copy is not, since nothing in the app currently has a "voice" role. It lands unused and ready.

### 1.4 The one structural rule: no white cards

> "One ground, one ink, one accent. No filled cards; structure comes from 0.5px hairlines. White is reserved for the render (figure) and for inputs/secondary buttons."

The only change that can't be done by retuning variables alone. Setting `--card: #F8F8F7` removes the fill correctly but leaves no hairline where the card edge was — so each `bg-card` site needs one classification:

- **ground + hairline** — most cards
- **stays white** — inputs, secondary buttons, the render figure

This is a fill-and-border swap. **Nothing moves**, so it stays inside the no-layout-change rule.

Tailwind has no 0.5px border — add a `border-hairline` utility emitting `0.5px` in the `@layer utilities` block of `index.css`.

### 1.5 Selection language — colour only

| State | V2 |
|---|---|
| Active tab / slot / segment | 2px **violet** underline, no fill |
| Active board chip | 1.5px violet border, violet text, no fill |
| Selected heart | violet fill + stroke |
| Chosen tile in a rack | 1.5px violet border, no tick |

`TabBar` is already `2px ink rule — no fill, no pill` at 36h. **One colour change**, ink → violet. The bones are already right.

### 1.6 Geometry — matches, and stays put

| | V2 | Current `CONTROL` | |
|---|---|---|---|
| header title row | 52 | `headerTitle: 52` | ✅ |
| bottom nav | 55 | `nav: 55` | ✅ |
| primary button | 44 | `primary: 44` | ✅ |
| secondary / icon | 40 | `secondary: 40` / `icon: 40` | ✅ |
| slot row | 32 | `pieceRow: 34` | ⚠️ −2 — **not changing** |
| chip / tab | 32 | `chip: 26` | ⚠️ +6 — **not changing** |

Four of six match exactly. The two that differ are height changes, i.e. layout — **flagged, not touched.** Say the word if you want them.

### 1.7 Icons

In scope, per "icon changes wherever needed". V2 names these explicitly:

| Icon | V2 |
|---|---|
| save / favourite | **heart** (replaces pin) |
| explore / find | **globe** |
| Boards tab | **folder** |
| Studio tab | **sparkles**, always violet (dimmed when inactive) |
| Try on | portrait-in-frame (unchanged) |
| Alternates title row | photo-search glyph |

Swapping the glyph inside `src/design-system/icons` is a skin change. **Renaming the tab it belongs to is not** — `navCollections` keeps its name even when it draws a folder.

---

## 2. Execution

### Phase 1 — token swap (one commit, fully revertable)
Touch only the three mirrored files: `src/index.css` (`:root`), `tailwind.config.ts`, `src/design-system/tokens/index.ts`.
- Replace the palette; keep dead warm var *names* as aliases where a rename would churn 100 files.
- Add `--violet`, `--violet-deep`, `--violet-tint`, `--charcoal`, `--disabled`, `--font-voice`.
- Flip the radius scale; add the 0.5px hairline utility.
- Swap the font `<link>` in `index.html` → DM Serif Display + Inter + Fraunces (keep Noto Serif Devanagari).
- Convert hex → the repo's HSL-triplet format **with a script**, not by hand.

Then screenshot. This is where we find out how much of the app actually obeys tokens.

**Also fix here:** `tailwind.config.ts` declares `dashed` **twice** in the `hairline` object (`--hairline-dashed`, then `--border-dashed`). The second silently wins; `--hairline-dashed` is dead code.

### Phase 2 — the no-white-cards audit
Classify every `bg-card` / `bg-white` site: ground+hairline, or genuinely white. Includes `BottomNavBar`'s `bg-card/95`.

### Phase 3 — shell chrome
`AppShellLayout`, `bottom-nav-bar`, `screen-header`, `tab-bar` (ink→violet), `search-bar`, `filter-search-bar`, `category-filter-bar`, `filter-sort-bar`, `left-action-rail`, `right-action-rail`, `wordmark-lockup`.

### Phase 4 — controls & overlays
`chip` (pill→6px), `icon-button`, `switch`, `ask-atlyr-button`, `tray-action-button`, `stat-chip`, `price-display`, `section-header`; then `bottom-sheet`, `filter-drawer`, `product-sheet`, `moodboard-picker-drawer`, `save-outfit-drawer`.

### Phase 5 — cards, tiles, grids
`outfit-card`, `product-tile`, `product-summary-card`, `product-alternate-card`, `short-product-card`, `outfit-inspiration-tile`, `garment-image`, `slot-row`, `product-results-grid`, `outfit-inspiration-grid`, `curated-collection-rows`, `recent-styles-rail`.

### Phase 6 — icon swaps
Heart, globe, folder, sparkles-violet, photo-search. Glyphs only; no identifier renames.

### Phase 7 — the leak surface
**180 hardcoded hex + 31 `rgba()`** in `src/` stay cream after Phase 1. Two clusters:
- `src/features/landing-page/**` — esp. `reactbits-components/` (`Orb`, `BlobCursor`, `MagnetLines`, `TextPressure`): WebGL/canvas with baked colours. Real work; arguably out of scope for a *shell* reskin.
- `src/components/ingestion-automated/**` + `AuthScreen`, `LoginPage`, `UserDetailsPage` — admin/ops. Only if the ops surface is in scope.

---

## 3. Decisions needed

1. **Which skins?** `:root` only, or also `:root[data-surface="ops"]` (admin) and `.dark`? V2 defines no dark mode, so `.dark` would be invented, not derived.
2. **Phase 7 landing page** — in or out? It's the largest chunk of non-token colour and it's canvas/WebGL, not CSS.

## 4. Guardrails

- `renderBox` from `src/features/studio/constants/renderBox.ts` is untouched.
- `--violet` must never become `--accent`.
- Known-red baseline stands (7 typecheck, 275 lint, 8 test failures). Leave touched files no worse; don't chase the rest.
- No file under `src/services/`, `src/features/*/hooks/`, or `src/features/*/queryKeys.ts` should appear in the diff. If one does, the scope rule was broken.
