import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { studioKeys } from "@/features/studio/queryKeys"
import { outfitProductsService, type OutfitProductsResult } from "@/services/studio/outfitProductsService"
import type { ZoneVisibilityMap } from "@/features/studio/types"
import { mergeBodyPartsVisibilityByZone } from "@/features/studio/mappers/renderedItemMapper"

interface UseOutfitProductsOptions {
  outfitId: string | null
  enabled?: boolean
}

const EMPTY: OutfitProductsResult = { renderedItems: [], layerOrder: null }

export function getOutfitProductsQueryOptions(outfitId: string | null) {
  return {
    queryKey: studioKeys.outfitProducts(outfitId ?? null),
    staleTime: 30 * 60 * 1000,
    queryFn: () => (outfitId ? outfitProductsService.fetchOutfitProducts(outfitId) : Promise.resolve(EMPTY)),
    placeholderData: EMPTY,
  }
}

/** A card's own fetch of a look: its pieces, the mannequin parts they leave visible, and the row's stacking. */
export function useOutfitProducts({ outfitId, enabled = true }: UseOutfitProductsOptions) {
  const query = useQuery({
    ...getOutfitProductsQueryOptions(outfitId),
    enabled: enabled && Boolean(outfitId),
  })
  const renderedItems = query.data?.renderedItems ?? EMPTY.renderedItems
  const bodyPartsVisibleByZone = useMemo<ZoneVisibilityMap>(() => mergeBodyPartsVisibilityByZone(renderedItems), [renderedItems])

  return {
    ...query,
    data: renderedItems,
    layerOrder: query.data?.layerOrder ?? null,
    bodyPartsVisibleByZone,
  }
}
