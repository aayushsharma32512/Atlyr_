import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { studioService, type StudioAlternativeProduct } from "@/services/studio/studioService"

type Gender = "male" | "female" | null | undefined

interface UseStudioComplementaryProductsArgs {
  productId: string | null | undefined
  gender?: Gender
  limit?: number
}

export function useStudioComplementaryProducts({
  productId,
  gender,
  limit,
}: UseStudioComplementaryProductsArgs) {
  return useQuery({
    queryKey: studioKeys.complementaryProducts(productId ?? null, gender ?? null),
    enabled: Boolean(productId),
    staleTime: 30 * 1000,
    select: (data) => data ?? [],
    queryFn: () => {
      if (!productId) {
        return Promise.resolve<StudioAlternativeProduct[]>([])
      }

      return studioService.getComplementaryProductsByProductId({
        productId,
        userGender: gender ?? null,
        limit,
      })
    },
  })
}

