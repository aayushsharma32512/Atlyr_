import { useInfiniteQuery } from "@tanstack/react-query"

import { searchKeys } from "@/features/search/queryKeys"
import {
  type ProductSearchFilters,
  type ProductSearchResult,
  searchService,
} from "@/services/search/searchService"

// --- FIX 1: Add imageUrl to this interface ---
interface UseSearchProductResultsParams {
  query: string
  imageUrl?: string // <--- Added this line
  enabled: boolean
  filters?: ProductSearchFilters
}

export function useSearchProductResults({ query, imageUrl, enabled, filters = {} }: UseSearchProductResultsParams) {
  const trimmed = query.trim()
  
  // Construct a key that listens to query, filters, AND imageUrl
  const baseKey = searchKeys.productResults({ query: trimmed, filters })
  const queryKey = [...baseKey, imageUrl || "no-image"]

  return useInfiniteQuery({
    queryKey: queryKey,
    
    queryFn: ({ pageParam }) =>
      searchService.searchProducts({
        query: trimmed,
        imageUrl,
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
        results: page.results.filter((result): result is ProductSearchResult => Boolean(result)),
      }))
      return { ...data, pages }
    },
  })
}