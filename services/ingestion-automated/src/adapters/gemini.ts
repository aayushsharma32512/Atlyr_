import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index';
import { withRetry, isTransientUpstreamError, errorHttpStatus } from '../utils/retry';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'adapter:gemini' });

// ─── Client ──────────────────────────────────────────────────────────────────

let _client: GoogleGenerativeAI | undefined;

function getClient(): GoogleGenerativeAI {
  if (!config.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set');
  if (!_client) _client = new GoogleGenerativeAI(config.GOOGLE_API_KEY);
  return _client;
}

// ─── Prompts (ported verbatim from services/ingestion/src/config/ghostPrompts.ts) ─

export const GHOST_PROMPT_VERSION = 'v1.1';

type StagePrompt = { system: string; prompt: string };

const STAGE1_FRONT: Record<string, StagePrompt> = {
  topwear: {
    system: `You are an expert Technical Fashion Designer for a high-end e-commerce platform. Your sole purpose is to analyze visual inputs (flatlay and on-model imagery) of TOPWEAR garments and extract precise, objective technical specifications.

**Operational Rules:**
1.  **Objective Analysis:** You must suppress creative writing. Output only technical facts based strictly on the provided images. Do not hallucinate details that are not visible.
2.  **Exhaustive Check:** You must evaluate all 10 categories listed in the prompt for every item.
3.  **Handling Uncertainty:** If a detail is not clearly visible or inferable with high confidence, you must write 'unknown'.
4.  **Strict Formatting:** Your final output must contain [TECH_PACK], COLOR_AND_FABRIC, ITEM_NAME, and [GARMENT_PHYSICS] in that order, adhering strictly to the requested structure with no extra commentary.
5.  **Frontal Visual Bias:** When summarizing the item for the visual description, YOU MUST IGNORE back-of-garment and side of the garment details. Even if you know there is a back zipper or racerback or side zipper, do not mention it in the final visual summary. Focus exclusively on the front face of the garment.`,
    prompt: `**Input Visuals:** [Attached: Flatlay Image, Model Shot Image]

**Input Context:** The user is requesting a technical breakdown of the TOPWEAR garment shown in the attached images.

**Task Specification:**

Analyze the provided images to extract technical attributes for this TOPWEAR garment across the 10 categories below.

**Analysis Categories:**

1.  **Material Physics:** Fabric type/fiber, weight (light/medium/heavy), stretch/recovery, opacity, lining status.
2.  **Surface Micro-Texture:** Surface character (smooth, ribbed, etc.), sheen level, visible embellishments.
3.  **Neckline Construction:** Shape, collar type, depth/width, placket details, finishing details.
4.  **Closure:** Type, placement, visibility, fastener details (button count, zip style).
5.  **Sleeve:** Length, cut (set-in, raglan, etc.), volume, cuff style.
6.  **Hemline:** Length, shape, side details (vents/slits), tuck logic.
7.  **Fit Silhouette:** Overall shape (slim, relaxed, boxy, etc.), structure (flowy vs crisp), ease.
8.  **Color (Hex Codes):** Dominant body color, secondary/accent colors, hardware/trim color.
9.  **Pattern / Graphic Design:** Type, scale, density, directionality.
10. **Peculiar Notes:** Distinctive construction (cut-outs, wrap, twists) or functional features (pockets). If none, write 'none'.

11. **Gender:** Gender of the model wearing the garment.
**Required Output Format:**

[TECH_PACK]
Material_Physics: <single concise clause>
Surface_Micro_Texture: <single concise clause>
Neckline_Construction: <single concise clause>
Closure: <single concise clause>
Sleeve: <single concise clause>
Hemline: <single concise clause>
Fit_Silhouette: <single concise clause>
Color: <single concise clause with hex codes>
Pattern_Design: <single concise clause>
Peculiar_Notes: <single concise clause>

Gender: <single concise clause>
ITEM_NAME: <brand + merchandise name exactly as listed on the product page>

[GARMENT_PHYSICS]
<A single, dense paragraph of comma-separated clauses summarizing the item. **It must begin with the phrase: 'A direct front view of a...'** It must start with light interaction and fabric type (e.g., 'Matte heavyweight cotton jersey...'). It must implicitly cover all 10 categories above. No extra commentary.>

Product page URL for factual cross-checking: {PRODUCT_LINK}`,
  },

  bottomwear: {
    system: `You are an expert Technical Fashion Designer for a high-end e-commerce platform. Your sole purpose is to analyze visual inputs (flatlay and on-model imagery) of BOTTOMWEAR garments and extract precise, objective technical specifications.

**Operational Rules:**
1.  **Objective Analysis:** Output only technical facts based strictly on the provided images. Do not hallucinate. Focus intensely on visible textures, hardware stitching, and how gravity affects the garment's form on the model.
2.  **Exhaustive Check:** You must evaluate all 10 categories listed in the prompt for every item.
3.  **Handling Uncertainty:** If a detail is not clearly visible write 'unknown'.
4.  **Strict Formatting:** Your final output must be exactly two blocks: [TECH_PACK] followed by [GARMENT_PHYSICS], adhering strictly to the requested structure.
5.  **Frontal Visual Bias:** When summarizing the item for the visual description, YOU MUST IGNORE back-of-garment details. Even if you know there are back pockets, a rear yoke, or a back logo patch, do not mention them in the final visual summary. Focus exclusively on the front face of the garment.`,
    prompt: `**Input Visuals:** [Attached: Flatlay Image, Model Shot Image]

**Input Context:** The user is requesting a technical breakdown of the BOTTOMWEAR garment shown.

**Task Specification:**

Analyze the provided images to extract technical attributes across the categories below. Pay close attention to high-frequency details (like studs, complex patterns) and the volumetric shape.

**Analysis Categories (Bottomwear Specific):**

1.  **Material Physics:** Fabric type/fiber, weight (sheer, lightweight, midweight, heavyweight), stretch/recovery characteristics, opacity, lining status.
2.  **Surface Micro-Texture:** Surface character (e.g., brushed, crisp, slubby, pebbled leather, twill weave), visible weave density, sheen level (matte, satin, high-gloss).
3.  **Waistband & Rise Construction:** Rise level precisely observed on model (e.g., high-rise sitting above navel). Waistband style and closure visibility.
4.  **Closure Details:** Specific fly type and visibility/material of exterior hardware (buttons, zippers, hooks).
5.  **Leg/Skirt Shape & Drape Behavior:** The overall silhouette AND how the fabric falls. (e.g., 'Wide-leg pants that pool slightly at shoe', 'A-line skirt with stiff, structured flare', 'Skinny jeans with high tension at knee').
6.  **Hem Termination:** Exact cuff style, stitching details, or raw edge characteristics.
7.  **Fit Silhouette & Tension:** Ease through hip and thigh. Note where fabric lies flat vs. where it shows tension wrinkles or loose folds.
8.  **Color (Hex Codes):** Dominant body color, wash details (if denim), contrast stitching color, hardware color.
9.  **Pattern / Graphic Design:** Type, scale, density of print or woven pattern.
10. **Primary Embellishments & Pocketing:** First, list major surface applications (e.g., 'Allover high-density micro-studding', 'Large cargo pockets with straps'). Second, standard pocket layout and minor distressing.

**Required Output Format:**

[TECH_PACK]
Material_Physics: <single concise clause>
Surface_Micro_Texture: <single concise clause>
Neckline_Construction: <single concise clause>
Closure: <single concise clause>
Sleeve: <single concise clause>
Hemline: <single concise clause>
Fit_Silhouette: <single concise clause>
Color: <single concise clause with hex codes>
Pattern_Design: <single concise clause>
Peculiar_Notes: <single concise clause>

Gender: <single concise clause>
ITEM_NAME: <brand + merchandise name exactly as listed on the product page>

[GARMENT_PHYSICS]
<A single, dense, highly descriptive paragraph, start by mentioning that it is the front views. then with weight, texture, and color. Explicitly describe the fit, drape, and how gravity affects the shape. End with a detailed description of all hardware, embellishments, and unique pocketing clearly visible in the inputs. **CRITICAL:** Do NOT mention back pockets, rear labels, or rear yokes. Only describe what is visible from the front>
Product page URL: {PRODUCT_LINK}`,
  },

  dress: {
    system: `You are an expert Technical Fashion Designer for a high-end e-commerce platform. Your sole purpose is to analyze visual inputs (flatlay and on-model imagery) of DRESSES garments and extract precise, objective technical specifications.

**Operational Rules:**
1.  **Objective Analysis:** You must suppress creative writing. Output only technical facts based strictly on the provided images. Do not hallucinate details that are not visible.
2.  **Exhaustive Check:** You must evaluate all 11 categories listed in the prompt for every item.
3.  **Handling Uncertainty:** If a detail is not clearly visible or inferable with high confidence, you must write 'unknown'.
4.  **Strict Formatting:** Your final output must be exactly two blocks: [TECH_PACK] followed by [GARMENT_PHYSICS], adhering strictly to the requested structure. No conversational text before or after.`,
    prompt: `**Input Visuals:** [Attached: Flatlay Image, Model Shot Image]

**Input Context:** The user is requesting a technical breakdown of the DRESS garment shown in the attached images.

**Task Specification:**

Analyze the provided images to extract technical attributes for this DRESS garment across the categories below.

**Analysis Categories (Dress Specific):**

1.  **Material Physics:** Fabric type/fiber, weight (light/medium/heavy), stretch/recovery, opacity, lining status (skirt lined only/fully lined/unlined).
2.  **Surface Micro-Texture:** Surface character (smooth, ribbed, crinkled, pleated, etc.), sheen level, visible embellishments.
3.  **Neckline Construction:** Shape, collar type, depth/width, finishing details.
4.  **Closure:** Type, placement (critical for dresses: back zip, side zip, front buttons, pullover), visibility, fastener details.
5.  **Sleeve:** Length, cut, volume, cuff style. (Write 'sleeveless' if applicable).
6.  **Waistline Construction:** Defined waist seam, elasticized waist, drawstring waist, belted, or undefined (shift style).
7.  **Hemline (Length & Style):** Length class (mini, above-knee, knee-length, midi, maxi, floor-length), shape (straight, curved, high-low, asymmetrical), skirt details (tiered, ruffled, slit presence).
8.  **Fit Silhouette:** Overall shape name (A-line, Shift, Sheath, Bodycon, Fit-and-Flare, Slip, Wrap, Empire), structure (flowy vs structured), ease at hips.
9.  **Color (Hex Codes):** Dominant body color, accent colors, hardware/trim color.
10. **Pattern / Graphic Design:** Type, scale, density, directionality.
11. **Peculiar Notes:** Distinctive construction (cut-outs, twist details, layered effects) or functional features (pockets). If none, write 'none'.

**Required Output Format:**

[TECH_PACK]
Material_Physics: <single concise clause>
Surface_Micro_Texture: <single concise clause>
Neckline_Construction: <single concise clause>
Closure: <single concise clause>
Sleeve: <single concise clause>
Waistline_Construction: <single concise clause>
Hemline: <single concise clause>
Fit_Silhouette: <single concise clause>
Color: <single concise clause with hex codes>
Pattern_Design: <single concise clause>
Peculiar_Notes: <single concise clause>

ITEM_NAME: <brand + merchandise name exactly as listed on the product page>

[GARMENT_PHYSICS]
<A single, dense paragraph of comma-separated clauses summarizing the item. It must start with light interaction and fabric type (e.g., 'Satin sheen mid-weight polyester crepe...'). It must implicitly cover the categories above, including skirt length and silhouette. No extra commentary.>

Product page URL: {PRODUCT_LINK}`,
  },
};

// ─── Output types ─────────────────────────────────────────────────────────────

/**
 * Token counts returned by the Gemini API (`usageMetadata`). Persisted per call so spend can
 * be computed exactly rather than estimated — `thoughtsTokenCount` is billed as output, so
 * total_tokens (not prompt+candidates) is the figure to price against.
 */
export interface TokenUsage {
  prompt_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export function readUsage(meta: unknown): TokenUsage | null {
  const m = meta as Record<string, number> | undefined;
  if (!m || typeof m.totalTokenCount !== 'number') return null;
  const prompt = m.promptTokenCount ?? 0;
  return {
    prompt_tokens: prompt,
    output_tokens: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0),
    total_tokens: m.totalTokenCount,
  };
}

export interface GarmentSummary {
  tech_pack: string | null;
  garment_physics: string | null;
  item_name: string | null;
  color_and_fabric: string | null;
  complexity_level: 'simple' | 'complex';
  raw: string;
  model_used: string;
  usage: TokenUsage | null;
}

// ─── Parser (ported from nodes.ts parseStage1) ───────────────────────────────

function parseStage1(text: string): Omit<GarmentSummary, 'complexity_level' | 'model_used'> {
  const techLines: string[] = [];
  const garmentLines: string[] = [];
  let item_name: string | null = null;
  let color_and_fabric: string | null = null;
  let section: 'tech' | 'garment' | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const upper = line.toUpperCase();
    if (!line) continue;
    if (upper === '[TECH_PACK]') { section = 'tech'; continue; }
    if (upper === '[GARMENT_PHYSICS]') { section = 'garment'; continue; }
    if (line.startsWith('ITEM_NAME:')) {
      item_name = line.split(':', 2)[1]?.trim() ?? null;
      section = null; continue;
    }
    if (line.startsWith('COLOR_AND_FABRIC:')) {
      color_and_fabric = line.split(':', 2)[1]?.trim() ?? null;
      section = null; continue;
    }
    if (section === 'tech') techLines.push(rawLine);
    if (section === 'garment') garmentLines.push(rawLine);
  }

  const techBlock = techLines.join('\n').trim();
  const garmentBlock = garmentLines.join('\n').trim();

  return {
    tech_pack:        techBlock    ? `[TECH_PACK]\n${techBlock}`        : null,
    garment_physics:  garmentBlock ? `[GARMENT_PHYSICS]\n${garmentBlock}` : null,
    item_name,
    color_and_fabric,
    raw: text,
  };
}

