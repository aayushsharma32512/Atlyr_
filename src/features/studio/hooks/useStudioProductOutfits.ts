import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { studioService, type StudioProductTraySlot } from "@/services/studio/studioService"
import type { Outfit } from "@/types"
import type { StudioOutfitDTO } from "@/features/studio/types"

export type ProductOutfitEntry = { outfit: Outfit; studioOutfit: StudioOutfitDTO | null }

interface UseStudioProductOutfitsArgs {
  productId: string | null | undefined
  slot: StudioProductTraySlot | null | undefined
  enabled?: boolean
  limit?: number
  gender?: "male" | "female" | null
}

export function useStudioProductOutfits({
  productId,
  slot,
  enabled = true,
  limit,
  gender,
}: UseStudioProductOutfitsArgs) {
  return useQuery({
    queryKey: studioKeys.productOutfits(productId, slot, gender ?? null),
    enabled: Boolean(productId && slot && enabled),
    queryFn: () =>
      productId && slot
        ? studioService.getOutfitsByProduct({ productId, slot, limit, userGender: gender })
        : Promise.resolve<ProductOutfitEntry[]>([]),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}
