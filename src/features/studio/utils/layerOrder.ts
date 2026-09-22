import { BASE_LAYER_ORDER, LAYER_RULES, type LayerRule } from "@/features/studio/config/layerRules"
import { LAYER_ORDER_ENABLED } from "@/features/studio/constants/layering"
import type { StudioProductTraySlot } from "@/services/studio/studioService"

/** What the rules look at: the worn top's tagger type text, and its product name as a fallback. */
export type LayerRuleInput = {
  typeCategory?: string | null
  productName?: string | null
}

const escapeRegExp = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const hasWord = (text: string, word: string) => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(text)
const clean = (value: string | null | undefined) => value?.trim().toLowerCase() ?? ""

/** The first rule whose words appear in the top's type text, else in its name for rules that opt in, else null. */
export function layerRuleFor(top: LayerRuleInput | null | undefined): LayerRule | null {
  if (!LAYER_ORDER_ENABLED || !top) return null
  const type = clean(top.typeCategory)
  const name = clean(top.productName)
  return (
    (type && LAYER_RULES.find((rule) => rule.matches.some((word) => hasWord(type, word)))) ||
    (name && LAYER_RULES.find((rule) => rule.nameMatches?.some((word) => hasWord(name, word)))) ||
    null
  )
}

/** Slot names, front-most first, for a look whose row stores no order. */
export function defaultLayerOrder(top: LayerRuleInput | null | undefined): StudioProductTraySlot[] {
  return [...(layerRuleFor(top)?.order ?? BASE_LAYER_ORDER)]
}

/** Whether an empty bottom slot draws no stand-in under this top. Flag off keeps only the old dress words. */
export function hidesBottomPlaceholder(top: LayerRuleInput | null | undefined): boolean {
  if (!LAYER_ORDER_ENABLED) return /dress|gown|one piece/i.test(top?.typeCategory ?? "")
  return layerRuleFor(top)?.hidesBottomPlaceholder ?? false
}
