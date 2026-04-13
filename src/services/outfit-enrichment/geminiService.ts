import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/integrations/supabase/types"

/**
 * Response from the enrich-outfit edge function
 */
export type TriggerEnrichmentResponse = {
    success: boolean
    draft_id?: string
    message?: string
    error?: string
}

/**
 * Triggers Gemini Pro Vision analysis for an outfit image.
 * 
 * This function invokes the `enrich-outfit` edge function which:
 * 1. Loads the outfit's mannequin snapshot image
 * 2. Sends it to Gemini 3 Pro for vision analysis
 * 3. Extracts enrichment data (fit, feel, vibes, description, word associations)
 * 4. Stores the result in `outfit_enrichment_drafts` table for admin review
 * 
 * The function is idempotent - if a pending draft already exists for this outfit,
 * it returns the existing draft_id with message "draft_already_exists".
 * 
 * @param supabase - Supabase client instance
 * @param outfitId - ID of the outfit to enrich
 * @returns Promise with draft_id on success, or error details on failure
 * @throws Error with status code if the edge function invocation fails
 */
export async function triggerEnrichment(
    supabase: SupabaseClient<Database>,
    outfitId: string
): Promise<TriggerEnrichmentResponse> {
    const { data, error } = await supabase.functions.invoke<TriggerEnrichmentResponse>(
        "enrich-outfit",
        {
            body: { outfitId },
        }
    )

    if (error) {
        const wrappedError = new Error(`Enrichment failed: ${error.message}`) as Error & { status?: number }
        wrappedError.status = error.status
        throw wrappedError
    }

    if (!data) {
        throw new Error("Enrichment failed: No response data received")
    }

    return data
}
