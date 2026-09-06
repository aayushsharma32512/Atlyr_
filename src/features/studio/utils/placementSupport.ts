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
 * Every slot. This was footwear-only while the backfill was thin, on the theory
 * that filtering tops and bottoms risked emptying an otherwise usable rack. The
 * catalog no longer supports that trade-off: 124 of 927 products carry no
 * placement at all, and 113 of those are tops and bottoms that the rack was
 * still offering. Tapping one updated the slot and left the model unchanged —
 * the failure `isPlaceableOnMannequin` exists to prevent.
 *
 * Because the check is per-mannequin it also closes the other half of the same
 * hole: a garment placed on only the mannequin the viewer is NOT wearing (one
 * unisex bottom, one cross-gender top today, and only 6 of 927 products placed
 * on both bodies) is dropped by the renderer just as silently. Curated outfits
 * never mix mannequins, so this only ever bit on a rack swap — which is exactly
 * what this filters.
 */
export const PLACEMENT_FILTERED_SLOTS = ["top", "bottom", "shoes"] as const

export function shouldFilterSlotByPlacement(slot: string): boolean {
  return (PLACEMENT_FILTERED_SLOTS as readonly string[]).includes(slot)
}

/**
 * Can this whole look be drawn as-is on the body about to be rendered?
 *
 * `isPlaceableOnMannequin` guards a rack, one garment at a time. This guards a
 * whole outfit handed over in one go — the shuffle button — where the same
 * silent drop is worse: you do not choose the pieces, so a top with no
 * transform just never appears and the look you are shown is not the look that
 * was picked.
 *
 * Garments with no image are skipped rather than failed: there is nothing to
 * draw, so the renderer was never going to show them. An outfit with nothing
 * drawable at all is rejected, since "renders perfectly" and "renders nothing"
 * should not be the same answer.
 */
export function isOutfitFullyPlaceable(
  items: { placement?: StudioPlacementByMannequin | null; imageUrl?: string | null }[],
  mannequin: "male" | "female",
): boolean {
  const drawable = items.filter((item) => Boolean(item.imageUrl))
  if (drawable.length === 0) {
    return false
  }
  return drawable.every((item) => isPlaceableOnMannequin(item, mannequin))
}
