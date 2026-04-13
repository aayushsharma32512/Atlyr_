import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { outfitProductsService } from "@/services/studio/outfitProductsService"
import type { StudioRenderedItem, ZoneVisibilityMap } from "@/features/studio/types"
import { mergeBodyPartsVisibilityByZone } from "@/features/studio/mappers/renderedItemMapper"

interface UseOutfitProductsOptions {
  outfitId: string | null
  enabled?: boolean
}

export function getOutfitProductsQueryOptions(outfitId: string | null) {
  return {
    queryKey: studioKeys.outfitProducts(outfitId ?? null),
    staleTime: 30 * 60 * 1000,
    queryFn: () => (outfitId ? outfitProductsService.fetchOutfitProducts(outfitId) : Promise.resolve([])),
    placeholderData: [] as StudioRenderedItem[],
  }
}

export function useOutfitProducts({ outfitId, enabled = true }: UseOutfitProductsOptions) {
  const query = useQuery({
    ...getOutfitProductsQueryOptions(outfitId),
    enabled: enabled && Boolean(outfitId),
  })

  const bodyPartsVisibleByZone = useMemo<ZoneVisibilityMap>(() => mergeBodyPartsVisibilityByZone(query.data ?? []), [query.data])

  return {
    ...query,
    data: query.data ?? [],
    bodyPartsVisibleByZone,
  }
}
