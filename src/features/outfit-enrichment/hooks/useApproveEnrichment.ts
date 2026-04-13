import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"
import { useAuth } from "@/contexts/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { enrichmentQueryKeys } from "../queryKeys"
import { approveDraft } from "@/services/outfit-enrichment/enrichmentsService"

/**
 * Hook to approve an enrichment draft.
 * 
 * Calls the approve_outfit_enrichment_draft RPC which atomically:
 * 1. Copies enriched fields from draft to outfits table
 * 2. Marks draft as approved with reviewer info
 */
export function useApproveEnrichment() {
    const queryClient = useQueryClient()
    const { user } = useAuth()
    const { toast } = useToast()

    return useMutation({
        mutationKey: [...enrichmentQueryKeys.all, "approve"] as const,
        mutationFn: async (draftId: string) => {
            if (!user) {
                throw new Error("Not authenticated")
            }
            return approveDraft(supabase, draftId, user.id)
        },
        onSuccess: (data) => {
            if (!data.success) {
                toast({
                    title: "Approval failed",
                    description: data.error || "Unknown error",
                    variant: "destructive",
                })
                return
            }

            // Invalidate all enrichment queries to update outfits status badges
            queryClient.invalidateQueries({
                queryKey: enrichmentQueryKeys.all,
            })

            toast({
                title: "Draft approved",
                description: "Enrichment data has been applied to the outfit",
            })
        },
        onError: (error: Error) => {
            toast({
                title: "Approval failed",
                description: error.message,
                variant: "destructive",
            })
        },
    })
}
