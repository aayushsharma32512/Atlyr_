import { useQuery } from "@tanstack/react-query"
import { studioKeys } from "@/features/studio/queryKeys"
import { findOutfitByItems } from "@/services/outfits/outfitsService"

interface UseCurrentLookIdArgs {
  outfitId: string | null | undefined
  hasSlotOverrides: boolean
  /** The URL carries a stacking only when it differs from the row's, so its presence means the order changed. */
  orderChanged?: boolean
  topId: string | null | undefined
  bottomId: string | null | undefined
  shoesId: string | null | undefined
  /** The on-screen stacking to match; null means the default rule. */
  layerOrder?: string[] | null
}

/** The look on the mannequin: the URL's outfit, or after a change the row whose pieces and stacking match (null if unsaved). */
export function useCurrentLookId({
  outfitId,
  hasSlotOverrides,
  orderChanged = false,
  topId,
  bottomId,
  shoesId,
  layerOrder = null,
}: UseCurrentLookIdArgs): { currentLookId: string | null; isResolving: boolean } {
  const lookChanged = hasSlotOverrides || orderChanged
  const enabled = lookChanged && Boolean(topId || bottomId || shoesId)
  const query = useQuery({
    queryKey: studioKeys.lookByItems(topId, bottomId, shoesId, layerOrder),
    queryFn: () => findOutfitByItems({ topId, bottomId, shoesId, layerOrder }),
    enabled,
    staleTime: 5 * 60 * 1000,
  })

  if (!lookChanged) {
    return { currentLookId: outfitId ?? null, isResolving: false }
  }
  return { currentLookId: query.data?.id ?? null, isResolving: query.isLoading }
}
