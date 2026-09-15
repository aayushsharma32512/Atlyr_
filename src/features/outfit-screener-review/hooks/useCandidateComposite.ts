import { useQuery } from "@tanstack/react-query"
import { outfitScreenerQueryKeys } from "../queryKeys"
import { fetchCandidateComposite } from "@/services/outfit-screener-review/candidateCompositeService"

/** Live composite (top + bottom + effective shoe) for one candidate pair. */
export function useCandidateComposite(
    topId: string | null,
    bottomId: string | null,
    shoesId: string | null,
) {
    return useQuery({
        queryKey: outfitScreenerQueryKeys.composite(topId ?? "none", bottomId ?? "none", shoesId ?? "none"),
        queryFn: () => fetchCandidateComposite(topId as string, bottomId as string, shoesId as string),
        enabled: Boolean(topId && bottomId && shoesId),
        staleTime: 5 * 60_000,
        gcTime: 10 * 60_000,
    })
}