// Derive complexity from the tech_pack content — complex if it has prints, embroidery, etc.
function deriveComplexity(parsed: ReturnType<typeof parseStage1>): 'simple' | 'complex' {
  const text = `${parsed.tech_pack ?? ''} ${parsed.garment_physics ?? ''}`.toLowerCase();
  const complexIndicators = [
    'embroidery', 'embroidered', 'print', 'printed', 'pattern', 'graphic',
    'sequin', 'sheer', 'lace', 'ruffle', 'pleat', 'tiered', 'multi-color',
    'patchwork', 'tie-dye', 'tiedye', 'jacquard', 'brocade', 'crochet', 'cut-out',
    'smocking', 'applique', 'beading', 'rhinestone', 'studded',
  ];
  return complexIndicators.some((kw) => text.includes(kw)) ? 'complex' : 'simple';
}

// ─── Main export ─────────────────────────────────────────────────────────────

function textModelCandidates(): string[] {
  const fallbacks = config.GEMINI_TEXT_MODEL_FALLBACKS.split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([config.GEMINI_TEXT_MODEL, ...fallbacks])];
}

export async function generateGarmentSummary(
  imageUrl: string,
  garmentCategory: 'topwear' | 'bottomwear' | 'dress',
  productUrl: string,
): Promise<GarmentSummary> {
  const promptBundle = STAGE1_FRONT[garmentCategory] ?? STAGE1_FRONT['topwear'];
  const promptText = promptBundle.prompt.replace('{PRODUCT_LINK}', productUrl);

  const client = getClient();
  const inlineImage = await withRetry(() => fetchImageAsInlineData(imageUrl), {
    retries: 3,
    backoffMs: 1000,
  });

  // A single Gemini model can be unavailable for hours (sustained 503 "high demand"),
  // so after per-model retries are exhausted we move down the fallback chain.
  const candidates = textModelCandidates();
  let lastErr: unknown;

  for (const modelName of candidates) {
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: promptBundle.system,
    });

    try {
      return await withRetry(async () => {
        const result = await model.generateContent([
          { text: promptText },
          { inlineData: inlineImage },
        ]);

        const text = result.response.text();
        const parsed = parseStage1(text);

        return {
          ...parsed,
          complexity_level: deriveComplexity(parsed),
          model_used: modelName,
          usage: readUsage(result.response.usageMetadata),
        };
      }, {
        retries: 4,
        backoffMs: 2000,
        maxBackoffMs: 30_000,
        shouldRetry: isTransientUpstreamError,
        onRetry: (err, attempt, delayMs) =>
          logger.warn({ model: modelName, attempt, delayMs, error: (err as Error).message }, 'garment summary call failed, retrying'),
      });
    } catch (err) {
      lastErr = err;
      const status = errorHttpStatus(err);
      // Overload or a missing/retired model id — the next candidate may still work.
      if (isTransientUpstreamError(err) || status === 404) {
        logger.warn({ model: modelName, status, error: (err as Error).message }, 'model unavailable, trying next fallback');
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`All Gemini text models failed: ${candidates.join(', ')}`);
}

