import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"
import { useAuth } from "@/contexts/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { enrichmentQueryKeys } from "../queryKeys"
import { rejectDraft } from "@/services/outfit-enrichment/enrichmentsService"

interface RejectInput {
    draftId: string
    reason: string
}

/**
 * Hook to reject an enrichment draft with a reason.
 * 
 * Updates the draft with:
 * - approval_status = 'rejected'
 * - reviewed_by = current user
 * - rejection_reason = provided reason
 */
export function useRejectEnrichment() {
    const queryClient = useQueryClient()
    const { user } = useAuth()
    const { toast } = useToast()

    return useMutation({
        mutationKey: [...enrichmentQueryKeys.all, "reject"] as const,
        mutationFn: async ({ draftId, reason }: RejectInput) => {
            if (!user) {
                throw new Error("Not authenticated")
            }
            return rejectDraft(supabase, draftId, user.id, reason)
        },
        onSuccess: () => {
            // Invalidate all enrichment queries to update outfits status badges
            queryClient.invalidateQueries({
                queryKey: enrichmentQueryKeys.all,
            })

            toast({
                title: "Draft rejected",
                description: "Enrichment draft has been rejected",
            })
        },
        onError: (error: Error) => {
            toast({
                title: "Rejection failed",
                description: error.message,
                variant: "destructive",
            })
        },
    })
}
