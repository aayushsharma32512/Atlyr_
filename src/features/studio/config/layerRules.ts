import type { StudioProductTraySlot } from "@/services/studio/studioService"

/** How one kind of garment sits on the figure. Matched against the top's `type_category` text. */
export type LayerRule = {
  /** A name for people. Never matched. */
  kind: string
  /** Whole words, lower case. Any one of them in the top's type text selects this rule. */
  matches: readonly string[]
  /** Fallback when no rule matched the type text: whole words looked for in the product name. Opt in per rule. */
  nameMatches?: readonly string[]
  /** Slot names, front-most first. Omit to keep the base order. */
  order?: readonly StudioProductTraySlot[]
  /** The garment covers the hips: an empty bottom slot draws no stand-in. */
  hidesBottomPlaceholder?: boolean
  /** One line, for the next person who edits this file. */
  why: string
}

/** Order when no rule matches: the top in front, shoes at the back. */
export const BASE_LAYER_ORDER: readonly StudioProductTraySlot[] = ["top", "bottom", "shoes"]

/** First match wins. Every entry is a product decision; keep the list short. */
export const LAYER_RULES: readonly LayerRule[] = [
  {
    kind: "bodysuit",
    matches: ["bodysuit", "bodysuits"],
    nameMatches: ["bodysuit", "bodysuits", "body suit", "body suits"],
    order: ["bottom", "top", "shoes"],
    hidesBottomPlaceholder: true,
    why: "A bodysuit closes at the crotch: a worn bottom covers its lower half, and it needs no stand-in. The tagger sometimes types one as plain tops; the name still says it.",
  },
  {
    kind: "one-piece",
    matches: ["dress", "dresses", "gown", "gowns", "one piece", "one-piece"],
    hidesBottomPlaceholder: true,
    why: "The garment covers the hips; stand-in shorts would show under the hem.",
  },
]
