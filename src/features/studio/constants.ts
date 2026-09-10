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
/**
 * The studio remembers the exact path you left it on so the bottom-nav tab drops
 * you back where you were. That memory is scoped by gender: switching the profile
 * from male to female must not replay a male outfit, the same way the home feed
 * carries gender in its query keys and refetches on its own.
 */
export function studioLastPathStorageKey(gender: "male" | "female" | null | undefined): string {
  return `studio:last-path:${gender ?? "neutral"}`
}

export function rememberStudioLastPath(gender: "male" | "female" | null | undefined, fullPath: string) {
  if (typeof window === "undefined") {
    return
  }
  try {
    window.sessionStorage.setItem(studioLastPathStorageKey(gender), fullPath)
  } catch {
    // Quota / private mode — the tab just falls back to a fresh studio.
  }
}

/** `/studio/product/:id` and its design-system twin — a detail view, not a Studio state. */
export function isStudioProductPath(path: string): boolean {
  return path.startsWith("/studio/product/") || path.startsWith("/design-system/studio/product/")
}

/** The path the studio tab should open, for this gender. `/studio` when there is nothing to resume. */
export function readStudioLastPath(gender: "male" | "female" | null | undefined): string {
  if (typeof window === "undefined") {
    return "/studio"
  }
  let storedPath: string | null = null
  try {
    storedPath = window.sessionStorage.getItem(studioLastPathStorageKey(gender))
  } catch {
    storedPath = null
  }
  if (!storedPath) {
    return "/studio"
  }
  // The product page sits under /studio but is a detail view opened from any
  // tab, so it is never what the Studio tab should resume. Checked on read as
  // well as on write: a path stored before that rule existed outlives the fix,
  // because sessionStorage survives until the tab closes.
  if (isStudioProductPath(storedPath)) {
    return "/studio"
  }
  if (storedPath.startsWith("/studio")) {
    return storedPath
  }
  if (storedPath.startsWith("/design-system/studio")) {
    return storedPath.replace("/design-system", "") || "/studio"
  }
  return "/studio"
}

