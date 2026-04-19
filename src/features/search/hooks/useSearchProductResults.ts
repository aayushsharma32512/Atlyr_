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

  // If the user explicitly selected gender(s) via the filter drawer, those take
  // priority and the profile gender default is ignored entirely.
  const hasExplicitGender = Boolean(filters.genders && filters.genders.length > 0)

  // Only pass profile gender to the backend when no explicit gender filter is set.
  // When explicit genders are set they are already inside `filters.genders`.
  const effectiveGender = hasExplicitGender ? null : gender

  // Include gender in the cache key so results refresh when gender changes
  const baseKey = searchKeys.productResults({ query: trimmed, filters, gender })
  const queryKey = [...baseKey, imageUrl || "no-image"]

  return useInfiniteQuery({
    queryKey: queryKey,

    queryFn: ({ pageParam }) =>
      searchService.searchProducts({
        query: trimmed,
        imageUrl,
        gender: effectiveGender,
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
            const g = result.gender
            if (hasExplicitGender) {
              // User explicitly chose gender(s): match those or unisex
              return !g || g === "unisex" || filters.genders!.includes(g)
            }
            // Default: fall back to profile gender
            if (!gender) return true
            return !g || g === gender || g === "unisex"
          }),
      }))
      return { ...data, pages }
    },
  })
}