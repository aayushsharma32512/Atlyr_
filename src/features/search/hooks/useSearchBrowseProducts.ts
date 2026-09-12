import { useInfiniteQuery } from "@tanstack/react-query"

import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { searchKeys } from "@/features/search/queryKeys"
import { browseProducts } from "@/services/search/searchService"
import type { StudioProductTraySlot } from "@/services/studio/studioService"

interface UseSearchBrowseProductsParams {
  slot: StudioProductTraySlot | null
  enabled?: boolean
}

/** For You, pieces: an endless newest-first page of one slot. */
export function useSearchBrowseProducts({ slot, enabled = true }: UseSearchBrowseProductsParams) {
  const { gender, isLoading: isProfileLoading } = useProfileContext()

  return useInfiniteQuery({
    queryKey: searchKeys.browseProducts(slot ?? "none", gender ?? null),
    queryFn: ({ pageParam }) =>
      browseProducts({ slot: slot as StudioProductTraySlot, gender: gender ?? null, cursor: typeof pageParam === "number" ? pageParam : 0 }),
    enabled: enabled && Boolean(slot) && !isProfileLoading,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
