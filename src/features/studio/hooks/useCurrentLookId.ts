import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { findOutfitByItems } from "@/services/outfits/outfitsService"

interface UseCurrentLookIdArgs {
  outfitId: string | null | undefined
  hasSlotOverrides: boolean
  topId: string | null | undefined
  bottomId: string | null | undefined
  shoesId: string | null | undefined
}

/** The look on the mannequin: the URL's outfit, or after a swap the row whose pieces match (null if unsaved). */
export function useCurrentLookId({
  outfitId,
  hasSlotOverrides,
  topId,
  bottomId,
  shoesId,
}: UseCurrentLookIdArgs): { currentLookId: string | null; isResolving: boolean } {
  const enabled = hasSlotOverrides && Boolean(topId || bottomId || shoesId)

  const query = useQuery({
    queryKey: studioKeys.lookByItems(topId, bottomId, shoesId),
    queryFn: () => findOutfitByItems({ topId, bottomId, shoesId }),
    enabled,
    staleTime: 5 * 60 * 1000,
  })

  if (!hasSlotOverrides) {
    return { currentLookId: outfitId ?? null, isResolving: false }
  }

  return { currentLookId: query.data?.id ?? null, isResolving: query.isLoading }
}
