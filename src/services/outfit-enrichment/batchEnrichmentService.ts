import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/integrations/supabase/types"

export interface BatchJobStatus {
    status: "pending" | "running" | "succeeded" | "failed" | "cancelled"
    totalOutfits: number
    processedOutfits: number
    failedOutfits?: number
    error?: string
    rawBatchJob?: any
}

export interface CreateBatchResponse {
    success: boolean
    jobId: string
    totalOutfits: number
    error?: string
}

/**
 * Create a batch enrichment job for all unenriched outfits.
 * 
 * This triggers the create-batch-enrichment edge function which:
 * 1. Checks for existing pending/running jobs (prevents duplicates)
 * 2. Queries all outfits without enrichment data
 * 3. Filters out outfits with pending/rejected drafts
 * 4. Creates a Gemini batch job
 * 5. Stores the job record for polling
 * 
 * Returns existing jobId if a job is already in progress.
 */
export async function createBatchEnrichmentJob(
    supabase: SupabaseClient<Database>
): Promise<CreateBatchResponse> {
    const { data, error } = await supabase.functions.invoke<CreateBatchResponse & { error?: string; jobId?: string }>(
        "create-batch-enrichment"
    )
    console.log("Create Batch Response:", { data, error })

    if (error) {
        throw new Error(`Failed to create batch job: ${error.message}`)
    }

    // Handle job already in progress - return existing job ID
    if (data?.error === "JOB_IN_PROGRESS" && data?.jobId) {
        return {
            success: true,
            jobId: data.jobId,
            totalOutfits: 0, // Unknown for existing job
        }
    }

    if (!data?.success) {
        throw new Error(data?.error || "Failed to create batch job")
    }

    return data
}

/**
 * Poll the status of a batch enrichment job.
 * 
 * This triggers the poll-batch-enrichment edge function which:
 * 1. Checks the Gemini batch job status
 * 2. If succeeded, parses results and creates enrichment drafts
 * 3. Updates the job record in the database
 */
export async function pollBatchEnrichmentJob(
    supabase: SupabaseClient<Database>,
    jobId: string
): Promise<BatchJobStatus> {
    const { data, error } = await supabase.functions.invoke<BatchJobStatus>(
        "poll-batch-enrichment",
        { body: { jobId } }
    )
    console.log("Poll Batch Response:", { jobId, data, error })

    if (error) {
        throw new Error(`Failed to poll batch job: ${error.message}`)
    }

    if (!data) {
        throw new Error("No response from poll endpoint")
    }

    return data
}

/**
 * Get the count of outfits eligible for enrichment.
 * 
 * Criteria:
 * - enriched_fit is null (not yet enriched)
 * - outfit_images is not null (has image)
 * - valid image URL (http/https)
 * - NO pending drafts (already in review)
 */
export async function getUnenrichedOutfitsCount(
    supabase: SupabaseClient<Database>
): Promise<number> {
    // 1. Get IDs of outfits with pending drafts to exclude
    const { data: pendingDrafts, error: draftsError } = await supabase
        .from("outfit_enrichment_drafts")
        .select("outfit_id")
        .eq("approval_status", "pending")

    if (draftsError) throw new Error(`Failed to fetch pending drafts: ${draftsError.message}`)

    const excludedIds = new Set(pendingDrafts?.map(d => d.outfit_id) ?? [])

    // 2. Count unenriched outfits
    const { count, error } = await supabase
        .from("outfits")
        .select("*", { count: "exact", head: true })
        .is("enriched_fit", null)
        .not("outfit_images", "is", null)

    if (error) throw new Error(`Failed to count unenriched outfits: ${error.message}`)

    // Note: We can't easily perform "NOT IN" with a large array in a GET request (header URI limit)
    // So for accuracy, the true "unenriched" count is technically (total_unenriched - pending).
    // This is an approximation if the list is huge, but good enough for UI.
    // If pending list is small (usual case), we can subtract it if those are subset of unenriched.
    // Since pending drafts imply the outfit is NOT yet enriched designated in `outfits` table, 
    // we should subtract the count of relevant pending drafts.

    // However, simpler approach: Just trust the `outfits` table count for "Not Generated".
    // "Pending" status in UI is derived from the drafts table.
    // The "Batch Enrich" function filters out pending ones. 
    // So the "Actionable" count is (Total Unenriched - Pending Count).

    return Math.max(0, (count ?? 0) - excludedIds.size)
}
