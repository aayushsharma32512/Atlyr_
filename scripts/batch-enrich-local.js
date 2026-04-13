import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import axios from 'axios';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GEMINI_API_KEY) {
    console.error('❌ Missing required environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY)');
    process.exit(1);
}

// Initialize clients
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Constants matching edge function
const MODEL_NAME = "gemini-3-pro-preview";
const MODEL_VERSION = "3.0";
const PROMPT_VERSION = "batch-v1";
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
Return strictly valid JSON. Keys: 'outfit_name', 'ui_category', 'ui_occasion', 'analyzed_occasions', 'components_list' (array of strings), 'fit', 'feel', 'word_association', 'vibes', 'description_text', 'search_summary'.`;

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
5. Output only the JSON object.`;

const VALID_CATEGORY_VALUES = ["casual-outing", "ceo-core", "date-ready", "old-money", "streetwear", "others"];
const VALID_OCCASION_VALUES = ["brunch", "business-casual", "casual", "date", "party", "travel", "important-event", "office-wear", "default", "others"];

function buildPrompt(context = {}) {
    return PROMPT_TEMPLATE
        .replace("{gender_input}", context.gender ?? "Not specified")
        .replace("{category_input}", context.category ?? "Not specified")
        .replace("{occasion_input}", context.occasion ?? "Not specified")
        .replace("{description}", context.description ?? "Not provided");
}

async function imageToBase64(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
        const mimeType = response.headers['content-type'] || 'image/png';
        return {
            data: buffer.toString('base64'),
            mimeType
        };
    } catch (error) {
        console.error(`Failed to fetch image from ${url}:`, error.message);
        return null;
    }
}

async function runBatchEnrichment() {
    console.log('🚀 Starting local batch enrichment...');

    // 1. Fetch unenriched outfits
    const { data: outfits, error: fetchError } = await supabase
        .from('outfits')
        .select('id, outfit_images')
        .is('enriched_fit', null)
        .not('outfit_images', 'is', null)
        .order('created_at', { ascending: false });

    if (fetchError) {
        console.error('❌ Error fetching outfits:', fetchError.message);
        return;
    }

    // 2. Fetch pending drafts to exclude
    const { data: pendingDrafts, error: draftsError } = await supabase
        .from("outfit_enrichment_drafts")
        .select("outfit_id")
        .eq("approval_status", "pending");

    if (draftsError) {
        console.error('❌ Error fetching drafts:', draftsError.message);
        return;
    }

    const excludedIds = new Set(pendingDrafts?.map(d => d.outfit_id) ?? []);
    
    // 3. Filter eligible outfits (unenriched + no pending draft + valid URL)
    const eligibleOutfits = outfits?.filter(o => 
        !excludedIds.has(o.id) && 
        o.outfit_images && 
        (o.outfit_images.startsWith('http://') || o.outfit_images.startsWith('https://'))
    ) ?? [];

    if (eligibleOutfits.length === 0) {
        console.log('✅ No eligible outfits found for enrichment.');
        return;
    }

    console.log(`📊 Found ${eligibleOutfits.length} outfits to enrich after filtering (excluded ${excludedIds.size} pending).`);

    // 4. Prepare batch requests
    const batchRequests = [];
    const processingIds = [];

    for (const outfit of eligibleOutfits) {
        console.log(`🖼️  Processing image for outfit ${outfit.id}...`);
        const imageData = await imageToBase64(outfit.outfit_images);
        if (!imageData) continue;

        const prompt = buildPrompt();
        batchRequests.push({
            contents: [{
                role: 'user',
                parts: [
                    { text: prompt },
                    { inlineData: { data: imageData.data, mimeType: imageData.mimeType } }
                ]
            }],
            config: {
                systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
                responseMimeType: 'application/json',
                temperature: 0.5
            }
        });
        processingIds.push(outfit.id);
    }

    if (batchRequests.length === 0) {
        console.log('❌ No valid images found to process.');
        return;
    }

    // 3. Create Gemini batch job
    console.log('📡 Submitting batch job to Gemini...');
    let batchJob;
    try {
        batchJob = await ai.batches.create({
            model: MODEL_NAME,
            src: batchRequests,
            config: { displayName: `local-enrichment-${Date.now()}` }
        });
    } catch (error) {
        console.error('❌ Gemini batch creation failed:', error.message);
        return;
    }

    console.log(`✅ Batch job created: ${batchJob.name}`);

    // 4. Record job in Supabase
    const { data: jobRecord, error: insertError } = await supabase
        .from('batch_enrichment_jobs')
        .insert({
            gemini_batch_name: batchJob.name,
            status: 'running',
            total_outfits: processingIds.length,
            outfit_ids: processingIds,
        })
        .select('id')
        .single();

    if (insertError) {
        console.error('❌ Failed to record job in DB:', insertError.message);
        // We'll continue anyway as the Gemini job is already running
    } else {
        console.log(`📝 Recorded job in database with ID: ${jobRecord.id}`);
    }

    // 5. Polling for completion
    console.log('⏳ Polling for job completion (this may take several minutes)...');
    let completed = false;
    let pollCount = 0;
    while (!completed) {
        await new Promise(resolve => setTimeout(resolve, 30000)); // Poll every 30s
        pollCount++;
        
        try {
            const status = await ai.batches.get({ name: batchJob.name });
            console.log(`🔄 Poll #${pollCount}: Status is ${status.state}`);

            if (status.state === 'JOB_STATE_SUCCEEDED') {
                completed = true;
                await processResults(status, processingIds, jobRecord?.id);
            } else if (['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED'].includes(status.state)) {
                completed = true;
                console.error(`❌ Job ended with status: ${status.state}`);
                if (jobRecord) {
                    await supabase.from('batch_enrichment_jobs').update({ status: 'failed', error_message: status.state }).eq('id', jobRecord.id);
                }
            }
        } catch (error) {
            console.warn(`⚠️ Error polling status: ${error.message}`);
        }
    }
}

