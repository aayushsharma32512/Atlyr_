import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { studioService, type StudioProductDetail } from "@/services/studio/studioService"

export function useStudioProduct(productId: string | null | undefined, initialData?: StudioProductDetail | null) {
  return useQuery({
    queryKey: studioKeys.product(productId ?? null),
    enabled: Boolean(productId),
    initialData,
    queryFn: () => {
      if (!productId) {
        return Promise.resolve<StudioProductDetail | null>(null)
      }
      return studioService.getProductDetail(productId)
    },
    staleTime: 60 * 1000,
  })
}


