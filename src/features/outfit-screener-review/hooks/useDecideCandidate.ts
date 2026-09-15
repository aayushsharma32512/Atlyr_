import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { outfitScreenerQueryKeys } from "../queryKeys"
import { decideCandidate, type CandidateDecision } from "@/services/outfit-screener-review/candidatePairsService"

interface DecideInput {
    candidateId: string
    decision: CandidateDecision
}

/**
 * Accept or reject one candidate pair. The calling screen advances to the
 * next pair immediately (optimistic, local); this hook just persists the
 * decision and keeps the theme list's pending counts in sync.
 */
export function useDecideCandidate(themeId: string | null) {
    const queryClient = useQueryClient()
    const { toast } = useToast()

    return useMutation({
        mutationKey: [...outfitScreenerQueryKeys.all, "decide"] as const,
        mutationFn: ({ candidateId, decision }: DecideInput) => decideCandidate(candidateId, decision),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: outfitScreenerQueryKeys.themes() })
            if (themeId) {
                queryClient.invalidateQueries({ queryKey: outfitScreenerQueryKeys.queue(themeId) })
            }
        },
        onError: (error: Error) => {
            toast({
                title: "Could not save decision",
                description: error.message,
                variant: "destructive",
            })
        },
    })
}