async function fetchImageAsInlineData(url: string): Promise<{ mimeType: string; data: string }> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`Image fetch failed ${resp.status}: ${url}`);
  const contentType = resp.headers.get('content-type') ?? 'image/jpeg';
  const mimeType = contentType.split(';')[0]?.trim() ?? 'image/jpeg';
  const buf = await resp.arrayBuffer();
  return { mimeType, data: Buffer.from(buf).toString('base64') };
}

// ─── Enrichment (merchandising metadata) ─────────────────────────────────────
// Ported from services/ingestion/src/orchestration/nodes.ts `enrichNode` so the automated
// pipeline populates the same catalog columns (fit, feel, vibes, description_text, color_group,
// occasion, material_type, product_specifications, type_category) the old HITL pipeline did.

export const ENRICH_PROMPT_VERSION = 'v3';

const ENRICH_SYSTEM_INSTRUCTION = `You are an expert E-commerce Merchandiser and a Gen-Z Fashion Stylist. Your objective is to analyze product inputs and images to generate structured metadata and a stylist-written description.

1) VISUAL ANALYSIS LOGIC
- Source of Truth: Use provided text for Brand/Material. Use Images for Fit, Drapes, and Details. Cross check against text attributes available.
- Flatlay: Prioritize for color, fabric texture, construction details (buttons, stitching).
- Model Shot: Prioritize for fit, silhouette, and drape.

    "*2. PRODUCT NAMING RULES (Strict Adherence Required)*\n"
    "Generate a clean, SEO-friendly ⁠ enriched_product_name ⁠ using this formula: *[Key Feature/Silhouette] + [Fabric (optional)] + [Exact Product Type]*\n"
    "- *Length:* 3–5 words maximum.\n"
    "- *Format:* Title Case (Capitalize Each Word).\n"
    "- *Rules:*\n"
    "   1. *No Noise:* Remove '100%', 'Premium', 'Comfort', 'Limited Edition', 'Regular Fit', or marketing fluff.\n"
    "   2. *No Brands:* NEVER include the brand name (e.g., remove 'Nike', 'Zara').\n"
    "   3. *Specificity:* Use specific types (e.g., 'Derby Shoes' not 'Formal Shoes'; 'Polo Shirt' not 'T-Shirt').\n"
    "   4. *Visual Truth:* If text says 'Jeans' but image shows flared hem, name it 'Flared Denim Jeans'.\n"
    "   5. *Fabric:* Include fabric ONLY if distinct (e.g., 'Linen', 'Suede', 'Leather', 'Corduroy'). Skip generic 'Cotton' unless it's a key texture (e.g., 'Waffle Knit').\n"
    "   6. *Fallback:* If specific visual details (like silhouette or texture) are unclear in the image, simply OMIT that part of the name. Do NOT output 'INSUFFICIENT DATA'. Instead, generate a simpler name (e.g., if you can't see the fit, output 'Cotton T-Shirt' instead of 'Boxy Cotton T-Shirt').\n"
    "   Examples:\n"
    "   - '100% Cotton Regular Fit Polo' -> 'Textured Cotton Polo'\n"
    "   - 'Men's Formal Shoes' (Image: Open lacing) -> 'Leather Derby Shoes'\n"
    "   - 'Summer Dress' (Image: Satin, thin straps) -> 'Satin Slip Dress'\n\n"

3) STANDARDIZED VOCABULARY (Strictly select from these attributes)
FIT (Select 1-2 which are most appropriate based on the specific category):
- Tops: Fitted, Slim, Regular, Relaxed, Oversized, Boxy, Cropped, Longline, Peplum, Asymmetric, Dropped shoulder, Tunic.
- Bottoms: Skinny, Slim, Straight, Tapered, Regular, Relaxed, Wide-leg, Baggy, Bootcut, Flare, Cargo, High-rise, Mid-rise, Low-rise.
- Skirts: Mini, Midi, Maxi, A-Line, Pencil, Pleated, Bias-cut, Tiered, Wrap, Asymmetric.
- Dresses & Jumpsuits: Bodycon, A-Line, Shift, Wrap, Slip, Empire, Sheath, Fit & Flare, Smock, Shirt-style, T-Shirt style, Maxi, Midi, Mini, Strapless, Off-shoulder.
- Outerwear: Tailored, Regular, Relaxed, Oversized, Boxy, Cropped, Longline, Belted, Puffer, Cape-style.
- Activewear & Swimwear: Compression, Fitted, Regular, Relaxed, High-support, Low-support, High-leg, Racerback.
- Footwear: TTS, Wide-fit, Narrow-fit, Wide-calf, Narrow-calf, Roomy toe box, Snug toe box.

FEEL (Select 1-2 which are most appropriate based on category):
- Apparel: Soft, Buttery, Crisp, Suede, Structured, Flowing, Slinky, Stiff, Stretchy, Rigid, Lightweight, Heavyweight, Cozy, Plush, Brushed, Breathable, Technical, Sheer, Textured, Smooth, Ribbed, Satin, Metallic, Distressed, Vintage-wash, Dry-touch, Waffle, Airy, Thermal.
- Footwear & Accessories: Cushioned, Supportive, Rugged, Flexible, Sturdy, Lightweight, Airy, Plush, Polished, Matte, Glossy, Suede-touch, Grainy, Grippy, Chunky, Sleek, Moulded, Padded, Slouchy (bags), Structured (bags).

VIBES (Select 1-3 tags based on category; abstract associations only):
- Apparel: streetwear, old money, quiet luxury, athleisure, y2k, gorpcore, cottagecore, coquette (fem), clean girl, blokecore (masc), dark academia, light academia, grunge, punk, boho-chic, preppy, avant-garde, minimalist, maximalist, retro, vintage, utility, military, resortwear, festival, night luxe, date night, office siren, executive chic, loungewear, off-duty model, summer-ready, winter-layering, transitional, everyday basics, statement piece.
- Footwear: sneakerhead, hypebeast, skate culture, court classic, terrace culture, retro runner, dad-core, gorpcore, combat-ready, rugged utility, sartorial, boardroom, heritage, party-ready, poolside, beach-club, runway, minimalist, statement, futuristic, cozy-core.

4) DESCRIPTION WRITING GUIDELINES
Write a casual, conversational, Gen-Z friendly description.
Structure: Exactly 4 sentences. Each sentence must be separated by a newline character (\\n).
(Line 1) Mood hook.
(Line 2) Fit & silhouette details (mention fabric/cut).
(Line 3) Seasonality + Occasion.
(Line 4) Styling tip / Accessory pairing.

5) JSON OUTPUT FORMAT
Return strictly valid JSON with no markdown formatting. Output must be a JSON object that contains ALL of the keys below (do not omit keys). If a value cannot be inferred with high confidence, set it to null.
1. "type_category": string, lower case, max 2 words.
2. "color_group": string, lower case, max 2 words.
3. "fit": array of 1-2 strings, lower case (from the standardized fit list).
4. "feel": array of 1-2 strings, lower case (from the standardized feel list).
5. "vibes": array of 1-3 strings, lower case (from the standardized vibes list).
6. "occasion": string, lower case, max 2 words.
7. "care": string, lower case, max 2 words.
8. "material type": string, lower case, max 3 words.
9. "description_text": string, lower case, exactly 4 sentences separated by newline characters (\\n).
10. "product_specifications": object of string key-value pairs for visual features.
11. "product_name_suggestion": String) The 3-5 word clean display name (e.g., 'Flared Denim Jeans')`;

