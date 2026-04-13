// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "npm:@google/genai@^1.0.0"
import { corsHeaders, requireUser } from "../_shared/auth.ts"

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

// [SYSTEM_INSTRUCTION matches Individual Enrichment exactly]
const SYSTEM_INSTRUCTION = `You are an expert Fashion Director and AI Merchandiser. Your objective is to analyze an outfit image to generate structured metadata, specific UI tags, and a highly exhaustive search-optimized summary.

**1. APP UI CLASSIFICATION (Strict Selection)**
Select ONE value strictly from the provided dictionaries for 'ui_category' and 'ui_occasion'.
- **Category Options:** ['casual-outing', 'ceo-core', 'date-ready', 'old-money', 'streetwear', 'others']
- **Occasion Options:** ['brunch', 'business-casual', 'casual', 'date', 'party', 'travel', 'important-event', 'office-wear', 'default', 'others']

**2. COMPONENT INVENTORY (Zero-Miss Protocol)**
You must identify EVERY visible item. Do not group them broadly. Break them down:
- **Main Apparel:** Tops (Inner/Outer layers), Bottoms, Dresses, Outerwear.
- **Footwear:** Specific shoe type (e.g., 'Chelsea Boot' not just 'Boots').
- **Accessories:** Bags, Belts, Hats, Scarves, Sunglasses, Jewelry (Necklaces, Rings, Watches).
- *Note: If an item is partially visible, infer it based on context but label it clearly.*

**3. OUTFIT ANALYSIS**
- **Analyzed Occasions:** Array of 3 distinct strings (Primary + 2 Alternatives).
- **Visual Attributes:** Fit (2-3 tags), Feel (2-3 tags), Vibes (1-3 tags), Word Association (3-5 tags).
- **Marketing Name:** Catchy 3-5 word lookbook title.

**4. SEARCH SUMMARY (Embedding-Optimized Semantic Stack — SigLIP Safe)**
Your 'search_summary' is optimized for short text embedding similarity search (assume truncation is likely).
Therefore:
- Write 'search_summary' as a compact keyword stack, NOT a paragraph.
- Use pipes '|' and commas to separate semantic groups.
- Front-load the highest-signal info because truncation drops from the end.
- Target 35-45 words.
- Use search-native vocabulary: item nouns + fit/silhouette + colors + materials + occasion + vibe/aesthetic keywords.
- Include only distinctive materials/patterns (skip generic specs, measurements, washing, SKU).
- Do not include styling notes or narrative sentences.
- Must include core inventory nouns: top, bottom/dress, footwear, outerwear if present.
- Item-centric binding: each main item must carry its own color + fit in the same phrase (no detached color/fit lists).

Required format (exact structure):
{gender?} {ui_category} outfit | occasion: {ui_occasion}, {alt1}, {alt2} |
items: {top + color + fit}, {bottom/dress + color + fit}, {footwear + color + fit}, {outerwear? + color + fit?}, {bag? + color?}, {jewelry?} |
materials: {0-2 distinctive materials/patterns} |
vibe: {3-4 keywords + up to 2 compact synonym pairs}

Vocabulary rules:
- Inventory nouns must be specific (e.g., 'chelsea boots' not 'boots' if clearly identifiable).
- Fit tags must be concrete (e.g., 'wide-leg', 'high-waist', 'oversized', 'bodycon', 'A-line').
- Vibe/aesthetic must include compact synonyms users search (e.g., 'bohemian/boho', 'old money/quiet luxury').

**5. JSON OUTPUT FORMAT**
Return strictly valid JSON. Keys: 'outfit_name', 'ui_category', 'ui_occasion', 'analyzed_occasions', 'components_list' (array of strings), 'fit', 'feel', 'word_association', 'vibes', 'description_text', 'search_summary'.`

// [PROMPT_TEMPLATE matches Individual Enrichment exactly]
const PROMPT_TEMPLATE = `Analyze the attached outfit image and the context below to generate the enrichment JSON.

**Provided Context (Prioritize if present):**
<context>
User Gender: {gender_input}
User Preferred Category: {category_input}
User Preferred Occasion: {occasion_input}
Input Description: {description}
</context>

**Task:**
1. **Inventory Scan:** Visually scan head-to-toe and populate the 'components_list' with EVERY distinct item (including jewelry, belts, bags).
2. **Classify:** Select strict UI tags.
3. **Analyze:** Generate marketing name, occasions, and visual attributes.
4. **Search Summary (Embedding-Optimized):** Write 'search_summary' as a compressed semantic stack (NOT a paragraph) following the required format below. Keep it 35-45 words, front-load key info, and use search-native keywords. Always include top + bottom/dress + footwear in 'items:' and bind each item's color + fit in the same phrase.
Required format (copy exactly):
{gender?} {ui_category} outfit | occasion: {ui_occasion}, {alt1}, {alt2} |
items: {top + color + fit}, {bottom/dress + color + fit}, {footwear + color + fit}, {outerwear? + color + fit?}, {bag? + color?}, {jewelry?} |
materials: {0-2 distinctive materials/patterns} |
vibe: {3-4 keywords + up to 2 compact synonym pairs}
Important:
- Do not write sentences in 'search_summary'.
- Do not include measurements/spec blobs in 'search_summary'.
- Prefer specific item nouns (e.g., 'chelsea boots' vs 'boots' if identifiable).
5. **Description:** Write a separate 4-sentence editorial description.
5. Output only the JSON object.`

