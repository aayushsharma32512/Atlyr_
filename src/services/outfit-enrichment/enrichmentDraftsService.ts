import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/integrations/supabase/types"

type ApprovalStatus = "pending" | "approved" | "rejected"

/**
 * EnrichmentDraft type with joined outfit data
 * Note: outfit_enrichment_drafts table created in migration 20260124000000
 */
export interface EnrichmentDraft {
    id: string
    outfit_id: string
    enriched_fit: string[] | null
    enriched_feel: string[] | null
    enriched_word_association: string | null
    enriched_description: string | null
    enriched_vibes: string[] | null
    suggested_name: string | null
    suggested_category: string | null
    suggested_occasion: string | null
    analyzed_occasions: string[] | null
    components_list: string[] | null
    search_summary: string | null
    // Metadata
    model_name: string
    model_version: string | null
    prompt_version: string
    // raw_response intentionally excluded - contains internal Gemini metadata
    approval_status: ApprovalStatus
    reviewed_by: string | null
    reviewed_at: string | null
    rejection_reason: string | null
    applied_at: string | null
    created_at: string
    updated_at: string
    // Joined outfit data
    outfit: {
        id: string
        name: string
        outfit_images: string | null
        user_id: string
        author_role?: string
    } | null
}

export interface UpdateDraftFields {
    enriched_fit?: string[] | null
    enriched_feel?: string[] | null
    enriched_word_association?: string | null
    enriched_description?: string | null
    enriched_vibes?: string[] | null
    suggested_name?: string | null
    suggested_category?: string | null
    suggested_occasion?: string | null
    // Prompt v2 fields
    analyzed_occasions?: string[] | null
    components_list?: string[] | null
    search_summary?: string | null
}

export interface PaginationParams {
    limit?: number
    offset?: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

// Select query for drafts with joined outfit data
// Note: raw_response intentionally excluded to prevent leaking internal Gemini metadata
const DRAFT_SELECT = `
  id,
  outfit_id,
  enriched_fit,
  enriched_feel,
  enriched_word_association,
  enriched_description,
  enriched_vibes,
  suggested_name,
  suggested_category,
  suggested_occasion,
  analyzed_occasions,
  components_list,
  search_summary,
  model_name,
  model_version,
  prompt_version,
  approval_status,
  reviewed_by,
  reviewed_at,
  rejection_reason,
  applied_at,
  created_at,
  updated_at,
  outfit:outfits!outfit_enrichment_drafts_outfit_id_fkey(id, name, outfit_images, user_id)
`

/**
 * Fetch enrichment drafts by approval status with pagination
 * @param pagination - Optional limit/offset (defaults to 50 items)
 */
export async function fetchDraftsByStatus(
    supabase: SupabaseClient<Database>,
    status: ApprovalStatus,
    pagination?: PaginationParams
): Promise<EnrichmentDraft[]> {
    const limit = Math.min(pagination?.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const offset = pagination?.offset ?? 0

    const { data, error } = await supabase
        .from("outfit_enrichment_drafts")
        .select(DRAFT_SELECT)
        .eq("approval_status", status)
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1)

    if (error) {
        throw new Error(`Failed to fetch drafts: ${error.message}`)
    }

    const drafts = (data ?? []) as unknown as EnrichmentDraft[]

    // Manual join to get author roles using RPC function (bypasses RLS)
    const userIds = Array.from(new Set(drafts.map(d => d.outfit?.user_id).filter(Boolean))) as string[]

    if (userIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
            .rpc('get_user_roles', { user_ids: userIds })




        const roleMap = new Map(profiles?.map(p => [p.found_user_id, p.found_role]))

        drafts.forEach(draft => {
            if (draft.outfit?.user_id) {
                const role = roleMap.get(draft.outfit.user_id)
                draft.outfit.author_role = role
            }
        })
    }

    return drafts
}

/**
 * Fetch a single enrichment draft by ID
 */
export async function fetchDraftById(
    supabase: SupabaseClient<Database>,
    draftId: string
): Promise<EnrichmentDraft | null> {
    const { data, error } = await supabase
        .from("outfit_enrichment_drafts")
        .select(DRAFT_SELECT)
        .eq("id", draftId)
        .maybeSingle()

    if (error) {
        throw new Error(`Failed to fetch draft: ${error.message}`)
    }

    const draft = data as unknown as EnrichmentDraft

    if (draft?.outfit?.user_id) {
        const { data: profiles } = await supabase
            .rpc('get_user_roles', { user_ids: [draft.outfit.user_id] })

        if (profiles && profiles.length > 0) {
            draft.outfit.author_role = profiles[0].found_role
        }
    }

    return draft
}

/**
 * Update enriched fields on a pending draft
 * Only allows updating drafts with approval_status = 'pending'
 */
export async function updateDraftFields(
    supabase: SupabaseClient<Database>,
    draftId: string,
    updates: UpdateDraftFields
): Promise<void> {
    const { error } = await supabase
        .from("outfit_enrichment_drafts")
        .update({
            ...updates,
            updated_at: new Date().toISOString(),
        })
        .eq("id", draftId)
        .eq("approval_status", "pending")

    if (error) {
        throw new Error(`Failed to update draft: ${error.message}`)
    }
}

/**
 * Delete an enrichment draft
 */
export async function deleteDraft(
    supabase: SupabaseClient<Database>,
    draftId: string
): Promise<void> {
    const { error } = await supabase
        .from("outfit_enrichment_drafts")
        .delete()
        .eq("id", draftId)

    if (error) {
        throw new Error(`Failed to delete draft: ${error.message}`)
    }
}
