import { useQuery } from "@tanstack/react-query"
import { outfitScreenerQueryKeys } from "../queryKeys"
import { fetchTheme } from "@/services/outfit-screener-review/candidateThemesService"

/** One theme's row — footwear_options and the current chosen_shoes_id. */
export function useCandidateTheme(themeId: string | null) {
    return useQuery({
        queryKey: outfitScreenerQueryKeys.theme(themeId ?? "none"),
        queryFn: () => fetchTheme(themeId as string),
        enabled: Boolean(themeId),
        staleTime: 10_000,
    })
}
