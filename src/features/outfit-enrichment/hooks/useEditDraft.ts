import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { enrichmentQueryKeys } from "../queryKeys"
import {
    updateDraftFields,
    type UpdateDraftFields,
    type EnrichmentDraft,
} from "@/services/outfit-enrichment/enrichmentDraftsService"

interface EditDraftInput {
    draftId: string
    updates: UpdateDraftFields
}

interface MutationContext {
    previousDraft: EnrichmentDraft | undefined
}

/**
 * Hook to edit enrichment draft fields with optimistic updates.
 * 
 * Immediately updates the UI, then syncs with server.
 * Rolls back to previous state if the server update fails.
 */
export function useEditDraft() {
    const queryClient = useQueryClient()
    const { toast } = useToast()

    return useMutation<void, Error, EditDraftInput, MutationContext>({
        mutationKey: [...enrichmentQueryKeys.all, "edit"] as const,
        mutationFn: ({ draftId, updates }) =>
            updateDraftFields(supabase, draftId, updates),

        // Optimistic update: immediately update the cache
        onMutate: async ({ draftId, updates }) => {
            const queryKey = enrichmentQueryKeys.draftDetail(draftId)

            // Cancel any outgoing refetches to avoid race conditions
            await queryClient.cancelQueries({ queryKey })

            // Snapshot the previous value for rollback
            const previousDraft = queryClient.getQueryData<EnrichmentDraft>(queryKey)

            // Optimistically update the cache
            if (previousDraft) {
                queryClient.setQueryData<EnrichmentDraft>(queryKey, {
                    ...previousDraft,
                    ...updates,
                    updated_at: new Date().toISOString(),
                })
            }

            return { previousDraft }
        },

        // Rollback on error
        onError: (error, { draftId }, context) => {
            if (context?.previousDraft) {
                queryClient.setQueryData(
                    enrichmentQueryKeys.draftDetail(draftId),
                    context.previousDraft
                )
            }
            toast({
                title: "Save failed",
                description: error.message,
                variant: "destructive",
            })
        },

        // Always refetch after error or success to ensure consistency
        onSettled: (_, __, { draftId }) => {
            queryClient.invalidateQueries({
                queryKey: enrichmentQueryKeys.all,
            })
        },

        onSuccess: () => {
            toast({
                title: "Changes saved",
                description: "Draft updated successfully",
            })
        },
    })
}
