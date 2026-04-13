import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"
import { useAuth } from "@/contexts/AuthContext"
import { toast } from "sonner"
import { applyEnrichedCategoryOccasion } from "@/services/outfit-enrichment/enrichmentsService"
import { enrichmentQueryKeys } from "../queryKeys"

/**
 * Hook to apply enriched category/occasion to outfit's main category/occasion
 */
export function useApplyEnrichedValues() {
    const { user } = useAuth()
    const queryClient = useQueryClient()

    return useMutation({
        mutationKey: [...enrichmentQueryKeys.all, "apply-enriched-values"] as const,
        mutationFn: async (outfitId: string) => {
            if (!user?.id) {
                throw new Error("Not authenticated")
            }
            const result = await applyEnrichedCategoryOccasion(supabase, outfitId)
            if (!result.success) {
                throw new Error(result.error || "Failed to apply enriched values")
            }
            return result
        },
        onSuccess: () => {
            toast.success("Applied enriched category/occasion to outfit")
            queryClient.invalidateQueries({ queryKey: enrichmentQueryKeys.all })
        },
        onError: (error: Error) => {
            toast.error(error.message)
        },
    })
}
