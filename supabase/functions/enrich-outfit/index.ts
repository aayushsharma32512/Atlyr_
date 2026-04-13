// @ts-nocheck
/* eslint-disable */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders, requireUser } from "../_shared/auth.ts"
import { generateJson, toInlineImagePartFromUrl } from "../_shared/gemini.ts"

// Rate limiting configuration
const RATE_LIMIT_MAX_REQUESTS = 10  // Max enrichments per window
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute window

// Simple in-memory rate limiter (resets on function restart)
// For production, consider using Redis or database-backed rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(userId: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now()
    const record = rateLimitMap.get(userId)

    if (!record || now >= record.resetAt) {
        // New window - allow and reset counter
        rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
        return { allowed: true }
    }

    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
        // Rate limited
        return { allowed: false, retryAfterMs: record.resetAt - now }
    }

    // Increment counter
    record.count++
    return { allowed: true }
}

// Version tracking for traceability
const MODEL_NAME = "gemini-3-pro-preview"
const MODEL_VERSION = "3.0"
const PROMPT_VERSION = "v1.0"

// System instruction for outfit analysis
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

// Prompt template for enrichment
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

// Validation for category values - must match DB FK IDs in categories table
const VALID_CATEGORY_VALUES = ["casual-outing", "ceo-core", "date-ready", "old-money", "streetwear", "others"]

// Validation for occasion values - must match DB FK IDs in occasions table
const VALID_OCCASION_VALUES = ["brunch", "business-casual", "casual", "date", "party", "travel", "important-event", "office-wear", "default", "others"]

interface EnrichmentResult {
    outfit_name: string
    ui_category: string
    ui_occasion: string
    analyzed_occasions: string[]
    components_list: string[]
    fit: string[]
    feel: string[]
    word_association: string[]
    vibes: string[]
    description_text: string
    search_summary: string
}

function validateEnrichmentResult(data: unknown): data is EnrichmentResult {
    if (!data || typeof data !== "object") return false
    const obj = data as Record<string, unknown>

    if (typeof obj.outfit_name !== "string") return false
    if (typeof obj.ui_category !== "string") return false
    if (typeof obj.ui_occasion !== "string") return false
    if (!Array.isArray(obj.analyzed_occasions)) return false
    if (!Array.isArray(obj.components_list)) return false
    if (!Array.isArray(obj.fit)) return false
    if (!Array.isArray(obj.feel)) return false
    if (!Array.isArray(obj.word_association)) return false
    if (!Array.isArray(obj.vibes)) return false
    if (typeof obj.description_text !== "string") return false
    if (typeof obj.search_summary !== "string") return false

    return true
}

/**
 * Build the prompt with context substitution
 */
function buildPrompt(context?: { gender?: string; category?: string; occasion?: string; description?: string }): string {
    return PROMPT_TEMPLATE
        .replace("{gender_input}", context?.gender ?? "Not specified")
        .replace("{category_input}", context?.category ?? "Not specified")
        .replace("{occasion_input}", context?.occasion ?? "Not specified")
        .replace("{description}", context?.description ?? "Not provided")
}

