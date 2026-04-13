import { useQuery, useQueryClient } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import type { StudioProductTrayItem, StudioProductTraySlot } from "@/services/studio/studioService"
import { studioService } from "@/services/studio/studioService"

function findTrayItemBySlot(trayItems: StudioProductTrayItem[] | undefined, slot: StudioProductTraySlot | null) {
  if (!trayItems || !slot) {
    return null
  }

  return trayItems.find((item) => item.slot === slot) ?? null
}

export function useStudioHeroProduct(outfitId: string | null, slot: StudioProductTraySlot | null, productId?: string | null) {
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: [...studioKeys.hero(outfitId, slot), productId ?? "default"],
    enabled: Boolean((outfitId && slot) || productId),
    queryFn: () => {
      if ((!outfitId || !slot) && !productId) {
        return Promise.resolve<StudioProductTrayItem | null>(null)
      }
      if (productId) {
        return studioService.getProductById(productId)
      }
      return Promise.resolve<StudioProductTrayItem | null>(null)
    },
    select: (fetched) => {
      if (!outfitId || !slot) {
        return null
      }

      const cachedOutfit = queryClient.getQueryData<{ trayItems?: StudioProductTrayItem[] }>(
        studioKeys.outfit(outfitId),
      )
      const trayItems = cachedOutfit?.trayItems ?? []

      if (productId) {
        const fallback = trayItems.find((item) => item.productId === productId) ?? null
        return fetched ?? fallback ?? findTrayItemBySlot(trayItems, slot)
      }

      return findTrayItemBySlot(trayItems, slot) ?? fetched
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}


