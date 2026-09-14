// Design tokens from docs/redesign/design.md.
// Mirrored in src/index.css (CSS vars) and tailwind.config.ts — keep all three in sync.
// Use the Tailwind classes in markup; use these constants only where TS needs a number.

/** Control heights, px. */
export const CONTROL = {
  primary: 44,
  secondary: 40,
  icon: 40,
  field: 40,
  chip: 26,
  pieceRow: 34,
  detailRow: 64, // minimum, not fixed
  header: 32,
  headerTitle: 52,
  nav: 55,
} as const;

/** Corner radii, px. Nothing outside this set.
 *  V2 (Sep 2026) inverted the old scale: chips used to be the roundest thing
 *  on screen (a pill) and buttons the sharpest (3px). Now it is 8px on
 *  buttons/tiles/inputs/bands and 6px on chips — measured across the V2
 *  frames as 147x 8px, 67x 6px, and essentially nothing else. */
export const RADIUS = {
  control: 8, // buttons, fields, tiles
  card: 8,
  frame: 8, // frames, bands, Studio canvas
  chip: 6,
  seal: 2, // unused in V2; kept for the badge step
} as const;

/** Icon size by container, px. */
export const ICON = {
  bar: 20,
  row: 16,
  chip: 14,
} as const;

export const LAYOUT = {
  gutter: 16,
  gap: 8,
  frame: 390, // the width screens are drawn for
} as const;

/** Durations in ms, easings as cubic-bezier points. */
export const MOTION = {
  fast: 120,
  base: 240,
  slow: 420,
  ease: {
    out: [0.2, 0.8, 0.2, 1],
    inOut: [0.7, 0, 0.2, 1],
  },
} as const;

/** What each type role resolves to at the 390px frame. 10.5 is the floor. */
export const TYPE_AT_FRAME = {
  titleLg: 34,
  title: 26,
  moment: 22,
  label: 15,
  body: 14,
  card: 13,
  chip: 11,
  section: 10.5,
} as const;

export type ControlSize = keyof typeof CONTROL;
export type RadiusToken = keyof typeof RADIUS;
export type IconSize = keyof typeof ICON;
export type TypeRole = keyof typeof TYPE_AT_FRAME;
