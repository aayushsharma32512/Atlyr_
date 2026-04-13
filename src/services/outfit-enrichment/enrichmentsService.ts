import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/integrations/supabase/types"

/**
 * Result from the approve_outfit_enrichment_draft RPC function
 */
export interface ApproveResult {
    success: boolean
    outfit_id?: string
    error?: string
}

/**
 * Enrichment data for an outfit
 */
export interface OutfitEnrichment {
    enriched_fit: string[] | null
    enriched_feel: string[] | null
    enriched_word_association: string | null
    enriched_description: string | null
    enriched_vibes: string[] | null
    analyzed_occasions: string[] | null
    components_list: string[] | null
    search_summary: string | null
}

/**
 * Approve an enrichment draft
 * Calls the approve_outfit_enrichment_draft RPC which atomically:
 * 1. Copies enriched fields from draft to outfits table
 * 2. Marks draft as approved with reviewer info
 */
export async function approveDraft(
    supabase: SupabaseClient<Database>,
    draftId: string,
    reviewerId: string
): Promise<ApproveResult> {
    const { data, error } = await supabase.rpc("approve_outfit_enrichment_draft", {
        draft_id: draftId,
        reviewer_id: reviewerId,
    })

    if (error) {
        return { success: false, error: error.message }
    }

    // RPC returns JSONB with success, outfit_id, or error
    const result = data as unknown as ApproveResult
    return result
}

/**
 * Reject an enrichment draft with a reason
 */
export async function rejectDraft(
    supabase: SupabaseClient<Database>,
    draftId: string,
    reviewerId: string,
    rejectionReason: string
): Promise<void> {
    const { error } = await supabase
        .from("outfit_enrichment_drafts")
        .update({
            approval_status: "rejected",
            reviewed_by: reviewerId,
            reviewed_at: new Date().toISOString(),
            rejection_reason: rejectionReason,
            updated_at: new Date().toISOString(),
        })
        .eq("id", draftId)
        .eq("approval_status", "pending")

    if (error) {
        throw new Error(`Failed to reject draft: ${error.message}`)
    }
}

/**
 * Fetch enrichment data for multiple outfits
 * Returns a map of outfit_id to enrichment data
 * Only returns outfits that have been enriched (enriched_fit IS NOT NULL)
 */
export async function fetchEnrichedOutfits(
    supabase: SupabaseClient<Database>,
    outfitIds: string[]
): Promise<Record<string, OutfitEnrichment>> {
    if (outfitIds.length === 0) {
        return {}
    }

    const { data, error } = await supabase
        .from("outfits")
        .select(
            "id, enriched_fit, enriched_feel, enriched_word_association, enriched_description, enriched_vibes, analyzed_occasions, components_list, search_summary"
        )
        .in("id", outfitIds)
        .not("enriched_fit", "is", null)

    if (error) {
        throw new Error(`Failed to fetch enriched outfits: ${error.message}`)
    }

    const result: Record<string, OutfitEnrichment> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const outfit of (data ?? []) as any[]) {
        result[outfit.id] = {
            enriched_fit: outfit.enriched_fit,
            enriched_feel: outfit.enriched_feel,
            enriched_word_association: outfit.enriched_word_association,
            enriched_description: outfit.enriched_description,
            enriched_vibes: outfit.enriched_vibes,
            analyzed_occasions: outfit.analyzed_occasions,
            components_list: outfit.components_list,
            search_summary: outfit.search_summary,
        }
    }

    return result
}

/**
 * Apply enriched category, occasion, fit, feel, and vibes to the outfit's main fields
 * Copies enriched_category → category, enriched_occasion → occasion
 * Copies enriched_fit/feel/vibes arrays → comma-separated strings in fit/feel/vibes
 * Uses RPC with SECURITY DEFINER to bypass RLS
 */
export async function applyEnrichedCategoryOccasion(
    supabase: SupabaseClient<Database>,
    outfitId: string
): Promise<{ success: boolean; error?: string }> {
    console.log("[applyEnrichedCategoryOccasion] Calling RPC for outfitId:", outfitId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("apply_enriched_to_outfit", {
        p_outfit_id: outfitId,
    })

    console.log("[applyEnrichedCategoryOccasion] RPC result:", { data, error })

    if (error) {
        console.error("[applyEnrichedCategoryOccasion] RPC error:", error)
        return { success: false, error: error.message }
    }

    // RPC returns JSONB with success, outfit_id, or error
    const result = data as unknown as { success: boolean; error?: string; outfit_id?: string }

    if (!result.success) {
        console.error("[applyEnrichedCategoryOccasion] RPC returned error:", result.error)
        return { success: false, error: result.error || "Unknown error" }
    }

    console.log("[applyEnrichedCategoryOccasion] Success! Applied enriched values")
    return { success: true }
}
