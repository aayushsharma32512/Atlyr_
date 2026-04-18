import { useInfiniteQuery } from "@tanstack/react-query"

import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { searchKeys } from "@/features/search/queryKeys"
import {
  type ProductSearchFilters,
  type ProductSearchResult,
  searchService,
} from "@/services/search/searchService"

interface UseSearchProductResultsParams {
  query: string
  imageUrl?: string
  enabled: boolean
  filters?: ProductSearchFilters
}

export function useSearchProductResults({ query, imageUrl, enabled, filters = {} }: UseSearchProductResultsParams) {
  const { gender } = useProfileContext()
  const trimmed = query.trim()

  // Include gender in the cache key so results refresh when gender changes
  const baseKey = searchKeys.productResults({ query: trimmed, filters, gender })
  const queryKey = [...baseKey, imageUrl || "no-image"]

  return useInfiniteQuery({
    queryKey: queryKey,

    queryFn: ({ pageParam }) =>
      searchService.searchProducts({
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
        results: page.results
          .filter((result): result is ProductSearchResult => Boolean(result))
          .filter((result) => {
            // If user has no gender set, show everything
            if (!gender) return true
            // Show products matching user's gender or unisex; hide others
            const g = result.gender
            return !g || g === gender || g === "unisex"
          }),
      }))
      return { ...data, pages }
    },
  })
}