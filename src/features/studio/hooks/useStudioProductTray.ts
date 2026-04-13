import { useQuery, useQueryClient } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { studioService, type StudioProductTrayItem } from "@/services/studio/studioService"

export function useStudioProductTray(outfitId: string | null) {
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: studioKeys.productTray(outfitId),
    enabled: Boolean(outfitId),
    queryFn: () => (outfitId ? studioService.getProductTrayItems(outfitId) : Promise.resolve([])),
    select: (fetched) => {
      if (!outfitId) {
        return fetched
      }
      const cachedOutfit = queryClient.getQueryData<{ trayItems?: StudioProductTrayItem[] }>(
        studioKeys.outfit(outfitId),
      )
      if (Array.isArray(cachedOutfit?.trayItems) && cachedOutfit.trayItems.length > 0) {
        return cachedOutfit.trayItems
      }
      // Only update existing cache entries - don't create new incomplete entries
      // that would pollute the useStudioOutfit cache with missing outfit/studioOutfit
      queryClient.setQueryData(studioKeys.outfit(outfitId), (prev: Record<string, unknown> | undefined) => {
        if (prev && typeof prev === "object" && "outfit" in prev) {
          return { ...prev, trayItems: fetched }
        }
        // Don't create new incomplete cache entry - let useStudioOutfit fetch properly
        return prev
      })
      return fetched
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}