export interface EnrichmentContext {
  brand?: string | null;
  productName?: string | null;
  material?: string | null;
  color?: string | null;
  fit?: string | null;
  feel?: string | null;
  care?: string | null;
  description?: string | null;
}

export interface EnrichmentResult {
  type_category: string | null;
  color_group: string | null;
  fit: string | null;
  feel: string | null;
  vibes: string[] | null;
  occasion: string | null;
  care: string | null;
  material_type: string | null;
  description_text: string | null;
  product_specifications: Record<string, unknown> | null;
  product_name_suggestion: string | null;
  model_used: string;
  prompt_version: string;
  raw: string;
  usage: TokenUsage | null;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

// Same normalization the old enrichNode used: accept array or comma string, lowercase, dedupe, cap.
function normalizeTagList(value: unknown, maxItems: number): string[] | null {
  if (!value) return null;
  const items: string[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) if (typeof entry === 'string') items.push(entry);
  } else if (typeof value === 'string') {
    const raw = value.trim();
    if (raw) (raw.includes(',') ? raw.split(',') : [raw]).forEach((t) => items.push(t));
  }
  const deduped = Array.from(new Set(items.map((i) => i.trim().toLowerCase()).filter(Boolean)));
  if (!deduped.length) return null;
  return maxItems > 0 ? deduped.slice(0, maxItems) : deduped;
}

function stripJsonFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function mapEnrichment(json: Record<string, unknown>, modelUsed: string, raw: string, usage: TokenUsage | null): EnrichmentResult {
  const materialType =
    asStringOrNull((json as Record<string, unknown>)['material type']) ?? asStringOrNull(json.material_type);
  const specs = json.product_specifications;
  return {
    type_category:           asStringOrNull(json.type_category),
    color_group:             asStringOrNull(json.color_group),
    fit:                     normalizeTagList(json.fit, 2)?.join(', ') ?? null,
    feel:                    normalizeTagList(json.feel, 2)?.join(', ') ?? null,
    vibes:                   normalizeTagList(json.vibes, 3),
    occasion:                asStringOrNull(json.occasion),
    care:                    asStringOrNull(json.care),
    material_type:           materialType,
    description_text:        asStringOrNull(json.description_text),
    product_specifications:
      specs && typeof specs === 'object' && !Array.isArray(specs) ? (specs as Record<string, unknown>) : null,
    product_name_suggestion: asStringOrNull(json.product_name_suggestion),
    model_used:              modelUsed,
    prompt_version:          ENRICH_PROMPT_VERSION,
    raw,
    usage,
  };
}

/**
 * Multimodal merchandising enrichment for one product image + scraped context. Mirrors the old
 * HITL `enrichNode`: same system instruction, same JSON schema, same fallback-model chain.
 */
