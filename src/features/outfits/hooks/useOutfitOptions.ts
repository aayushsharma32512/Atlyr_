import { useQuery } from "@tanstack/react-query"

import { outfitsKeys } from "@/features/outfits/queryKeys"
import { fetchCategories, fetchOccasions } from "@/services/outfits/outfitsService"

const STALE_TIME = 5 * 60 * 1000

export function useCategories(limit = 50, term: string | null = null) {
  return useQuery({
    queryKey: outfitsKeys.categories(limit, term),
    queryFn: () => fetchCategories({ limit, term: term ?? undefined }),
    staleTime: STALE_TIME,
  })
}

export function useOccasions(limit = 50, term: string | null = null) {
  return useQuery({
    queryKey: outfitsKeys.occasions(limit, term),
    queryFn: () => fetchOccasions({ limit, term: term ?? undefined }),
    staleTime: STALE_TIME,
  })
}
