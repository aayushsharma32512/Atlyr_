import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { studioService, type StudioComplementaryProduct, type StudioProductTraySlot } from "@/services/studio/studioService"

interface UseStudioOutfitComplementaryProductsArgs {
  productId: string | null | undefined
  slot: StudioProductTraySlot | null | undefined
  limit?: number
  gender?: "male" | "female" | null
}

export function useStudioOutfitComplementaryProducts({
  productId,
  slot,
  limit = 20,
  gender,
}: UseStudioOutfitComplementaryProductsArgs) {
  return useQuery<StudioComplementaryProduct[]>({
    queryKey: studioKeys.outfitComplementaryProducts(productId ?? null, slot ?? null, limit, gender ?? null),
    enabled: Boolean(productId && slot),
    queryFn: () =>
      productId && slot
        ? studioService.getComplementaryProductsBySlot({ productId, slot, limit, userGender: gender })
        : Promise.resolve<StudioComplementaryProduct[]>([]),
    select: (data) => data ?? [],
    staleTime: 30 * 1000,
  })
}
