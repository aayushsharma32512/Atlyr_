import { useMutation } from "@tanstack/react-query"

import { tryOnKeys } from "@/features/tryon/queryKeys"
import { ensureGarmentSummary } from "@/services/tryon/tryonService"
import { uniqueProductIds } from "@/features/tryon/utils/array"

export function useEnsureSummaries() {
  return useMutation({
    mutationKey: tryOnKeys.ensureSummaries(),
    mutationFn: async (productIds: Array<string | null | undefined>) => {
      const uniqueIds = uniqueProductIds(productIds)
      if (!uniqueIds.length) return []
      return Promise.all(uniqueIds.map((id) => ensureGarmentSummary(id)))
    },
  })
}
