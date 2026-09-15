import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { outfitScreenerQueryKeys } from "../queryKeys"
import {
    setPairShoesOverride,
    type OutfitCandidatePair,
} from "@/services/outfit-screener-review/candidatePairsService"

interface OverrideInput {
    candidateId: string
    /** null clears the override, falling back to the theme's chosen shoe. */
    shoesId: string | null
}

/** Sets or clears one pending pair's shoe override, applied optimistically to the queue cache. */
export function useSetPairShoesOverride(themeId: string) {
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const queryKey = outfitScreenerQueryKeys.queue(themeId)

    return useMutation({
        mutationKey: [...outfitScreenerQueryKeys.all, "set-pair-shoes-override", themeId] as const,
        mutationFn: ({ candidateId, shoesId }: OverrideInput) => setPairShoesOverride(candidateId, shoesId),
        onMutate: async ({ candidateId, shoesId }: OverrideInput) => {
            await queryClient.cancelQueries({ queryKey })
            const previous = queryClient.getQueryData<OutfitCandidatePair[]>(queryKey)
            queryClient.setQueryData<OutfitCandidatePair[]>(queryKey, (old) =>
                old?.map((pair) =>
                    pair.id === candidateId ? { ...pair, shoes_override_id: shoesId } : pair,
                ) ?? old,
            )
            return { previous }
        },
        onError: (error: Error, _vars, context) => {
            if (context && context.previous !== undefined) {
                queryClient.setQueryData(queryKey, context.previous)
            }
            toast({
                title: "Could not change shoe for this pair",
                description: error.message,
                variant: "destructive",
            })
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey })
        },
    })
}
