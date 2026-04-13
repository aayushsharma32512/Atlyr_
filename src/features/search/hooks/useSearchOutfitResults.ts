import { useInfiniteQuery } from "@tanstack/react-query"

import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { searchKeys } from "@/features/search/queryKeys"
import {
  type OutfitSearchFilters,
  type OutfitSearchResult,
  searchService,
} from "@/services/search/searchService"

interface UseSearchOutfitResultsParams {
  query: string
  imageUrl?: string
  filters?: OutfitSearchFilters
  enabled: boolean
}

export function useSearchOutfitResults({ query, imageUrl, filters, enabled }: UseSearchOutfitResultsParams) {
  const { gender } = useProfileContext()
  const trimmed = query.trim()

  // Construct a key that listens to query, filters, AND imageUrl
  const baseKey = searchKeys.outfitResults({ query: trimmed, gender, filters })
  const queryKey = [...baseKey, imageUrl || "no-image"]

  return useInfiniteQuery({
    queryKey: queryKey,
    queryFn: ({ pageParam }) =>
      searchService.searchOutfits({
        query: trimmed,
        imageUrl,
        gender,
        cursor: typeof pageParam === "number" ? pageParam : 0,
        filters,
      }),
    // Fetch if we have text OR an image
    enabled: enabled && (trimmed.length > 0 || !!imageUrl),
    refetchOnWindowFocus: false,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    select: (data) => {
      const pages = data.pages.map((page) => ({
        nextCursor: page.nextCursor,
        results: page.results.filter((result): result is OutfitSearchResult => Boolean(result)),
      }))
      return { ...data, pages }
    },
  })
}


