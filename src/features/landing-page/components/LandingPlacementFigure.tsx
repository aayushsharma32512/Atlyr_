import { lazy, Suspense } from "react"

import type { StudioRenderedItem } from "@/features/studio/types"

/**
 * The photoreal figure for the landing mini studio, behind a lazy boundary.
 *
 * PIXI is not otherwise part of the landing bundle — the marketing page shipped ~271KB and had no
 * WebGL renderer in it at all. Importing PlacementAvatarRenderer directly would pull the whole
 * renderer into the initial payload for every visitor, including the ones who never reach the demo
 * card. Split out so it is fetched only when an outfit is actually placeable.
 */
const PlacementAvatarRenderer = lazy(() =>
  import("@/features/studio/components/PlacementAvatarRenderer").then((m) => ({
    default: m.PlacementAvatarRenderer,
  })),
)

export type LandingPlacementFigureProps = {
  items: StudioRenderedItem[]
  gender: "male" | "female"
  width: number
  height: number
  hairStyleKey: string | null
  onItemSelect?: (item: StudioRenderedItem) => void
}

export function LandingPlacementFigure({
  items,
  gender,
  width,
  height,
  hairStyleKey,
  onItemSelect,
}: LandingPlacementFigureProps) {
  return (
    // No spinner: the SVG avatar is what renders until this resolves, and swapping a figure for a
    // loading state would read as a flash rather than progress.
    <Suspense fallback={null}>
      <PlacementAvatarRenderer
        items={items}
        gender={gender}
        containerWidth={width}
        containerHeight={height}
        crop="figure"
        hairStyle={hairStyleKey ? { styleKey: hairStyleKey, gender } : null}
        onItemSelect={onItemSelect}
      />
    </Suspense>
  )
}