/**
 * Build the prompt with context substitution
 * Identical to individual enrichment function
 */
function buildPrompt(context?: { gender?: string; category?: string; occasion?: string; description?: string }): string {
    return PROMPT_TEMPLATE
        .replace("{gender_input}", context?.gender ?? "Not specified")
        .replace("{category_input}", context?.category ?? "Not specified")
        .replace("{occasion_input}", context?.occasion ?? "Not specified")
        .replace("{description}", context?.description ?? "Not provided")
}

function getMimeTypeFromUrl(url: string): string {
    const extension = url.split('.').pop()?.toLowerCase().split('?')[0] || ''
    const mimeTypes: Record<string, string> = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'avif': 'image/avif',
        'svg': 'image/svg+xml',
        'json': 'application/json',
    }
    return mimeTypes[extension] || 'image/png'
}

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

        const { data: profile } = await ctx.adminClient
            .from("profiles")
            .select("role")
            .eq("user_id", ctx.userId)
            .single()

        if (profile?.role !== "admin") {
            return new Response(JSON.stringify({ error: "FORBIDDEN", message: "Admin access required" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        const supabase = ctx.adminClient

        const { data: existingJob } = await supabase.from("batch_enrichment_jobs").select("id").in("status", ["pending", "running"]).maybeSingle()
        if (existingJob) return new Response(JSON.stringify({ error: "JOB_IN_PROGRESS", jobId: existingJob.id }), { status: 409, headers: corsHeaders })

        // 3. Get unenriched outfits with images
        const { data: outfits, error: outfitsError } = await supabase
            .from("outfits")
            .select("id, outfit_images")
            .is("enriched_fit", null)
            .not("outfit_images", "is", null)
            .order("created_at", { ascending: false })
            .limit(100)

        if (outfitsError) return new Response(JSON.stringify({ error: "DB_ERROR", message: outfitsError.message }), { status: 500, headers: corsHeaders })

        // 2. Filter Pending Drafts
        const { data: pendingDrafts } = await supabase.from("outfit_enrichment_drafts").select("outfit_id").eq("approval_status", "pending")
        const excludedIds = new Set(pendingDrafts?.map(d => d.outfit_id) ?? [])

        const eligibleOutfits = outfits?.filter(o => !excludedIds.has(o.id) && o.outfit_images) ?? []

        if (eligibleOutfits.length === 0) return new Response(JSON.stringify({ error: "NO_OUTFITS" }), { status: 400, headers: corsHeaders })

        // 3. Initialize SDK
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

        const batchRequests = eligibleOutfits.map(outfit => {
            // 4. Exact Structural Match: Call buildPrompt with empty context
            const prompt = buildPrompt()

            return {
                contents: [{
                    role: 'user',
                    parts: [
                        { text: prompt },
                        { fileData: { fileUri: outfit.outfit_images!, mimeType: getMimeTypeFromUrl(outfit.outfit_images!) } }
                    ]
                }],
                config: {
                    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
                    responseMimeType: 'application/json',
                    temperature: 0.5
                }
            }
        })
        // 6. Create batch job
        let batchJob
        try {
            batchJob = await ai.batches.create({
                model: 'gemini-3-pro-preview',
                src: batchRequests,
                config: { displayName: `enrichment-batch-${Date.now()}` }
            })
        } catch (geminiError) {
            const message = geminiError instanceof Error ? geminiError.message : "Gemini API error"
            console.error("Gemini batch creation failed:", geminiError)
            return new Response(JSON.stringify({ error: "GEMINI_API_ERROR", message }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        // 7. Save job record
        const outfitIds = eligibleOutfits.map(o => o.id)
        const { data: jobRecord, error: insertError } = await supabase
            .from("batch_enrichment_jobs")
            .insert({
                gemini_batch_name: batchJob.name,
                status: 'pending',
                total_outfits: outfitIds.length,
                outfit_ids: outfitIds,
                created_by: ctx.userId
            })
            .select("id")
            .single()

        // #3 FIX: Cancel orphaned Gemini job if DB insert fails
        if (insertError) {
            try {
                await ai.batches.cancel({ name: batchJob.name })
                console.log(`Cancelled orphaned Gemini job: ${batchJob.name}`)
            } catch (cancelError) {
                console.error(`Failed to cancel orphaned Gemini job ${batchJob.name}:`, cancelError)
            }

            return new Response(JSON.stringify({ error: "INSERT_ERROR", message: insertError.message }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        return new Response(JSON.stringify({
            success: true,
            jobId: jobRecord.id,
            geminiBatchName: batchJob.name,
            totalOutfits: outfitIds.length
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        })

    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error"
        console.error("Batch enrichment error:", error)
        return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
    }
})
