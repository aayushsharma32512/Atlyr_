import { useInfiniteQuery } from "@tanstack/react-query"

import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { studioKeys } from "@/features/studio/queryKeys"
import { studioService } from "@/services/studio/studioService"
import type { Outfit } from "@/types"
import type { StudioOutfitDTO } from "@/features/studio/types"

export type CategoryOutfitEntry = { outfit: Outfit; studioOutfit: StudioOutfitDTO | null }

interface CategoryOutfitsPage {
  results: CategoryOutfitEntry[]
  nextCursor: number | null
}

interface UseStudioCategoryOutfitsInfiniteParams {
  categoryId: string | null | undefined
  enabled: boolean
  limit?: number
}

export function useStudioCategoryOutfitsInfinite({
  categoryId,
  enabled,
  limit = 50,
}: UseStudioCategoryOutfitsInfiniteParams) {
  const { gender } = useProfileContext()

  return useInfiniteQuery({
    queryKey: studioKeys.categoryOutfits(categoryId ?? null, gender),
    enabled: enabled && Boolean(categoryId) && (!gender || gender === "male" || gender === "female"),
    initialPageParam: 0,
    refetchOnWindowFocus: false,
    queryFn: ({ pageParam }) => {
      if (!categoryId) {
        return Promise.resolve<CategoryOutfitsPage>({ results: [], nextCursor: null })
      }
      return studioService.getOutfitsByCategoryPage({
        categoryId,
        gender,
        cursor: typeof pageParam === "number" ? pageParam : 0,
        limit,
      })
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    select: (data) => {
      const pages = data.pages.map((page) => ({
        nextCursor: page.nextCursor,
        results: page.results.filter((result): result is CategoryOutfitEntry => Boolean(result)),
      }))
      return { ...data, pages }
    },
  })
}

