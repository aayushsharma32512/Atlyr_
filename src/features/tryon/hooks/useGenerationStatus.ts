import { useQuery } from "@tanstack/react-query"

import { tryOnKeys } from "@/features/tryon/queryKeys"
import { getGeneration, type TryOnGenerationRecord } from "@/services/tryon/tryonService"

export function useGenerationStatus(generationId: string | null) {
  return useQuery<TryOnGenerationRecord | null>({
    queryKey: tryOnKeys.generationStatus(generationId),
    enabled: Boolean(generationId),
    refetchInterval: (query) => {
      if (!generationId) return false
      const current = query.state.data
      if (!current) return 3000
      return current.status === "ready" ? false : 3000
    },
    queryFn: () => {
      if (!generationId) return Promise.resolve(null)
      return getGeneration(generationId)
    },
  })
}
