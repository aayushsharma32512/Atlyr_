import { useQuery } from "@tanstack/react-query"

import { likenessKeys } from "@/features/likeness/queryKeys"
import { listLikeness, type LikenessPose } from "@/services/likeness/likenessService"

interface UseLikenessListQueryParams {
  enabled?: boolean
}

export function useLikenessListQuery({ enabled = true }: UseLikenessListQueryParams = {}) {
  return useQuery<LikenessPose[]>({
    queryKey: likenessKeys.list(),
    queryFn: () => listLikeness(),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled,
  })
}