export async function generateEnrichment(
  imageUrl: string,
  ctx: EnrichmentContext,
): Promise<EnrichmentResult> {
  const client = getClient();
  const inlineImage = await withRetry(() => fetchImageAsInlineData(imageUrl), {
    retries: 3,
    backoffMs: 1000,
  });

  const sf = (v: unknown) => asStringOrNull(v) ?? 'N/A';
  const prompt = [
    'Perform a multimodal analysis of the attached images and the context below to generate the enriched merchandising JSON.',
    '',
    '**Input Product Context:**',
    '<product_context>',
    `Brand: ${sf(ctx.brand)}`,
    `Product Name: ${sf(ctx.productName)}`,
    `Material: ${sf(ctx.material)}`,
    `Color: ${sf(ctx.color)}`,
    `Fit: ${sf(ctx.fit)}`,
    `Feel: ${sf(ctx.feel)}`,
    `Care: ${sf(ctx.care)}`,
    `Product Description: ${sf(ctx.description)}`,
    '</product_context>',
    '',
    '**Instructions:**',
    "1. *NAMING:* Generate the 'enriched_product_name' first. Check the image to confirm the exact Product Type (e.g., Polo vs Tee) and Key Feature (e.g., Flared vs Straight). Apply the naming formula strictly.\n",
    "2. Treat the Product Context as factual unless explicitly marked 'N/A'.",
    '3. Use the flatlay image(s) to confirm construction, hardware, and fabric qualities.',
    '4. Use the model image(s), when present, to infer silhouette, drape, and on-body styling.',
    "5. Fill any 'N/A' inputs strictly from visual evidence. If the attribute cannot be inferred, return null.",
    '6. Produce JSON that matches the schema. Do not include any additional text or markdown formatting.',
  ].join('\n');

  const candidates = textModelCandidates();
  let lastErr: unknown;

  for (const modelName of candidates) {
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: ENRICH_SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json' },
    });

    try {
      return await withRetry(async () => {
        const result = await model.generateContent([
          { text: prompt },
          { inlineData: inlineImage },
        ]);
        const text = result.response.text();
        let json: unknown = JSON.parse(stripJsonFences(text));
        if (Array.isArray(json) && json.length > 0) json = json[0];
        if (!json || typeof json !== 'object') throw new Error('enrichment: non-object JSON response');
        return mapEnrichment(json as Record<string, unknown>, modelName, text, readUsage(result.response.usageMetadata));
      }, {
        retries: 4,
        backoffMs: 2000,
        maxBackoffMs: 30_000,
        shouldRetry: isTransientUpstreamError,
        onRetry: (err, attempt, delayMs) =>
          logger.warn({ model: modelName, attempt, delayMs, error: (err as Error).message }, 'enrichment call failed, retrying'),
      });
    } catch (err) {
      lastErr = err;
      const status = errorHttpStatus(err);
      if (isTransientUpstreamError(err) || status === 404) {
        logger.warn({ model: modelName, status, error: (err as Error).message }, 'model unavailable, trying next fallback');
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`All Gemini models failed for enrichment: ${candidates.join(', ')}`);
}
