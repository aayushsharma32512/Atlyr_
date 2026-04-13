// @ts-ignore
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "npm:@google/genai@^1.0.0"
import { corsHeaders, requireUser } from "../_shared/auth.ts"

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const MODEL_NAME = "gemini-3-pro-preview"  // Same as individual enrichment
const MODEL_VERSION = "3.0"
const PROMPT_VERSION = "batch-v1"

const VALID_CATEGORY_VALUES = ['casual-outing', 'ceo-core', 'date-ready', 'old-money', 'streetwear', 'others']
const VALID_OCCASION_VALUES = ['brunch', 'business-casual', 'casual', 'date', 'party', 'travel', 'important-event', 'office-wear', 'default', 'others']

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders })
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
            status: 405,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
    }

    try {
        const ctx = await requireUser(req)
        if (!ctx.userId) {
            return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        const { jobId } = await req.json()
        if (!jobId) {
            return new Response(JSON.stringify({ error: "MISSING_JOB_ID" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        const supabase = ctx.adminClient

        // 1. Get job from DB
        const { data: job, error: jobError } = await supabase
            .from("batch_enrichment_jobs")
            .select("*")
            .eq("id", jobId)
            .single()

        if (jobError || !job) {
            return new Response(JSON.stringify({ error: "JOB_NOT_FOUND" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        // If already completed, return cached status ONLY if no failures to report
        // This allows re-fetching the result file to debug failures
        if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
            return new Response(JSON.stringify({
                status: job.status,
                totalOutfits: job.total_outfits,
                processedOutfits: job.processed_outfits,
                failedOutfits: job.failed_outfits,
                error: job.error_message
            }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        // 2. Query Gemini for job status
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
        const batchJob = await ai.batches.get({ name: job.gemini_batch_name })

        // 3. Handle based on state
        if (batchJob.state === 'JOB_STATE_SUCCEEDED') {
            // Batch API may store results inline or in a file
            let responses: Array<{ customId?: string; custom_id?: string; key?: string; response?: { text?: string; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }; error?: unknown }> = []
            let jsonlString = ""

            // Check for inlined responses first (small batches may have inline)
            if (batchJob.dest?.inlinedResponses && batchJob.dest.inlinedResponses.length > 0) {
                // @ts-ignore
                responses = batchJob.dest.inlinedResponses.map((r: any) => ({
                    response: r.response,
                    error: r.error
                }))
            }
            // Otherwise download from output file
            else if (batchJob.dest?.fileName) {
                try {
                    const fileContent = await ai.files.download({ file: batchJob.dest.fileName })
                    // fileContent is a Buffer/Uint8Array - convert to string and parse JSONL
                    jsonlString = typeof fileContent === 'string'
                        ? fileContent
                        : new TextDecoder().decode(fileContent)

                    // Parse JSONL (each line is a JSON object with customId and response)
                    const lines = jsonlString.trim().split('\n')
                    for (const line of lines) {
                        if (line.trim()) {
                            try {
                                const parsed = JSON.parse(line)
                                responses.push(parsed)
                            } catch (lineError) {
                                console.error('Failed to parse JSONL line:', line, lineError)
                            }
                        }
                    }
                } catch (downloadError) {
                    console.error('Failed to download batch results file:', downloadError)
                    await supabase
                        .from("batch_enrichment_jobs")
                        .update({
                            status: 'failed',
                            error_message: `Failed to download results: ${downloadError}`,
                            updated_at: new Date().toISOString()
                        })
                        .eq("id", jobId)

                    return new Response(JSON.stringify({
                        status: 'failed',
                        error: 'Failed to download batch results'
                    }), {
                        headers: { ...corsHeaders, "Content-Type": "application/json" },
                    })
                }
            }

            // Process results
            let actualInserts = 0

            for (let i = 0; i < responses.length; i++) {
                const resp = responses[i]
                const outfitId = job.outfit_ids[i]

                // Get response text - handle different response structures
                const responseText = resp.response?.text
                    || resp.response?.candidates?.[0]?.content?.parts?.[0]?.text

                if (responseText) {
                    try {
                        const enrichment = JSON.parse(responseText)

                        // #8 FIX: Strict validation (same as individual enrichment)
                        if (!VALID_CATEGORY_VALUES.includes(enrichment.ui_category)) {
                            console.error(`Invalid category: ${enrichment.ui_category}`)
                            continue
                        }

                        if (!VALID_OCCASION_VALUES.includes(enrichment.ui_occasion)) {
                            console.error(`Invalid occasion: ${enrichment.ui_occasion}`)
                            continue
                        }

                        const { error: insertError } = await supabase.from("outfit_enrichment_drafts").insert({
                            outfit_id: outfitId,
                            batch_job_id: job.id, // Track which batch created this draft
                            // New schema fields
                            suggested_name: enrichment.outfit_name,
                            suggested_category: enrichment.ui_category,
                            suggested_occasion: enrichment.ui_occasion,
                            analyzed_occasions: enrichment.analyzed_occasions,
                            components_list: enrichment.components_list,
                            enriched_fit: enrichment.fit,
                            enriched_feel: enrichment.feel,
                            enriched_word_association: Array.isArray(enrichment.word_association)
                                ? enrichment.word_association.join(", ")
                                : String(enrichment.word_association || ""),
                            enriched_vibes: Array.isArray(enrichment.vibes) ? enrichment.vibes : [],
                            enriched_description: String(enrichment.description_text || ""),
                            search_summary: enrichment.search_summary,
                            // Metadata
                            model_name: MODEL_NAME,
                            model_version: MODEL_VERSION,
                            prompt_version: PROMPT_VERSION,
                            raw_response: enrichment
                        })

                        if (insertError) {
                            console.error(`Failed to insert draft for ${outfitId}:`, insertError)
                        } else {
                            actualInserts++
                        }
                    } catch (parseError) {
                        console.error(`Failed to parse response for outfit ${outfitId}:`, parseError)
                    }
                } else if (resp.error) {
                    console.error(`Error for outfit ${outfitId}:`, resp.error)
                } else {
                    console.error(`No response text for outfit ${outfitId}`)
                }
            }

            // Count failed based on the presence of 'error' in the response object
            const failed = responses.filter(r => r.error).length
            // Processed is the total responses minus those that failed
            const processed = responses.length - failed

            // Update job status
            await supabase
                .from("batch_enrichment_jobs")
                .update({
                    status: 'succeeded',
                    processed_outfits: processed,
                    failed_outfits: failed,
                    completed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq("id", jobId)

            return new Response(JSON.stringify({
                status: 'succeeded',
                totalOutfits: job.total_outfits,
                processedOutfits: processed,
                failedOutfits: failed,
                rawJsonl: jsonlString,
                rawBatchJob: batchJob
            }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        if (batchJob.state === 'JOB_STATE_FAILED') {
            await supabase
                .from("batch_enrichment_jobs")
                .update({
                    status: 'failed',
                    error_message: JSON.stringify(batchJob.error),
                    updated_at: new Date().toISOString()
                })
                .eq("id", jobId)

            return new Response(JSON.stringify({
                status: 'failed',
                totalOutfits: job.total_outfits,
                error: batchJob.error,
                rawBatchJob: batchJob
            }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        if (batchJob.state === 'JOB_STATE_CANCELLED' || batchJob.state === 'JOB_STATE_EXPIRED') {
            await supabase
                .from("batch_enrichment_jobs")
                .update({
                    status: 'cancelled',
                    error_message: `Job ${batchJob.state}`,
                    updated_at: new Date().toISOString()
                })
                .eq("id", jobId)

            return new Response(JSON.stringify({
                status: 'cancelled',
                totalOutfits: job.total_outfits,
                error: batchJob.state,
                rawBatchJob: batchJob
            }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        // #7 FIX: Handle PAUSED and RESUMING states
        if (batchJob.state === 'JOB_STATE_PAUSED' || batchJob.state === 'JOB_STATE_RESUMING') {
            const newStatus = 'running' // Treat as active job
            if (job.status !== newStatus) {
                await supabase
                    .from("batch_enrichment_jobs")
                    .update({
                        status: newStatus,
                        error_message: `Job is ${batchJob.state}`,
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", jobId)
            }

            return new Response(JSON.stringify({
                status: newStatus,
                totalOutfits: job.total_outfits,
                processedOutfits: 0,
                note: batchJob.state,
                rawBatchJob: batchJob
            }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        // Still running - update status if changed
        const newStatus = batchJob.state === 'JOB_STATE_RUNNING' ? 'running' : 'pending'
        if (job.status !== newStatus) {
            await supabase
                .from("batch_enrichment_jobs")
                .update({ status: newStatus, updated_at: new Date().toISOString() })
                .eq("id", jobId)
        }

        return new Response(JSON.stringify({
            status: newStatus,
            totalOutfits: job.total_outfits,
            processedOutfits: 0,
            rawBatchJob: batchJob
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        })

    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error"
        console.error("Poll batch enrichment error:", error)
        return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
    }
})
