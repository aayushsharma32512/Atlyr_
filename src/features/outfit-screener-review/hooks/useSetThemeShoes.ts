import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { outfitScreenerQueryKeys } from "../queryKeys"
import { setThemeShoes, type OutfitCandidateTheme } from "@/services/outfit-screener-review/candidateThemesService"

/** Changes a theme's default shoe, applied optimistically so the next composite render reflects it. */
export function useSetThemeShoes(themeId: string) {
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const queryKey = outfitScreenerQueryKeys.theme(themeId)

    return useMutation({
        mutationKey: [...outfitScreenerQueryKeys.all, "set-theme-shoes", themeId] as const,
        mutationFn: (shoesId: string) => setThemeShoes(themeId, shoesId),
        onMutate: async (shoesId: string) => {
            await queryClient.cancelQueries({ queryKey })
            const previous = queryClient.getQueryData<OutfitCandidateTheme | null>(queryKey)
            queryClient.setQueryData<OutfitCandidateTheme | null>(queryKey, (old) =>
                old ? { ...old, chosen_shoes_id: shoesId } : old,
            )
            return { previous }
        },
        onError: (error: Error, _shoesId, context) => {
            if (context && context.previous !== undefined) {
                queryClient.setQueryData(queryKey, context.previous)
            }
            toast({
                title: "Could not change theme shoe",
                description: error.message,
                variant: "destructive",
            })
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey })
            queryClient.invalidateQueries({ queryKey: outfitScreenerQueryKeys.themes() })
        },
    })
}
