import type { PickTile } from "@/features/profile/components/PickRow"

/**
 * Fixed option sets for the figure step (canvas 6c2, vocabularies from the
 * Kalagriha handoff §6.1). Slugs are the stored values, labels are display copy.
 *
 * House rules baked in here:
 *  · Height is bands only, never a numeric input.
 *  · Body types are neutral nouns — no "ideal", no fruit shapes, no BMI.
 *  · Skin tone is numbered, never named, and never illustrated with photography
 *    or ethnicity labels (that ramp lives in src/shared/skin/melanin.ts, which
 *    is the renderer's own source of truth — see the note in UserDetailsPage).
 */

export interface HeightBand extends PickTile {
  /** Representative height written to profiles.height_cm when this band is picked. */
  cm: number
  minCm: number
  maxCm: number
}

export const HEIGHT_BANDS: HeightBand[] = [
  { id: "h_lt152", label: "< 5'0\"", sublabel: "<152 cm", cm: 148, minCm: 0, maxCm: 151 },
  { id: "h_152_160", label: "5'0\"–5'3\"", sublabel: "152–160", cm: 156, minCm: 152, maxCm: 160 },
  { id: "h_161_168", label: "5'4\"–5'6\"", sublabel: "161–168", cm: 165, minCm: 161, maxCm: 168 },
  { id: "h_169_176", label: "5'7\"–5'9\"", sublabel: "169–176", cm: 173, minCm: 169, maxCm: 176 },
  { id: "h_177p", label: "5'10\"+", sublabel: "177+", cm: 180, minCm: 177, maxCm: Number.MAX_SAFE_INTEGER },
]

/**
 * Which band an existing exact height falls into. Used for pre-selection only —
 * the stored value is never rewritten from this, so opening the screen with a
 * height of 172 cm highlights the 169–176 band without coarsening it to 173.
 */
export function bandForHeight(cm: number | null): string | null {
  if (typeof cm !== "number" || !Number.isFinite(cm)) return null
  return HEIGHT_BANDS.find((band) => cm >= band.minCm && cm <= band.maxCm)?.id ?? null
}

/**
 * Not currently rendered — the body-type row was pulled from 6c2 for now. Kept
 * because it is the handoff's fixed vocabulary (§6.1): neutral nouns only, no
 * "ideal", no fruit shapes, no BMI. Re-adding the row is one <PickRow> in
 * UserDetailsPage.
 */
export const BODY_TYPES: PickTile[] = [
  { id: "petite", label: "petite", placeholder: "FIGURE" },
  { id: "straight", label: "straight", placeholder: "FIGURE" },
  { id: "curvy", label: "curvy", placeholder: "FIGURE" },
  { id: "athletic", label: "athletic", placeholder: "FIGURE" },
  { id: "mid_size", label: "mid-size", placeholder: "FIGURE" },
  { id: "plus", label: "plus", placeholder: "FIGURE" },
]

export const SIZES: PickTile[] = [
  { id: "xs", label: "XS" },
  { id: "s", label: "S" },
  { id: "m", label: "M" },
  { id: "l", label: "L" },
  { id: "xl", label: "XL" },
  { id: "xxl", label: "XXL" },
  { id: "unknown", label: "not sure", dashed: true },
]

export const GENDERS: PickTile[] = [
  { id: "female", label: "Female" },
  { id: "male", label: "Male" },
]