async function processResults(batchStatus, outfitIds, jobDbId) {
    console.log('📥 Downloading and processing results...');
    
    let responses = [];
    if (batchStatus.dest?.inlinedResponses) {
        responses = batchStatus.dest.inlinedResponses;
    } else if (batchStatus.dest?.fileName) {
        const fileContent = await ai.files.download({ file: batchStatus.dest.fileName });
        const jsonlString = new TextDecoder().decode(fileContent);
        responses = jsonlString.trim().split('\n').map(line => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        }).filter(Boolean);
    }

    let successCount = 0;
    for (let i = 0; i < responses.length; i++) {
        const resp = responses[i];
        const outfitId = outfitIds[i];
        const responseText = resp.response?.text || resp.response?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (responseText) {
            try {
                const enrichment = JSON.parse(responseText);
                
                // Basic validation
                if (!VALID_CATEGORY_VALUES.includes(enrichment.ui_category) || !VALID_OCCASION_VALUES.includes(enrichment.ui_occasion)) {
                    console.warn(`⚠️  Invalid tags for outfit ${outfitId}, skipping.`);
                    continue;
                }

                const { error: insertError } = await supabase.from('outfit_enrichment_drafts').insert({
                    outfit_id: outfitId,
                    batch_job_id: jobDbId,
                    suggested_name: enrichment.outfit_name,
                    suggested_category: enrichment.ui_category,
                    suggested_occasion: enrichment.ui_occasion,
                    analyzed_occasions: enrichment.analyzed_occasions,
                    components_list: enrichment.components_list,
                    enriched_fit: enrichment.fit,
                    enriched_feel: enrichment.feel,
                    enriched_word_association: Array.isArray(enrichment.word_association) ? enrichment.word_association.join(", ") : String(enrichment.word_association || ""),
                    enriched_vibes: enrichment.vibes,
                    enriched_description: enrichment.description_text,
                    search_summary: enrichment.search_summary,
                    model_name: MODEL_NAME,
                    model_version: MODEL_VERSION,
                    prompt_version: PROMPT_VERSION,
                    raw_response: enrichment
                });

                if (insertError) {
                    console.error(`❌ Failed to insert draft for ${outfitId}:`, insertError.message);
                } else {
                    successCount++;
                }
            } catch (e) {
                console.error(`❌ Failed to parse response for outfit ${outfitId}:`, e.message);
            }
        }
    }

    console.log(`✅ Successfully processed ${successCount} out of ${outfitIds.length} outfits.`);
    
    if (jobDbId) {
        await supabase.from('batch_enrichment_jobs').update({
            status: 'succeeded',
            processed_outfits: successCount,
            failed_outfits: outfitIds.length - successCount,
            completed_at: new Date().toISOString()
        }).eq('id', jobDbId);
    }
}

runBatchEnrichment().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
