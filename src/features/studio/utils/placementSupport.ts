import type { StudioPlacementByMannequin } from "@/features/studio/types"

/**
 * Can this product actually be rendered on the photoreal mannequin?
 *
 * `PlacementAvatarRenderer` builds its scene from
 *   items.filter((it) => it.placement?.[mannequin] && it.imageUrl)
 * so a product with no placement transform for the body on screen is **silently
 * dropped** — no error, no fallback, the garment simply never appears. Offering
 * one in the rack is therefore a dead end: you tap it, the slot updates, and the
 * model doesn't change.
 *
 * Placement is per-body, not per-product: the same garment can be placed on the
 * male mannequin and not the female one, so the check needs the mannequin
 * actually being drawn rather than a global "is this placed" flag.
 */
export function isPlaceableOnMannequin(
  product: { placement?: StudioPlacementByMannequin | null; imageUrl?: string | null },
  mannequin: "male" | "female",
): boolean {
  return Boolean(product.placement?.[mannequin])
}

/**
 * Slots the rack filters by placement.
 *
 * Footwear only, for now. The same silent drop applies to every slot, but
 * footwear is the least-backfilled category and filtering the others risks
 * emptying a rack that is otherwise usable. Widen this array when the backfill
 * catches up — nothing else has to change.
 */
export const PLACEMENT_FILTERED_SLOTS = ["shoes"] as const

export function shouldFilterSlotByPlacement(slot: string): boolean {
  return (PLACEMENT_FILTERED_SLOTS as readonly string[]).includes(slot)
}
