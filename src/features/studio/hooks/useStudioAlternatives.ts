import { useQuery, type QueryClient } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import {
  studioService,
  type StudioAlternativeProduct,
  type StudioProductTraySlot,
} from "@/services/studio/studioService"

type Gender = "male" | "female" | null

/**
 * One limit for every consumer of this query — the 7a tray sheet, the 7c rack,
 * and the prefetch that warms them.
 *
 * They all share `studioKeys.alternatives`, so differing limits meant whichever
 * call mounted first decided how much the others saw: the prefetch's default of
 * 24 was landing in the cache before the rack asked, and the rack then rendered
 * 24 of a several-hundred-item catalogue with no way to reach the rest. Fetching
 * the full slot once and letting both screens read it is cheaper than three
 * near-duplicate requests fighting over one key.
 */
export const STUDIO_ALTERNATIVES_LIMIT = 300

interface AlternativesQueryArgs {
  outfitId: string
  slot: StudioProductTraySlot
  gender: Gender
  limit?: number
}

export function getStudioAlternativesQueryOptions({
  outfitId,
  slot,
  gender,
  limit = STUDIO_ALTERNATIVES_LIMIT,
}: AlternativesQueryArgs) {
  return {
    queryKey: studioKeys.alternatives({ outfitId, slot, gender }),
    queryFn: () => studioService.getAlternatives({ slot, gender, limit }),
    staleTime: 30 * 1000,
  }
}

export function prefetchStudioAlternatives(queryClient: QueryClient, args: AlternativesQueryArgs) {
  return queryClient.prefetchQuery(getStudioAlternativesQueryOptions(args))
}

export function useStudioAlternatives(
  outfitId: string | null,
  slot: StudioProductTraySlot | null,
  opts?: { limit?: number },
) {
  const { gender } = useProfileContext()

  const queryKey = studioKeys.alternatives({
    outfitId: outfitId ?? "none",
    slot: slot ?? "none",
    gender,
  })

  return useQuery<StudioAlternativeProduct[]>({
    queryKey,
    enabled: Boolean(outfitId && slot),
    queryFn: () => {
      if (!outfitId || !slot) {
        return Promise.resolve<StudioAlternativeProduct[]>([])
      }
      return studioService.getAlternatives({
        slot,
        gender,
        limit: opts?.limit ?? STUDIO_ALTERNATIVES_LIMIT,
      })
    },
    select: (data) => data ?? [],
    staleTime: 30 * 1000,
  })
}


