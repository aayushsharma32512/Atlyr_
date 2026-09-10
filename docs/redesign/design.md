# design.md — Atlyr design rulebook

Read this file before any screen is produced. It governs every artboard, component and export and overrides anything in the brief that appears to conflict with it. The canvas files in `Atlyr App Design System_v2 Claude/` are the base; every screen is produced by applying the brief's per-frame changes to the matching frame there.

## Output rules

- Do not include any prompt text, instructions, notes, rationale, status tags, legends, section numbers, frame IDs or meta-commentary in the final output. Screens contain only what a user would see.
- The only words permitted on a screen are: product data (names, board titles, counts), and the lines in the Copy Whitelist below. Any other text is a defect.
- Do not render tokens such as `EXTEND`, `NEW`, `KILL`, `BE`, `[P2]`, `TODO`, `S1`, `C3`, component file names, hook names, or route paths.
- The current version is not in dialogue with prior revisions. Nothing is labelled "updated", "replaced", "was", "previously", "new", "v2" or "removed". Each screen is produced as if it were the first and only version.
- Placeholders are honest and labelled only inside the image area (a flat block), never with explanatory captions.
- No lorem ipsum. Product names are plausible implied names ("Cream cotton tee", "Indigo wide-leg trouser", "Tan kolhapuri"). Board titles are plausible ("Indie fusion", "Sangeet, but easy", "Monsoon office").
- Exactly one persistent terracotta-filled element per screen. Transient toasts and the job pill are exempt. Disabled primaries are outlined, never a lighter terracotta.

## Visual system

Cream `#F3ECDF` ground · ink `#2E2A24` text and structure · muted `#EDE5D4` · hairline `#E4DAC8` · taupe `#A79C88` secondary text · terracotta `#B3542E` for the single filled action · gold `#C9A227` only for provenance (the कलागृह mark, seals, ✦ YOURS, wordmark on exports; never a border, button or callout) · ink-deep `#24201A` for dark rooms.

Type: **Bodoni Moda 500** for titles and moments · **Hanken Grotesk** for interface · **Noto Serif Devanagari** only for the कलागृह mark on the Collections header.

Scale (nothing outside it):

| Role | Spec |
|---|---|
| Screen title | Bodoni Moda 500 · 26 px (in-header) / 34 px (page top) · line 1.05 |
| Moment line (reveal, cold state) | Bodoni Moda 400 · 22 px |
| Row label / button | Hanken 600 · 15 px |
| Body / row value | Hanken 400 · 14 px · taupe for secondary |
| Card name | Hanken 600 · 13 px · one line, ellipsis |
| Section label | Hanken 600 · 10.5 px · tracking 0.14 em · uppercase · taupe |
| In-card eyebrow / chip | Hanken 500 · 11 px · tracking 0.08 em (eyebrow uppercase; chip sentence case) |
| Minimum | 10.5 px. Nothing smaller anywhere. |

Sizes: primary button 44 h · secondary / icon button 40 h · chip 26 h · nav 55 h · header 32 h (52 h with a page-top title) · slot row 34 h · search field 40 h. Radii: 3 px buttons, chips, fields · 5 px cards · 6 px frames and the Studio canvas · 2 px seals. Borders are 1 px hairline; no shadows except the frame's own. Page gutter 16 px; grid gap 8 px; two columns at phone width, never auto-fit.

Header pattern (one, app-wide): 32 h · left = back chevron when there is somewhere to go back to · centre-left = Bodoni title · right = one action. Collections replaces the title with the कलागृह mark + "Your boards" and is the only screen that carries the mark. Search's header is the search bar itself.

Frame: 390 × 844. Bottom nav 55 h on Collections, Studio, Search only; absent in Import, Alternatives, try-on result, share sheets and read-only views.

## Motion

Still at rest, alive on touch, busy while working. Motion appears only on a user action, on content arrival, or while a job runs. The mannequin breathes; nothing else idles. Tilt (±0.6°) is used on board and feed tiles only, on the whole tile, never in Studio, Alternatives or on any screen with a form.

## Icon vocabulary

One icon per meaning, reused everywhere the meaning recurs. Bookmark = save (there is no heart anywhere) · SquareUserRound = try on · Globe = find items · Share = share · Undo2 / Redo2 · RotateCcw = restore · LayoutGrid = alternatives · Shirt / trousers glyph / Footprints / Layers = slots · hanger / Bookmark / Compass = sources Wardrobe / Saves / Explore · Camera · ListFilter · X · UserRound = profile · Plus with Link = add inspiration · Plus with Shirt = add to wardrobe. Icons 20 px in bars, 16 px in rows, 14 px in chips. Active nav = ink icon, no pill.

## Copy whitelist

| Moment | Line |
|---|---|
| Collections, no boards yet | Start a board. Anything you long-press lands here. |
| Studio, nothing worn | Start from a look, or from a photo. |
| Try-on started | Cooking. Keep styling — the pill turns gold when it's ready. |
| Try-on started, app installed with notifications on | Cooking. Keep styling — we'll tap you. |
| Result ready | Your look is ready. |
| Wait deck footer | +1 · {n} terms in your vocabulary |
| Board share card | {n} looks · curated by {name} |
| Look share card | Look #{n} · styled by {name} |
| After first reveal, once | Add Atlyr to your home screen — looks land even when you're away. |
| Section labels | FOR YOU · MORE LIKE THIS BOARD · FROM THE COMMUNITY · START FROM · WEARING · IN YOUR WARDROBE |
| Tabs and segments | Moodboards · Creations · Products · Explore · Wardrobe · Saves · Explore · Top · Bottom · Shoes |
| Buttons | Save · Try on · Find items · + Inspiration · + Wardrobe · Share look · Share the making · Apply · Clear |
| Headers | Your boards · Alternates · Your look · Profile |

Everything not listed is an icon.

## Platform

Mobile web in iOS Safari, Android Chrome and in-app browsers. Bars respect safe areas; layouts use dynamic viewport height; inputs are top-anchored; nothing depends on hover.
