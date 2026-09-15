import { useQuery } from "@tanstack/react-query"
import { outfitScreenerQueryKeys } from "../queryKeys"
import { fetchThemesWithPendingCounts } from "@/services/outfit-screener-review/candidateThemesService"

/** The 20 themes, each with a live count of its pending candidate pairs. */
export function useCandidateThemes() {
    return useQuery({
        queryKey: outfitScreenerQueryKeys.themes(),
        queryFn: fetchThemesWithPendingCounts,
        staleTime: 30_000,
    })
}
