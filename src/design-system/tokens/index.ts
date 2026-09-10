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

/** Corner radii, px. Nothing outside this set. */
export const RADIUS = {
  control: 3, // buttons, chips, fields
  card: 5,
  frame: 6, // frames, Studio canvas
  seal: 2,
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
