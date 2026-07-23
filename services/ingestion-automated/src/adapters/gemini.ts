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

export interface GarmentSummary {
  tech_pack: string | null;
  garment_physics: string | null;
  item_name: string | null;
  color_and_fabric: string | null;
  complexity_level: 'simple' | 'complex';
  raw: string;
  model_used: string;
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
