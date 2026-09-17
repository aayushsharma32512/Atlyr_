import { useInfiniteQuery } from "@tanstack/react-query"

import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { searchKeys } from "@/features/search/queryKeys"
import { searchService } from "@/services/search/searchService"

interface UseSearchBrowseCollectionLooksParams {
  categoryId: string | null
  enabled?: boolean
}

/** A curation's looks, every one of them, paged as the list scrolls. */
export function useSearchBrowseCollectionLooks({ categoryId, enabled = true }: UseSearchBrowseCollectionLooksParams) {
  const { gender, heightCm, profile } = useProfileContext()

  return useInfiniteQuery({
    queryKey: searchKeys.browseCollectionLooks(categoryId ?? "none", gender),
    queryFn: ({ pageParam }) =>
      searchService.browseCollectionLooks({
        categoryId: categoryId as string,
        gender,
        avatarHeightCm: heightCm,
        avatarHeadUrl: profile?.selected_avatar_image_url ?? null,
        cursor: typeof pageParam === "number" ? pageParam : 0,
      }),
    enabled: enabled && Boolean(categoryId) && (!gender || gender === "male" || gender === "female"),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
