import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { studioService, type StudioAlternativeProduct } from "@/services/studio/studioService"

export function useStudioSimilarProducts(productId: string | null | undefined, opts?: { limit?: number }) {
  return useQuery({
    queryKey: studioKeys.similarProducts(productId ?? null),
    enabled: Boolean(productId),
    queryFn: () => {
      if (!productId) {
        return Promise.resolve<StudioAlternativeProduct[]>([])
      }
      return studioService.getSimilarProductsByProductId(productId, opts?.limit)
    },
    select: (data) => data ?? [],
    staleTime: 30 * 1000,
  })
}


