import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"
import { enrichmentQueryKeys } from "../queryKeys"
import { triggerEnrichment } from "@/services/outfit-enrichment/geminiService"
import { useToast } from "@/hooks/use-toast"

/**
 * Hook to trigger AI enrichment for an outfit.
 * 
 * Invokes the enrich-outfit edge function which:
 * 1. Analyzes the outfit's mannequin image with Gemini Pro Vision
 * 2. Creates an enrichment draft for admin review
 * 
 * The mutation is idempotent - triggering on an already-pending outfit
 * returns the existing draft without creating a duplicate.
 */
export function useTriggerEnrichment() {
    const queryClient = useQueryClient()
    const { toast } = useToast()

    return useMutation({
        mutationKey: [...enrichmentQueryKeys.all, "trigger"] as const,
        mutationFn: (outfitId: string) => triggerEnrichment(supabase, outfitId),
        onSuccess: (data) => {
            // Invalidate all enrichment queries to update outfits status and pending drafts
            queryClient.invalidateQueries({
                queryKey: enrichmentQueryKeys.all,
            })
            toast({
                title: "Enrichment queued",
                description:
                    data.message === "draft_already_exists"
                        ? "Draft already pending review"
                        : "AI analysis queued for review",
            })
        },
        onError: (error: Error) => {
            toast({
                title: "Enrichment failed",
                description: error.message,
                variant: "destructive",
            })
        },
    })
}
