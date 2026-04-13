import { useInfiniteQuery } from "@tanstack/react-query"

import { homeKeys } from "@/features/home/queryKeys"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { homeService, type HomeOutfitEntry } from "@/services/home/homeService"

export function useHomeCuratedOutfits(seed: string, size = 50) {
  const { gender, isLoading: isProfileLoading } = useProfileContext()

  return useInfiniteQuery({
    queryKey: homeKeys.curatedOutfits(gender ?? null, size, seed),
    enabled: !isProfileLoading && seed.length > 0,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      homeService.getCuratedOutfits({
        gender: gender ?? null,
        page: typeof pageParam === "number" ? pageParam : 0,
        size,
        seed,
      }) as Promise<HomeOutfitEntry[]>,
    staleTime: 2 * 60 * 1000,
    getNextPageParam: (lastPage, allPages) => (lastPage.length === size ? allPages.length : undefined),
  })
}