serve(async (req) => {
    // Handle CORS preflight
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
        // Authenticate and get admin client
        const ctx = await requireUser(req)
        if (!ctx.userId) {
            return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        // Check if user is admin
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

        // Rate limit check - prevent API quota exhaustion
        const rateLimit = checkRateLimit(ctx.userId)
        if (!rateLimit.allowed) {
            return new Response(JSON.stringify({
                error: "RATE_LIMITED",
                message: `Too many enrichment requests. Try again in ${Math.ceil((rateLimit.retryAfterMs || 0) / 1000)} seconds`,
                retryAfterMs: rateLimit.retryAfterMs
            }), {
                status: 429,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                    "Retry-After": String(Math.ceil((rateLimit.retryAfterMs || 0) / 1000))
                },
            })
        }

        // Parse request body
        let payload: { outfitId: string; context?: { gender?: string; category?: string; occasion?: string; description?: string } }
        try {
            payload = await req.json()
        } catch {
            return new Response(JSON.stringify({ error: "INVALID_JSON" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        const { outfitId, context } = payload
        if (!outfitId || typeof outfitId !== "string") {
            return new Response(JSON.stringify({ error: "INVALID_OUTFIT_ID" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            })
        }

        const supabase = ctx.adminClient

        // Idempotency check: return existing pending draft if exists
        const { data: existingDraft } = await supabase
            .from("outfit_enrichment_drafts")
            .select("id")
            .eq("outfit_id", outfitId)
            .eq("approval_status", "pending")
            .maybeSingle()

        if (existingDraft) {
            return new Response(
                JSON.stringify({
                    success: true,
                    draft_id: existingDraft.id,
                    message: "draft_already_exists",
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            )
        }

        // Fetch outfit with images
        const { data: outfit, error: outfitError } = await supabase
            .from("outfits")
            .select("id, outfit_images")
            .eq("id", outfitId)
            .single()

        if (outfitError || !outfit) {
            return new Response(
                JSON.stringify({ error: "OUTFIT_NOT_FOUND", message: outfitError?.message }),
                {
                    status: 404,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            )
        }

        if (!outfit.outfit_images) {
            return new Response(
                JSON.stringify({ error: "NO_OUTFIT_IMAGE", message: "Outfit has no images to analyze" }),
                {
                    status: 422,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            )
        }

        // P3: Validate image URL format before calling Gemini
        if (!outfit.outfit_images.startsWith('http://') && !outfit.outfit_images.startsWith('https://')) {
            console.error(`Invalid image URL for outfit ${outfitId}:`, outfit.outfit_images)
            return new Response(
                JSON.stringify({
                    error: "INVALID_IMAGE_URL",
                    message: "Outfit image URL must be a valid HTTP/HTTPS URL",
                    received: outfit.outfit_images
                }),
                {
                    status: 422,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            )
        }

        // Load image for Gemini
        const imagePart = await toInlineImagePartFromUrl(outfit.outfit_images)

        // Build prompt with context
        const prompt = buildPrompt(context)

        // Call Gemini for enrichment
        const jsonText = await generateJson({
            modelName: MODEL_NAME,
            systemInstruction: SYSTEM_INSTRUCTION,
            temperature: 0.5,
            parts: [{ text: prompt }, imagePart],
        })

        // Parse and validate response
        let result: EnrichmentResult
        try {
            result = JSON.parse(jsonText)
        } catch {
            return new Response(
                JSON.stringify({ error: "GEMINI_PARSE_ERROR", message: "Failed to parse Gemini response", raw: jsonText }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            )
        }

        if (!validateEnrichmentResult(result)) {
            return new Response(
                JSON.stringify({ error: "INVALID_ENRICHMENT_SCHEMA", message: "Response missing required fields", raw: result }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            )
        }

        // Validate category value
        if (!VALID_CATEGORY_VALUES.includes(result.ui_category)) {
            return new Response(
                JSON.stringify({
                    error: "INVALID_CATEGORY_VALUE",
                    message: `ui_category must be one of: ${VALID_CATEGORY_VALUES.join(", ")}`,
                    received: result.ui_category,
                }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            )
        }

        // Validate occasion value
        if (!VALID_OCCASION_VALUES.includes(result.ui_occasion)) {
            return new Response(
                JSON.stringify({
                    error: "INVALID_OCCASION_VALUE",
                    message: `ui_occasion must be one of: ${VALID_OCCASION_VALUES.join(", ")}`,
                    received: result.ui_occasion,
                }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            )
        }

        // Insert draft into staging table with new schema fields
        const { data: draft, error: insertError } = await supabase
            .from("outfit_enrichment_drafts")
            .insert({
                outfit_id: outfitId,
                // New schema fields
                suggested_name: result.outfit_name,
                suggested_category: result.ui_category,
                suggested_occasion: result.ui_occasion,
                analyzed_occasions: result.analyzed_occasions,
                components_list: result.components_list,
                enriched_fit: result.fit,
                enriched_feel: result.feel,
                enriched_word_association: result.word_association.join(", "),
                enriched_vibes: result.vibes,
                enriched_description: result.description_text,
                search_summary: result.search_summary,
                // Metadata
                model_name: MODEL_NAME,
                model_version: MODEL_VERSION,
                prompt_version: PROMPT_VERSION,
                raw_response: result,
            })
            .select("id")
            .single()

        if (insertError) {
            return new Response(
                JSON.stringify({ error: "INSERT_FAILED", message: insertError.message }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            )
        }

        return new Response(
            JSON.stringify({ success: true, draft_id: draft.id }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error"
        return new Response(
            JSON.stringify({ error: "INTERNAL_ERROR", message }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        )
    }
})
