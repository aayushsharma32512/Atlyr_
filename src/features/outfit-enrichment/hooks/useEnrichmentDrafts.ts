import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"
import { enrichmentQueryKeys } from "../queryKeys"
import { fetchDraftsByStatus, type EnrichmentDraft } from "@/services/outfit-enrichment/enrichmentDraftsService"

type ApprovalStatus = "pending" | "approved" | "rejected"

/**
 * Hook to fetch enrichment drafts by approval status.
 * 
 * Returns drafts with joined outfit data (including outfit_images for preview).
 * Ordered by created_at DESC (newest first).
 */
export function useEnrichmentDrafts(
    status: ApprovalStatus,
    page: number = 1,
    limit: number = 50
) {
    const offset = (page - 1) * limit

    return useQuery<EnrichmentDraft[], Error>({
        queryKey: enrichmentQueryKeys.draftsByStatus(status, page, limit),
        queryFn: () => fetchDraftsByStatus(supabase, status, { limit, offset }),
        staleTime: 30_000, // 30 seconds
        gcTime: 5 * 60_000, // 5 minutes
        placeholderData: (previousData) => previousData, // Keep previous data while fetching new page
    })
}
