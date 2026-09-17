import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { reviewOutfit, type OutfitReviewDecision } from "@/services/admin-inventory/outfitReviewService"
import { adminInventoryQueryKeys } from "../queryKeys"

interface ReviewInput {
    outfitId: string
    decision: OutfitReviewDecision
}

/** Keep or hide one outfit; the calling screen advances the queue locally, then
 * this persists the decision in the background and keeps the hidden list in sync. */
export function useReviewOutfit() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: ({ outfitId, decision }: ReviewInput) => reviewOutfit(outfitId, decision),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: adminInventoryQueryKeys.outfits() })
        },
        onError: (error: Error) => {
            toast.error(error.message)
        },
    })
}
