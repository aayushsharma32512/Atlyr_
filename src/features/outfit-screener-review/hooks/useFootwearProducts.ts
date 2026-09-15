import { useQuery } from "@tanstack/react-query"
import { outfitScreenerQueryKeys } from "../queryKeys"
import { fetchFootwearProducts } from "@/services/outfit-screener-review/candidateCompositeService"

/** Thumbnails for a theme's footwear_options — feeds both shoe pickers. */
export function useFootwearProducts(themeId: string | null, shoesIds: string[]) {
    return useQuery({
        queryKey: outfitScreenerQueryKeys.footwear(themeId ?? "none"),
        queryFn: () => fetchFootwearProducts(shoesIds),
        enabled: Boolean(themeId) && shoesIds.length > 0,
        staleTime: 5 * 60_000,
    })
}
