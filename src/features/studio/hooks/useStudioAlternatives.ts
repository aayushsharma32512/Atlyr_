import { useQuery, type QueryClient } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import {
  studioService,
  type StudioAlternativeProduct,
  type StudioProductTraySlot,
} from "@/services/studio/studioService"

type Gender = "male" | "female" | null

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
  limit = 24,
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
      return studioService.getAlternatives({ slot, gender, limit: opts?.limit })
    },
    select: (data) => data ?? [],
    staleTime: 30 * 1000,
  })
}


