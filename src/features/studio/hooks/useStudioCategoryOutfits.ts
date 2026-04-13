import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { studioService } from "@/services/studio/studioService"
import type { Outfit } from "@/types"
import type { StudioOutfitDTO } from "@/features/studio/types"

export type CategoryOutfitEntry = { outfit: Outfit; studioOutfit: StudioOutfitDTO | null }

export function useStudioCategoryOutfits(category: string | null | undefined, limit = 12) {
  const { gender } = useProfileContext()

  return useQuery({
    queryKey: studioKeys.categoryOutfits(category ?? null, gender),
    enabled: Boolean(category) && (!gender || gender === "male" || gender === "female"),
    queryFn: () => {
      if (!category) {
        return Promise.resolve<CategoryOutfitEntry[]>([])
      }
      return studioService.getOutfitsByCategory(category, limit, gender)
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })
}
