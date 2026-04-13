import { useQuery } from "@tanstack/react-query"

import { useAuth } from "@/contexts/AuthContext"
import { homeKeys } from "@/features/home/queryKeys"
import { homeService, type HomeOutfitEntry } from "@/services/home/homeService"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"

export function useHomeRecentStyles(limit = 10) {
  const { user } = useAuth()
  const { gender, isLoading: isProfileLoading } = useProfileContext()

  return useQuery({
    queryKey: homeKeys.recentStyles(user?.id ?? null, gender ?? null),
    enabled: Boolean(user?.id) && !isProfileLoading,
    queryFn: () =>
      homeService.getRecentStyles({
        userId: user?.id ?? null,
        gender: gender ?? null,
        limit,
      }) as Promise<HomeOutfitEntry[]>,
    staleTime: 60 * 1000,
  })
}


