import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

import type { Creation } from "@/services/collections/collectionsService"
import { getMannequinConfigQueryOptions } from "@/features/studio/hooks/useMannequinConfig"
import { getOutfitProductsQueryOptions } from "@/features/studio/hooks/useOutfitProducts"

const resolveGender = (value?: string | null): "male" | "female" => (value === "male" ? "male" : "female")

type PrefetchCreationAssetsOptions = {
  creations: Creation[]
  currentSlide: number
}

/**
 * Warms the outfit and mannequin queries for the look on screen and its two
 * neighbours, so a swipe lands on a tile that can draw at once.
 *
 * This used to skip any creation that had a try-on photo, because the old tab
 * showed the photo for those instead of the mannequin. The tab always renders
 * the mannequin now, so that skip left exactly the try-on creations mounting
 * cold and flashing a blank tile mid-swipe.
 */
export function usePrefetchCreationAssets({ creations, currentSlide }: PrefetchCreationAssetsOptions) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!creations.length) return
    const indices = [currentSlide - 1, currentSlide, currentSlide + 1].filter(
      (i) => i >= 0 && i < creations.length,
    )

    for (const idx of indices) {
      const creation = creations[idx]
      if (!creation?.outfitId) continue
      queryClient.prefetchQuery(getMannequinConfigQueryOptions({ gender: resolveGender(creation.gender) }))
      queryClient.prefetchQuery(getOutfitProductsQueryOptions(creation.outfitId))
    }
  }, [creations, currentSlide, queryClient])
}
