import { useQuery } from "@tanstack/react-query"

import { tryOnKeys } from "@/features/tryon/queryKeys"
import { listGenerations } from "@/services/tryon/tryonService"

export function useGenerationHistory(enabled = true) {
  return useQuery({
    queryKey: tryOnKeys.list(),
    queryFn: () => listGenerations(),
    enabled,
  })
}

