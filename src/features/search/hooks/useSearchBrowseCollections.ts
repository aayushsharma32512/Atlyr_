import { useQuery } from "@tanstack/react-query"

import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { searchKeys } from "@/features/search/queryKeys"
import { searchService } from "@/services/search/searchService"

interface UseSearchBrowseCollectionsParams {
  enabled?: boolean
}

export function useSearchBrowseCollections({ enabled = true }: UseSearchBrowseCollectionsParams = {}) {
  const { gender, heightCm, profile } = useProfileContext()

  return useQuery({
    queryKey: searchKeys.browseCollections(gender),
    queryFn: () =>
      searchService.getBrowseCollections({
        gender,
        avatarHeightCm: heightCm,
        avatarHeadUrl: profile?.selected_avatar_image_url ?? null,
      }),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: enabled && (!gender || gender === "male" || gender === "female"),
  })
}

