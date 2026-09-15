import { useQuery } from "@tanstack/react-query"
import { outfitScreenerQueryKeys } from "../queryKeys"
import { fetchPendingPairs } from "@/services/outfit-screener-review/candidatePairsService"

/** A theme's review queue, ordered by sim_pair descending (best pairs first). */
export function usePendingCandidates(themeId: string | null) {
    return useQuery({
        queryKey: outfitScreenerQueryKeys.queue(themeId ?? "none"),
        queryFn: () => fetchPendingPairs(themeId as string),
        enabled: Boolean(themeId),
        staleTime: 10_000,
    })
}
