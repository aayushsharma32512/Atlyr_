import type { MannequinSegmentName, StudioRenderedZone } from "@/features/studio/types"

export const MANNEQUIN_SEGMENT_NAMES: MannequinSegmentName[] = ["head", "neck", "torso", "arm_left", "arm_right", "legs", "feet"]

export const MANNEQUIN_SEGMENT_NAME_SET = new Set<MannequinSegmentName>(MANNEQUIN_SEGMENT_NAMES)

export const MANNEQUIN_SEGMENT_ALIASES: Record<string, MannequinSegmentName[]> = {
  arms: ["arm_left", "arm_right"],
}

export const STUDIO_ZONES: StudioRenderedZone[] = ["top", "bottom", "shoes"]

export const DEFAULT_VISIBLE_SEGMENTS: MannequinSegmentName[] = ["legs", "feet", "torso", "arm_left", "arm_right", "neck", "head"]

export const STUDIO_ZONE_SEGMENT_DEFAULTS: Record<StudioRenderedZone, MannequinSegmentName[]> = {
  top: ["head", "neck", "torso", "arm_left", "arm_right"],
  bottom: ["torso", "legs", "feet"],
  shoes: ["feet"],
}

export const MANNEQUIN_SKIN_HEXES = new Set(
  [
    "#fddfc6",
    "#fee0c8",
    "#fee0c7",
    "#fee0c6",
    "#fdd8bc",
    "#f9cfae",
    "#fdd0b3",
    "#fbe1ca",
    "#fbe1cb",
    "#fbe2cb",
    "#fbe3cb",
    "#fce2cb",
    "#fce3cb",
    "#fce3cc",
    "#fde1c8",
    "#fde1c9",
    "#fde2ca",
    "#fee2ca",
    "#fce6cf",
    "#fce3cd",
    "#fde5ce",
    "#fde9d1",
    "#fee4cd",
    "#fde0c8",
    "#fde0c7",
    "#fde0c6",
    "#fee0ce",
    "#fee6ce",
    "#ffe0c6",
    "#ffe7ce",
  ].map((hex) => hex.toLowerCase()),
)

/**
 * Placement/image coordinates sent from Supabase may be `null`.
 * This helper normalizes everything to `0` so downstream math stays predictable.
 */
export function ensurePlacementValue(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}
export const STUDIO_LAST_PATH_STORAGE_KEY = "studio:last-path"

