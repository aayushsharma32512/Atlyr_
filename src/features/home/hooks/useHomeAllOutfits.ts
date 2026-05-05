import { useInfiniteQuery } from "@tanstack/react-query"

import { homeKeys } from "@/features/home/queryKeys"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { homeService, type HomeOutfitEntry } from "@/services/home/homeService"

export function useHomeAllOutfits(sortBy: 'relevance' | 'newly_added', size = 50) {
  const { gender, isLoading: isProfileLoading } = useProfileContext()

  return useInfiniteQuery({
    queryKey: homeKeys.allOutfits(gender ?? null, size, sortBy),
    enabled: !isProfileLoading,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      homeService.getAllOutfits({
        gender: gender ?? null,
        sortBy,
        page: typeof pageParam === "number" ? pageParam : 0,
        size,
      }) as Promise<HomeOutfitEntry[]>,
    staleTime: 2 * 60 * 1000,
    getNextPageParam: (lastPage, allPages) => (lastPage.length === size ? allPages.length : undefined),
  })
}
