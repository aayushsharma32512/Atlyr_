// Slot glyphs lucide doesn't have. Paths taken from the bundle's SlotRow.dc.html.
// Props match lucide's so these drop in anywhere an icon goes.
import type { SVGProps } from "react";

type GlyphProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number | string;
};

const base = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor" as const,
  strokeLinejoin: "round" as const,
};

/** Trousers — the `bottom` slot. */
export function BottomsGlyph({ size = 24, strokeWidth = 1.7, ...props }: GlyphProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={strokeWidth} {...props}>
      <path d="M6 3h12l1 18h-5l-2-11-2 11H5L6 3Z" />
    </svg>
  );
}

/** A coat hanger — the Wardrobe source. Path from the bundle's source segment. */
export function HangerGlyph({ size = 24, strokeWidth = 1.7, ...props }: GlyphProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={strokeWidth} strokeLinecap="round" {...props}>
      <path d="M12 4a2 2 0 1 1 2 2" />
      <path d="M12 6v3" />
      <path d="m12 9-8 6h16z" />
      <path d="M3 19h18" />
    </svg>
  );
}

/** A shoe in profile — the `shoes` slot. */
export function ShoeGlyph({ size = 24, strokeWidth = 1.7, ...props }: GlyphProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={strokeWidth} strokeLinecap="round" {...props}>
      <path d="M2 17h20v3H2z" />
      <path d="M2 17c0-3 1-4 3-5l4-2 2 3 4-1 3 2c2 1 4 2 4 3" />
    </svg>
  );
}
