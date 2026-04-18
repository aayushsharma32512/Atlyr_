import type { RunnableConfig } from '@langchain/core/runnables';
import { interrupt } from '@langchain/langgraph';
import { createLogger } from '../utils/logger';
import { fetchWithFirecrawl } from '../adapters/crawler/firecrawl';
import { config } from '../config/index';
import { buildFirecrawlScrapePlan } from '../sites/firecrawlPlan';
import { uploadArtifact, getArtifactJson, uploadRawImage, downloadStorageFile, uploadGhostStagingImage } from '../adapters/storage/supabase-storage';
import { CrawlPayload, ExtractPayload, DownloadPayload, type DownloadedImageMetaT } from '../domain/contracts';
import type { ExtractPayloadT } from '../domain/contracts';
import { persistFirecrawlArtifacts } from '../utils/firecrawlArtifacts';
import type { PauseResumeSignal, PipelineState } from '../domain/state';
import { persistStatePatch, readState } from '../domain/state-store';
import { mergePipelineState } from '../domain/merge-pipeline-state';
import { buildExtractDraft } from './extract-draft';
import axios, { type AxiosResponse } from 'axios';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { generateGeminiJson, generateGeminiText } from '../adapters/llm/gemini';
import { generateGeminiImage } from '../adapters/llm/gemini-image';
import { supabaseAdmin } from '../db/supabase';
import { createLimiter } from '../utils/semaphore';
import { CATEGORY_PROMPTS, GHOST_PROMPT_VERSION, MANNEQUIN_ASSETS } from '../config/ghostPrompts';

const logger = createLogger({ stage: 'graph-nodes' });
const firecrawlLimiter = createLimiter(config.FIRECRAWL_MAX_CONCURRENCY);

const ENRICH_PROMPT_VERSION = 'v3';

type StringMap = Record<string, unknown>;
type GarmentSummaryRun = {
  view: 'front' | 'back';
  provider: 'gemini';
  model: string;
  createdAt: string;
  promptVersion?: string;
};

type EnrichRun = {
  provider: 'gemini';
  model: string;
  createdAt: string;
  promptVersion?: string;
};

type GhostImageEntry = {
  view: 'front' | 'back';
  storagePath: string;
  provider: 'imagen-2.5' | 'gemini';
  model: string;
  createdAt: string;
  seed?: number;
  aspectRatio?: string;
  avatarAssetPath?: string;
  promptVersion?: string;
};

const GARMENT_SUMMARY_SYSTEM_INSTRUCTION = `You are an expert apparel copywriter. Given product context and an image, respond with a JSON object containing the following keys: \n- "headline": concise front-facing title (string)\n- "bullets": array of 3-5 short selling points tailored to the provided view\n- "fabric_care": single sentence focusing on fabric or care insights (string).\nOutput strictly valid JSON with those keys and do not include any additional commentary.`;

const ENRICH_SYSTEM_INSTRUCTION = `You are an expert E-commerce Merchandiser and a Gen-Z Fashion Stylist. Your objective is to analyze product inputs and images to generate structured metadata and a stylist-written description.

1) VISUAL ANALYSIS LOGIC
- Source of Truth: Use provided text for Brand/Material. Use Images for Fit, Drapes, and Details. Cross check against text attributes available.
- Flatlay: Prioritize for color, fabric texture, construction details (buttons, stitching).
- Model Shot: Prioritize for fit, silhouette, and drape.

    "*2. PRODUCT NAMING RULES (Strict Adherence Required)*\n"
    "Generate a clean, SEO-friendly ⁠ enriched_product_name ⁠ using this formula: *[Key Feature/Silhouette] + [Fabric (optional)] + [Exact Product Type]*\n"
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

const GHOST_PROMPT_TEMPLATE = `Create a photorealistic ghost mannequin render for the {VIEW} view of the garment described below. Preserve realistic lighting, fabric drape, and the garment's true colors. The mannequin should not show a face and should be centered on a neutral background.`;

type ValidationMessage = {
  code: string;
  message: string;
  severity: 'error' | 'warning';
};

const PRODUCT_VALIDATION_RULES: Array<(state: PipelineState) => ValidationMessage | null> = [
  (state) => {
    const product = state.draft?.product as Record<string, unknown> | undefined;
    const brand = asString(product?.brand);
    if (!brand) {
      return { code: 'missing_brand', message: 'Brand is required before staging.', severity: 'error' };
    }
    return null;
  },
  (state) => {
    const product = state.draft?.product as Record<string, unknown> | undefined;
    const productName = asString(product?.product_name);
    if (!productName) {
      return { code: 'missing_product_name', message: 'Product name must be set.', severity: 'error' };
    }
    return null;
  },
  (state) => {
    const product = state.draft?.product as Record<string, unknown> | undefined;
    const productUrl = asString(product?.product_url);
    if (!productUrl) {
      return { code: 'missing_product_url', message: 'Product URL is required for promotion.', severity: 'error' };
    }
    return null;
  },
  (state) => {
    const product = state.draft?.product as Record<string, unknown> | undefined;
    const priceMinor = product?.price_minor;
    const price = product?.price;
    const priceValue = typeof priceMinor === 'number' ? priceMinor : typeof price === 'number' ? Math.round(price * 100) : null;
    if (priceValue == null || priceValue <= 0) {
      return { code: 'invalid_price', message: 'Price must be set and greater than zero.', severity: 'error' };
    }
    return null;
  },
  (state) => {
    const product = state.draft?.product as Record<string, unknown> | undefined;
    const type = asString(product?.type);
    if (!type) {
      return { code: 'missing_type', message: 'Product type is required.', severity: 'error' };
    }
    return null;
  },
  (state) => {
    const images = Array.isArray(state.draft?.images) ? (state.draft?.images as Array<Record<string, unknown>>) : [];
    if (!images.length) {
      const ghostViews = Array.isArray(state.artifacts?.ghostImages) ? (state.artifacts?.ghostImages as Array<Record<string, unknown>>) : [];
      if (!ghostViews.length) {
        return { code: 'missing_images', message: 'At least one product image is required.', severity: 'error' };
      }
    }
    const primaryCount = images.filter((img) => Boolean(img.is_primary)).length;
    if (primaryCount !== 1) {
      const ghostViews = Array.isArray(state.artifacts?.ghostImages) ? (state.artifacts?.ghostImages as Array<Record<string, unknown>>) : [];
      const hasGhostFront = ghostViews.some((entry) => entry.view === 'front');
      if (!(primaryCount === 0 && hasGhostFront)) {
        return { code: 'invalid_primary_image', message: 'Exactly one primary image must be selected.', severity: 'error' };
      }
    }
    return null;
  },
  (state) => {
    const product = state.draft?.product as Record<string, unknown> | undefined;
    const imageUrl = asString(product?.image_url);
    if (!imageUrl) {
      return { code: 'missing_primary_image_url', message: 'Primary image URL must be present on the product.', severity: 'error' };
    }
    return null;
  },
  (state) => {
    const product = state.draft?.product as Record<string, unknown> | undefined;
    const placementX = typeof product?.placement_x === 'number' ? product.placement_x : null;
    const placementY = typeof product?.placement_y === 'number' ? product.placement_y : null;
    const imageLength = typeof product?.image_length === 'number' ? product.image_length : null;
    if (placementX == null || placementY == null || imageLength == null) {
      return {
        code: 'missing_placement_data',
        message: 'placement_x, placement_y, and image_length must be set before staging.',
        severity: 'error'
      };
    }
    return null;
  },
  (state) => {
    const product = state.draft?.product as Record<string, unknown> | undefined;
    const visible = Array.isArray(product?.body_parts_visible)
      ? (product?.body_parts_visible as unknown[]).filter((entry) => typeof entry === 'string')
      : [];
    if (!visible.length) {
      return {
        code: 'missing_body_parts_visible',
        message: 'body_parts_visible must be set for mannequin masking.',
        severity: 'error'
      };
    }
    return null;
  }
];

function hasCoreIdentifiers(state: PipelineState | undefined): state is PipelineState & {
  jobId: string;
  originalUrl: string;
  domain: string;
  dedupeKey: string;
} {
  return Boolean(state?.jobId && state?.originalUrl && state?.domain && state?.dedupeKey);
}

function readProduct(state: PipelineState): Record<string, unknown> {
  return (state.draft?.product as Record<string, unknown> | undefined) ?? {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const strings = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : undefined))
      .filter((entry): entry is string => Boolean(entry));
    return strings.length ? strings : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return undefined;
}

const BODY_SEGMENT_SET = new Set(['head', 'neck', 'torso', 'arm_left', 'arm_right', 'legs', 'feet']);
const BODY_SEGMENT_ALIASES: Record<string, string[]> = {
  arms: ['arm_left', 'arm_right'],
  arm: ['arm_left', 'arm_right']
};

function normalizeGender(value: unknown): 'male' | 'female' | 'unisex' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (['male', 'man', 'mens'].includes(normalized)) return 'male';
  if (['female', 'woman', 'womens'].includes(normalized)) return 'female';
  if (['unisex', 'all', 'any'].includes(normalized)) return 'unisex';
  return null;
}

function normalizeBodyPartsVisible(value: unknown): string[] | null {
  const list = asStringList(value);
  if (!list) return null;

  const normalized = list
    .map((entry) => entry.toLowerCase().replace(/[\s-]+/g, '_'))
    .flatMap((entry) => BODY_SEGMENT_ALIASES[entry] ?? [entry])
    .filter((entry) => BODY_SEGMENT_SET.has(entry));

  const deduped = Array.from(new Set(normalized));
  return deduped.length ? deduped : null;
}

function collectRawImages(state: PipelineState): DownloadedImageMetaT[] {
  return Array.isArray(state.artifacts?.rawImages) ? (state.artifacts?.rawImages as DownloadedImageMetaT[]) : [];
}

function findRawImagesByPredicate(state: PipelineState, predicate: (image: DownloadedImageMetaT) => boolean): DownloadedImageMetaT[] {
  return collectRawImages(state).filter(predicate);
}

function isGhostBackEnabledForJob(state: PipelineState): boolean {
  return Boolean(state.artifacts?.capabilities?.ghostBackEnabled);
}

function updateMetadataArray<T>(existing: T[] | undefined, entries: T[], identity: (item: T) => string): T[] {
  const map = new Map<string, T>();
  existing?.forEach((item) => {
    map.set(identity(item), item);
  });
  entries.forEach((item) => {
    map.set(identity(item), item);
  });
  return Array.from(map.values());
}

function upsertInArray<T>(existing: T[] | undefined, predicate: (item: T) => boolean, create: () => T, update: (current: T) => T): T[] {
  const list = existing ? [...existing] : [];
  const index = list.findIndex(predicate);
  if (index === -1) {
    list.push(create());
  } else {
    list[index] = update(list[index]);
  }
  return list;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function resolveImageBuffer(storagePath: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const { buffer, contentType } = await downloadStorageFile(storagePath);
  const mimeType = contentType ?? 'image/jpeg';
  return { buffer, mimeType };
}

export async function submitNode(state: PipelineState | undefined, config?: RunnableConfig): Promise<Partial<PipelineState>> {
  if (hasCoreIdentifiers(state)) {
    return {
      jobId: state.jobId,
      originalUrl: state.originalUrl,
      domain: state.domain,
      dedupeKey: state.dedupeKey,
      step: state.step ?? 'submit'
    };
  }

  const threadId = config?.configurable?.thread_id;
  if (!threadId) {
    logger.warn({}, 'submitNode missing thread_id; returning empty patch');
    return {};
  }

  const persisted = await readState(threadId);
  if (!persisted || !hasCoreIdentifiers(persisted)) {
    logger.warn({ threadId }, 'submitNode could not hydrate state from storage');
    return persisted ?? {};
  }

  return {
    jobId: persisted.jobId,
    originalUrl: persisted.originalUrl,
    domain: persisted.domain,
    dedupeKey: persisted.dedupeKey,
    artifacts: persisted.artifacts,
    flags: persisted.flags,
    draft: persisted.draft,
    processed: persisted.processed,
    review: persisted.review,
    errors: persisted.errors,
    productId: persisted.productId,
    timestamps: persisted.timestamps,
    step: persisted.step ?? 'submit'
  };
}

export async function crawlNode(state: PipelineState): Promise<Partial<PipelineState>> {
  logger.info({ jobId: state.jobId, originalUrl: state.originalUrl }, 'crawlNode received state');
  const { jobId, originalUrl, dedupeKey, domain } = state;

  if (!config.FIRECRAWL_API_KEY) {
    logger.error({ jobId }, 'FIRECRAWL_API_KEY missing');
    throw new Error('missing-firecrawl-api-key');
  }

  const crawlPayload = CrawlPayload.parse({
    jobId,
    originalUrl,
    domain,
    dedupeKey,
    strategy: 'firecrawl',
    robotsChecked: true
  });

  const plan = buildFirecrawlScrapePlan(crawlPayload.originalUrl);

  // Directly transform nishorama URLs: www.nishorama.com → row.nishorama.com
  let scrapeUrl = crawlPayload.originalUrl;
  try {
    const urlParsed = new URL(crawlPayload.originalUrl);
    const host = urlParsed.hostname.toLowerCase();
    if (host === 'www.nishorama.com' || host === 'nishorama.com') {
      urlParsed.hostname = 'row.nishorama.com';
      scrapeUrl = urlParsed.toString();
      logger.info({ jobId, originalUrl, scrapeUrl }, 'Transformed nishorama URL');
    }
  } catch {
    // Keep original URL on parse error
  }

  const result = await firecrawlLimiter(() => fetchWithFirecrawl(scrapeUrl, config.FIRECRAWL_API_KEY, {
    scrape: {
      prompt: plan.prompt,
      includeHtml: plan.includeHtml,
      includeRawHtml: plan.includeRawHtml,
      fullPage: plan.fullPage,
      actions: plan.actions,
      postProcess: plan.postProcess
    }
  }));

  const artifactRefs = await persistFirecrawlArtifacts({ jobId, mode: config.FIRECRAWL_MODE, result });

  return {
    artifacts: {
      ...state.artifacts,
      ...artifactRefs,
      imageUrls: Array.from(new Set(result.imageUrls ?? [])),
      crawlMeta: {
        ...(result.metadata && Object.keys(result.metadata).length > 0 ? result.metadata : {}),
        siteProfileId: plan.profileId,
        siteProfileVersion: plan.profileVersion
      }
    },
    originalUrl: result.finalUrl ?? state.originalUrl,
    step: 'crawl'
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function extractNode(state: PipelineState): Promise<Partial<PipelineState>> {
  const { jobId, originalUrl, dedupeKey, domain, artifacts } = state;
  const payload = ExtractPayload.parse({
    jobId,
    originalUrl,
    domain,
    dedupeKey,
    artifactRefs: {
      htmlPath: artifacts?.htmlPath,
      rawHtmlPath: artifacts?.rawHtmlPath,
      jsonPath: artifacts?.jsonPath,
      jsonldPath: artifacts?.jsonldPath,
      metaPath: artifacts?.metaPath,
      extractPath: artifacts?.extractPath
    }
  });

  if (!payload.artifactRefs.jsonPath && !payload.artifactRefs.extractPath) {
    throw new Error('missing-json-artifact');
  }

  let jsonDoc: Record<string, unknown> = {};
  const primaryJsonPath = payload.artifactRefs.jsonPath ?? payload.artifactRefs.extractPath;
  if (primaryJsonPath) {
    jsonDoc = toRecord(await getArtifactJson(primaryJsonPath));
  }

  let metaDoc: Record<string, unknown> = {};
  if (payload.artifactRefs.metaPath) {
    metaDoc = toRecord(await getArtifactJson(payload.artifactRefs.metaPath));
  }

  const extractDraftArtifact = await getOrCreateExtractDraftArtifact({ jobId, dedupeKey, originalUrl, artifactRefs: payload.artifactRefs, jsonDoc, metaDoc });

  return extractDraftArtifact;
}

async function getOrCreateExtractDraftArtifact(params: { jobId: string; dedupeKey: string; originalUrl: string; artifactRefs: ExtractPayloadT['artifactRefs']; jsonDoc: Record<string, unknown>; metaDoc: Record<string, unknown> }) {
  const { jobId, dedupeKey, originalUrl, artifactRefs, jsonDoc, metaDoc } = params;
  const draft = buildExtractDraft({ dedupeKey, originalUrl, jsonDoc, metaDoc });

  const outputArtifactName = `${jobId}.extracted.json`;
  let extractedPath = artifactRefs?.extractPath;
  if (!extractedPath) {
    extractedPath = await uploadArtifact(jobId, outputArtifactName, JSON.stringify(draft, null, 2), 'application/json');
  }

  const statePatch: Partial<PipelineState> = {
    jobId,
    originalUrl,
    dedupeKey,
    artifacts: {
      ...artifactRefs,
      extractPath: extractedPath,
      draftImages: draft.draft_images
    },
    draft: {
      product: draft.draft_product,
      images: draft.draft_images,
      validations: draft.validations
    },
    step: 'extract'
  };

  await persistStatePatch(jobId, statePatch);

  return statePatch;
}

export async function downloadNode(state: PipelineState): Promise<Partial<PipelineState>> {
  const { jobId, originalUrl, dedupeKey, domain, artifacts } = state;

  if (!artifacts?.extractPath) {
    return {
      artifacts: {
        ...(state.artifacts ?? {}),
        draftImages: [],
        rawImages: []
      },
      flags: {
        ...(state.flags ?? {}),
        downloadReady: true
      },
      step: 'download'
    };
  }

  const payload = DownloadPayload.parse({
    jobId,
    originalUrl,
    dedupeKey,
    domain,
    artifactRefs: { extractedPath: artifacts.extractPath },
    retryUrls: []
  });

  const extract = await getArtifactJson(payload.artifactRefs.extractedPath);
  const draftImages = Array.isArray(extract?.draft_images) ? extract.draft_images : [];

  const workItems = dedupeDraftImages(draftImages as DraftImageInput[]);
  const existingState = await readState(jobId);
  const already = new Map<string, DownloadedImageMetaT>((existingState?.artifacts?.rawImages ?? []).map((img) => [img.originalUrl, img]));

  const results: DownloadedImageMetaT[] = [];
  const validations: Array<{ code: string; message: string }> = [];

  for (const item of workItems) {
    const existing = already.get(item.url);
    if (existing) {
      const existingAny = existing as Record<string, unknown>;
      results.push({
        ...existing,
        productView: normalizeProductView(existing.productView ?? existingAny.product_view),
        ghostEligible: typeof existingAny.ghostEligible === 'boolean' ? (existingAny.ghostEligible as boolean) : false,
        summaryEligible: typeof existingAny.summaryEligible === 'boolean' ? (existingAny.summaryEligible as boolean) : false
      });
      continue;
    }

    try {
      const { buffer, contentType } = await downloadImageBuffer(item.url);
      const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const hash = crypto.createHash('sha256').update(view).digest('hex');
      const storagePath = await uploadRawImage(jobId, hash, buffer, contentType);
      const { width, height } = await inferDimensions(buffer);

      results.push({
        originalUrl: item.url,
        storagePath,
        hash,
        sizeBytes: buffer.length,
        contentType,
        width,
        height,
        sortOrder: item.sort_order,
        isPrimarySuggestion: item.is_primary,
        kindHint: item.kind ?? null,
        genderHint: item.gender ?? null,
        vtoEligibleHint: item.vto_eligible,
        productId: item.product_id ?? dedupeKey,
        downloadedAt: new Date().toISOString(),
        productView: item.product_view ?? null,
        ghostEligible: item.ghost_eligible,
        summaryEligible: item.summary_eligible
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      validations.push({
        code: 'download_failed',
        message: `Failed to download ${item.url}: ${message}`
      });
    }
  }

  return {
    artifacts: {
      ...(state.artifacts ?? {}),
      draftImages,
      rawImages: results
    },
    flags: {
      ...(state.flags ?? {}),
      downloadReady: true
    },
    step: 'download',
    draft: validations.length
      ? {
        ...(state.draft ?? {}),
        validations: [...(state.draft?.validations ?? []), ...validations]
      }
      : state.draft
  };
}

export async function garmentSummaryNode(state: PipelineState): Promise<Partial<PipelineState>> {
  if (!hasCoreIdentifiers(state)) return {};
  if (state.flags?.garmentSummaryReady && state.step !== 'hitl_phase2_rerun') {
    logger.info({ jobId: state.jobId }, 'garmentSummaryNode: already ready, skipping');
    return { step: 'garment_summary' };
  }

  const product = readProduct(state);
  const rawImages = collectRawImages(state);
  const ghostBackEnabled = isGhostBackEnabledForJob(state);

  const categoryRaw = asString((product as Record<string, unknown>).category_ghost) ?? asString(product.type_category) ?? asString(product.type);
  const normalizedCategory = (categoryRaw ?? '').toLowerCase();
  const category: 'topwear' | 'bottomwear' | 'footwear' | 'dresses' =
    (['topwear', 'bottomwear', 'footwear', 'dresses'] as const).includes(normalizedCategory as any)
      ? (normalizedCategory as 'topwear' | 'bottomwear' | 'footwear' | 'dresses')
      : 'topwear';
  const prompts = CATEGORY_PROMPTS[category];
  if (!prompts) {
    logger.warn({ jobId: state.jobId, category }, 'garmentSummaryNode: unsupported category, skipping');
    return { step: 'garment_summary' };
  }

  const productUrl = asString(product.product_url) ?? state.originalUrl ?? '';
  const summaryImages = rawImages
    .filter((img) =>
      Boolean(img.summaryEligible) &&
      (img.productView === 'front' || (ghostBackEnabled && img.productView === 'back'))
    )
    .map((img) => {
      const kind = typeof img.kindHint === 'string' ? img.kindHint.toLowerCase() : '';
      const kindOrder = kind === 'flatlay' ? 0 : kind === 'model' ? 1 : 2;
      return { ...img, kindOrder };
    });
  if (!summaryImages.length) {
    logger.warn({ jobId: state.jobId }, 'garmentSummaryNode: no summary eligible images');
    return { step: 'garment_summary' };
  }

  const now = nowIso();
  const runEntries: GarmentSummaryRun[] = [];
  const summaryPayloads: Array<{
    view: 'front' | 'back';
    model: string;
    promptVersion?: string;
    createdAt: string;
    tech_pack?: string;
    garment_physics?: string;
    shoe_physics?: string;
    item_name?: string;
    color_and_fabric?: string;
    geometry_skeleton?: string;
    raw?: string;
  }> = [];
  const productSummary: Record<string, unknown> = {};

  const parseStage1 = (text: string) => {
    const result: {
      tech_pack?: string;
      garment_physics?: string;
      shoe_physics?: string;
      item_name?: string;
      color_and_fabric?: string;
      geometry_skeleton?: string;
    } = {};
    const techLines: string[] = [];
    const garmentLines: string[] = [];
    const shoeLines: string[] = [];
    let section: 'tech' | 'garment' | 'shoe' | 'geometry' | null = null;
    const geometryLines: string[] = [];

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      const upper = line.toUpperCase();
      if (!line) continue;
      if (upper === '[TECH_PACK]') {
        section = 'tech';
        continue;
      }
      if (upper === '[GARMENT_PHYSICS]') {
        section = 'garment';
        continue;
      }
      if (upper === '[GEOMETRY_SKELETON]') {
        section = 'geometry';
        continue;
      }
      if (upper === '[SHOE_PHYSICS]') {
        section = 'shoe';
        continue;
      }
      if (line.startsWith('ITEM_NAME:')) {
        result.item_name = line.split(':', 2)[1]?.trim() ?? '';
        section = null;
        continue;
      }
      if (line.startsWith('COLOR_AND_FABRIC:')) {
        result.color_and_fabric = line.split(':', 2)[1]?.trim() ?? '';
        section = null;
        continue;
      }
      if (section === 'tech') techLines.push(rawLine);
      if (section === 'garment') garmentLines.push(rawLine);
      if (section === 'shoe') shoeLines.push(rawLine);
      if (section === 'geometry') geometryLines.push(rawLine);
    }

    if (techLines.length) {
      const textBlock = techLines.join('\n').trim();
      result.tech_pack = textBlock ? `[TECH_PACK]\n${textBlock}` : undefined;
    }
    if (garmentLines.length) {
      const textBlock = garmentLines.join('\n').trim();
      result.garment_physics = textBlock ? `[GARMENT_PHYSICS]\n${textBlock}` : undefined;
    }
    if (shoeLines.length) {
      const textBlock = shoeLines.join('\n').trim();
      result.shoe_physics = textBlock ? `[SHOE_PHYSICS]\n${textBlock}` : undefined;
    }
    if (geometryLines.length) {
      const textBlock = geometryLines.join('\n').trim();
      result.geometry_skeleton = textBlock ? `[GEOMETRY_SKELETON]\n${textBlock}` : undefined;
    }
    return result;
  };

  const summaryViews = (ghostBackEnabled ? (['front', 'back'] as const) : (['front'] as const));
  for (const view of summaryViews) {
    const imagesForView = summaryImages.filter((img) => img.productView === view);
    if (!imagesForView.length) continue;

    const viewPrompts = prompts.stage1[view];
    if (!viewPrompts) {
      logger.warn({ jobId: state.jobId, category, view }, 'garmentSummaryNode: missing prompts for view');
      continue;
    }

    const sortedImages = imagesForView.sort((a, b) => (a.kindOrder ?? 2) - (b.kindOrder ?? 2));
    const inlineImages: Array<{ data: Buffer; mimeType?: string; altText: string }> = [];
    for (const image of sortedImages) {
      if (!image.storagePath) {
        logger.warn({ jobId: state.jobId, url: image.originalUrl }, 'garmentSummaryNode: missing storage path');
        continue;
      }
      const { buffer, mimeType } = await resolveImageBuffer(image.storagePath);
      inlineImages.push({
        data: buffer,
        mimeType,
        altText: `Summary reference ${view}`
      });
    }

    if (!inlineImages.length) continue;

    const promptText = viewPrompts.prompt.replace('{PRODUCT_LINK}', productUrl);
    logger.info({ jobId: state.jobId, category, view }, 'garmentSummaryNode: using category prompts');
    try {
      const response = await generateGeminiText({
        prompt: promptText,
        systemInstruction: viewPrompts.system,
        images: inlineImages,
        model: config.GEMINI_TEXT_MODEL
      });
      const parsed = parseStage1(response.text);
      const summaryObject = {
        tech_pack: parsed.tech_pack ?? null,
        garment_physics: parsed.garment_physics ?? parsed.shoe_physics ?? null,
        shoe_physics: parsed.shoe_physics ?? null,
        item_name: parsed.item_name ?? null,
        color_and_fabric: parsed.color_and_fabric ?? null,
        geometry_skeleton: parsed.geometry_skeleton ?? null,
        raw: response.text
      };
      const key = view === 'front' ? 'garment_summary_front' : 'garment_summary_back';
      productSummary[key] = summaryObject;
      productSummary['garment_summary_version'] = GHOST_PROMPT_VERSION;
      summaryPayloads.push({
        view,
        model: response.model,
        promptVersion: GHOST_PROMPT_VERSION,
        createdAt: now,
        tech_pack: parsed.tech_pack,
        garment_physics: parsed.garment_physics,
        shoe_physics: parsed.shoe_physics,
        item_name: parsed.item_name,
        color_and_fabric: parsed.color_and_fabric,
        geometry_skeleton: parsed.geometry_skeleton,
        raw: response.text
      });
      runEntries.push({
        view,
        provider: 'gemini',
        model: response.model,
        createdAt: now,
        promptVersion: GHOST_PROMPT_VERSION
      });
    } catch (error) {
      logger.error({ jobId: state.jobId, view, error: (error as Error)?.message }, 'garmentSummaryNode: generation failed');
    }
  }

  if (!Object.keys(productSummary).length) {
    return { step: 'garment_summary' };
  }

  const patch: Partial<PipelineState> = {
    draft: {
      product: productSummary
    },
    artifacts: {
      garmentSummaryRuns: updateMetadataArray(state.artifacts?.garmentSummaryRuns as GarmentSummaryRun[] | undefined, runEntries, (entry) => `${entry.view}-${entry.createdAt}`),
      garmentSummaryPayloads: updateMetadataArray(state.artifacts?.garmentSummaryPayloads as typeof summaryPayloads | undefined, summaryPayloads, (entry) => `${entry.view}-${entry.createdAt}`)
    },
    flags: {
      ...(state.flags ?? {}),
      garmentSummaryReady: true
    },
    step: 'garment_summary'
  };

  await persistStatePatch(state.jobId, { jobId: state.jobId, ...patch });

  return patch;
}

type EnrichResponse = {
  fit?: string[] | string;
  feel?: string[] | string;
  vibes?: string[] | string;
  description_text?: string;
  type_category?: string;
  color_group?: string;
  occasion?: string;
  // Gemini key is specified as "material type" in the schema; accept both.
  material_type?: string;
  product_specifications?: Record<string, unknown>;
  care?: string;
  product_name_suggestion?: string;
};

function normalizeTagList(value: unknown, maxItems: number): string[] | undefined {
  if (!value) return undefined;
  const items: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (typeof entry === 'string') items.push(entry);
    });
  } else if (typeof value === 'string') {
    const raw = value.trim();
    if (raw) {
      if (raw.includes(',')) {
        raw.split(',').forEach((token) => items.push(token));
      } else {
        items.push(raw);
      }
    }
  }
  const normalized = items
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const deduped = Array.from(new Set(normalized));
  if (!deduped.length) return undefined;
  return typeof maxItems === 'number' && maxItems > 0 ? deduped.slice(0, maxItems) : deduped;
}

function normalizeSpecifications(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export async function enrichNode(state: PipelineState): Promise<Partial<PipelineState>> {
  if (!hasCoreIdentifiers(state)) return {};
  if (state.flags?.enrichReady && state.step !== 'hitl_phase2_rerun') {
    logger.info({ jobId: state.jobId }, 'enrichNode: already ready, skipping');
    return { step: 'enrich' };
  }

  const product = readProduct(state);
  const rawImages = collectRawImages(state);
  const eligibleImages = rawImages.filter((img) => Boolean(img.summaryEligible));
  if (!eligibleImages.length) {
    logger.warn({ jobId: state.jobId }, 'enrichNode: no summary eligible images found');
    return {};
  }

  const imageParts = await Promise.all(
    eligibleImages.map(async (img) => {
      if (!img.storagePath) {
        throw new Error(`enrich-node-missing-storage-path:${img.originalUrl}`);
      }
      const { buffer, mimeType } = await resolveImageBuffer(img.storagePath);
      const view = img.productView ?? 'unknown';
      return {
        data: buffer,
        mimeType,
        altText: `Product view ${view}`
      };
    })
  );

  const sanitizeField = (value: unknown) => asString(value) ?? 'N/A';

  const prompt = [
    'Perform a multimodal analysis of the attached images and the context below to generate the enriched merchandising JSON.',
    '',
    '**Input Product Context:**',
    '<product_context>',
    `Brand: ${sanitizeField(product.brand)}`,
    `Product Name: ${sanitizeField(product.product_name ?? (product as Record<string, unknown>).name)}`,
    `Material: ${sanitizeField(product.material)}`,
    `Color: ${sanitizeField(product.color)}`,
    `Fit: ${sanitizeField(product.fit)}`,
    `Feel: ${sanitizeField(product.feel)}`,
    `Care: ${sanitizeField(product.care)}`,
    `Product Description: ${sanitizeField(product.description)}`,
    '</product_context>',
    '',
    '**Instructions:**',
    "1. *NAMING:* Generate the 'enriched_product_name' first. Check the image to confirm the exact Product Type (e.g., Polo vs Tee) and Key Feature (e.g., Flared vs Straight). Apply the naming formula strictly.\n",
    "2. Treat the Product Context as factual unless explicitly marked 'N/A'.",
    '3. Use the flatlay image(s) to confirm construction, hardware, and fabric qualities.',
    "4. Use the model image(s), when present, to infer silhouette, drape, and on-body styling.",
    "5. Fill any 'N/A' inputs strictly from visual evidence. If the attribute cannot be inferred, return null.",
    '6. Produce JSON that matches the schema. Do not include any additional text or markdown formatting.'
  ].join('\n');

  const response = await generateGeminiJson<EnrichResponse>({
    prompt,
    systemInstruction: ENRICH_SYSTEM_INSTRUCTION,
    images: imageParts,
    model: config.GEMINI_JSON_MODEL,
    generationConfig: {
      responseMimeType: 'application/json'
    }
  });

  const suggestions: Record<string, unknown> = {};
  let json = response.json ?? {};

  // Handle case where Gemini returns response as array instead of object
  if (Array.isArray(json) && json.length > 0) {
    json = json[0] as Record<string, unknown>;
  }

  const fitTags = normalizeTagList(json.fit, 2);
  if (fitTags) suggestions.fit = fitTags.join(', ');
  const feelTags = normalizeTagList(json.feel, 2);
  if (feelTags) suggestions.feel = feelTags.join(', ');
  const vibes = normalizeTagList(json.vibes, 3);
  if (vibes) suggestions.vibes = vibes;
  if (asString(json.description_text)) suggestions.description_text = asString(json.description_text);
  if (asString(json.type_category)) suggestions.type_category = asString(json.type_category);
  if (asString(json.color_group)) suggestions.color_group = asString(json.color_group);
  if (asString(json.occasion)) suggestions.occasion = asString(json.occasion);
  const materialType = asString((json as Record<string, unknown>)['material type']) ?? asString(json.material_type);
  if (materialType) suggestions.material_type = materialType;
  const specifications = normalizeSpecifications(json.product_specifications);
  if (specifications) suggestions.product_specifications = specifications;
  if (asString(json.care)) suggestions.care = asString(json.care);
  if (asString(json.product_name_suggestion)) suggestions.product_name_suggestion = asString(json.product_name_suggestion);

  if (!Object.keys(suggestions).length) {
    logger.warn({ jobId: state.jobId }, 'enrichNode: no suggestions produced');
    const patch: Partial<PipelineState> = {
      flags: {
        ...(state.flags ?? {}),
        enrichReady: true
      },
      step: 'enrich'
    };
    await persistStatePatch(state.jobId, { jobId: state.jobId, ...patch });
    return patch;
  }

  const existingSuggestions = (state.draft?.productSuggestions as Record<string, unknown> | undefined) ?? {};
  const nextSuggestions = {
    ...existingSuggestions,
    enrich: suggestions
  } as Record<string, unknown>;

  const patch: Partial<PipelineState> = {
    draft: {
      productSuggestions: nextSuggestions
    },
    artifacts: {
      enrichRuns: updateMetadataArray(state.artifacts?.enrichRuns as EnrichRun[] | undefined, [
        {
          provider: 'gemini',
          model: response.model,
          createdAt: nowIso(),
          promptVersion: ENRICH_PROMPT_VERSION
        }
      ], () => 'enrich')
    },
    flags: {
      ...(state.flags ?? {}),
      enrichReady: true
    },
    step: 'enrich'
  };

  await persistStatePatch(state.jobId, { jobId: state.jobId, ...patch });

  return patch;
}

export async function ghostNode(state: PipelineState): Promise<Partial<PipelineState>> {
  if (!hasCoreIdentifiers(state)) return {};
  if (state.flags?.ghostReady && state.step !== 'hitl_phase2_rerun') {
    logger.info({ jobId: state.jobId }, 'ghostNode: already ready, skipping');
    return { step: 'ghost' };
  }

  const rawImages = collectRawImages(state);
  const ghostBackEnabled = isGhostBackEnabledForJob(state);
  const targets = rawImages.filter((img) =>
    Boolean(img.ghostEligible) &&
    (img.productView === 'front' || (ghostBackEnabled && img.productView === 'back'))
  );
  if (!targets.length) {
    logger.warn({ jobId: state.jobId }, 'ghostNode: no ghost eligible images');
    const patch: Partial<PipelineState> = {
      flags: {
        ...(state.flags ?? {}),
        ghostReady: true
      },
      step: 'ghost'
    };
    await persistStatePatch(state.jobId, { jobId: state.jobId, ...patch });
    return patch;
  }

  const product = readProduct(state);
  const categoryRaw = asString((product as Record<string, unknown>).category_ghost) ?? asString(product.type_category) ?? asString(product.type);
  const normalizedCategory = (categoryRaw ?? '').toLowerCase();
  const category: 'topwear' | 'bottomwear' | 'footwear' | 'dresses' =
    (['topwear', 'bottomwear', 'footwear', 'dresses'] as const).includes(normalizedCategory as any)
      ? (normalizedCategory as 'topwear' | 'bottomwear' | 'footwear' | 'dresses')
      : 'topwear';
  const prompts = CATEGORY_PROMPTS[category];
  if (!prompts) {
    logger.warn({ jobId: state.jobId, category }, 'ghostNode: unsupported category');
    const patch: Partial<PipelineState> = {
      flags: {
        ...(state.flags ?? {}),
        ghostReady: true
      },
      step: 'ghost'
    };
    await persistStatePatch(state.jobId, { jobId: state.jobId, ...patch });
    return patch;
  }
  logger.info({ jobId: state.jobId, category }, 'ghostNode: using category prompts');

  const genderRaw = asString(product.gender) ?? '';
  const genderNormalized = genderRaw.toLowerCase().includes('male') ? 'male' : 'female';
  const mannequin = MANNEQUIN_ASSETS[genderNormalized as 'male' | 'female'];

  const entries: GhostImageEntry[] = [];
  const now = nowIso();

  const summaries = Array.isArray(state.artifacts?.garmentSummaryPayloads)
    ? (state.artifacts?.garmentSummaryPayloads as Array<Record<string, unknown>>)
    : [];
  const readPhysicsForView = (view: 'front' | 'back') => {
    const match = summaries.find((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).view === view) as
      | Record<string, unknown>
      | undefined;
    const physics = typeof match?.garment_physics === 'string' ? (match.garment_physics as string) : undefined;
    const shoePhysics = typeof match?.shoe_physics === 'string' ? (match.shoe_physics as string) : undefined;
    const itemName = typeof match?.item_name === 'string' ? (match.item_name as string) : undefined;
    const geometrySkeleton = typeof match?.geometry_skeleton === 'string' ? (match.geometry_skeleton as string) : undefined;
    if (physics || shoePhysics || itemName || geometrySkeleton) {
      return { garmentPhysics: physics, shoePhysics, itemName, geometrySkeleton };
    }
    const productSummaryKey = view === 'front' ? 'garment_summary_front' : 'garment_summary_back';
    const productSummary = (product as Record<string, unknown>)[productSummaryKey];
    if (productSummary && typeof productSummary === 'object') {
      const record = productSummary as Record<string, unknown>;
      return {
        garmentPhysics: typeof record.garment_physics === 'string' ? (record.garment_physics as string) : undefined,
        shoePhysics: typeof record.shoe_physics === 'string' ? (record.shoe_physics as string) : undefined,
        itemName: typeof record.item_name === 'string' ? (record.item_name as string) : undefined,
        geometrySkeleton: typeof record.geometry_skeleton === 'string' ? (record.geometry_skeleton as string) : undefined
      };
    }
    return { garmentPhysics: undefined, shoePhysics: undefined, itemName: undefined, geometrySkeleton: undefined };
  };

  for (const image of targets) {
    const view = image.productView as 'front' | 'back';
    if (!image.storagePath) {
      logger.warn({ jobId: state.jobId, originalUrl: image.originalUrl }, 'ghostNode: missing storage path');
      continue;
    }

    const garmentAsset = await resolveImageBuffer(image.storagePath);

    const physics = readPhysicsForView(view);
    const physicsText =
      category === 'footwear'
        ? physics.shoePhysics ?? physics.garmentPhysics ?? 'Front view of the footwear item.'
        : physics.garmentPhysics ?? 'Front view of the garment.';
    const viewPrompts = prompts.stage2[view];
    if (!viewPrompts) {
      logger.warn({ jobId: state.jobId, category, view }, 'ghostNode: missing prompts for view');
      continue;
    }
    logger.info({ jobId: state.jobId, category, view }, 'ghostNode: using view prompts');
    const promptFilled = viewPrompts.prompt
      .replace('{GARMENT_PHYSICS}', physicsText)
      .replace('{SHOE_PHYSICS}', physicsText)
      .replace('{ITEM_NAME}', physics.itemName ?? (asString(product.product_name) ?? 'garment'))
      .replace('{GEOMETRY_SKELETON}', physics.geometrySkeleton ?? '');

    const avatarPath = view === 'back' ? mannequin.back : mannequin.front;
    let avatarAsset: { buffer: Buffer; mimeType: string } | null = null;
    try {
      avatarAsset = await resolveImageBuffer(avatarPath);
    } catch (error) {
      logger.error({ jobId: state.jobId, avatarPath, error: (error as Error)?.message }, 'ghostNode: failed to load avatar reference');
    }

    const result = await generateGeminiImage({
      prompt: promptFilled,
      systemInstruction: viewPrompts.system,
      aspectRatio: '1:1',
      imageSize: '2K',
      model: config.GEMINI_IMAGE_MODEL,
      garment: {
        data: garmentAsset.buffer,
        mimeType: garmentAsset.mimeType,
        filename: `garment-${view}.${garmentAsset.mimeType.split('/')[1] ?? 'png'}`
      },
      avatar: avatarAsset
        ? {
          data: avatarAsset.buffer,
          mimeType: avatarAsset.mimeType,
          filename: `avatar.${avatarAsset.mimeType.split('/')[1] ?? 'png'}`
        }
        : undefined
    });

    const storagePath = await uploadGhostStagingImage(state.jobId, view, result.buffer, result.mimeType);
    const metadata = (result.metadata ?? {}) as Record<string, unknown>;

    entries.push({
      view,
      storagePath,
      provider: 'gemini',
      model: result.model,
      createdAt: now,
      seed: typeof metadata.seed === 'number' ? metadata.seed : undefined,
      aspectRatio: '1:1',
      avatarAssetPath: avatarPath,
      promptVersion: GHOST_PROMPT_VERSION
    });
  }

  if (!entries.length) {
    const patch: Partial<PipelineState> = {
      flags: {
        ...(state.flags ?? {}),
        ghostReady: true
      },
      step: 'ghost'
    };
    await persistStatePatch(state.jobId, { jobId: state.jobId, ...patch });
    return patch;
  }

  const patch: Partial<PipelineState> = {
    artifacts: {
      ghostImages: updateMetadataArray(state.artifacts?.ghostImages as GhostImageEntry[] | undefined, entries, (entry) => entry.view)
    },
    flags: {
      ...(state.flags ?? {}),
      ghostReady: true
    },
    step: 'ghost'
  };

  await persistStatePatch(state.jobId, { jobId: state.jobId, ...patch });

  return patch;
}

export async function hitlPhase1PauseNode(state: PipelineState | undefined): Promise<Partial<PipelineState>> {
  if (!state?.jobId) {
    logger.warn({ state }, 'hitlPhase1PauseNode missing jobId');
    return {};
  }

  const jobId = state.jobId;
  const pause = state.pause;

  if (!pause || pause.reason !== 'hitl_phase1') {
    const requestedAt = new Date().toISOString();
    const patch: Partial<PipelineState> = {
      pause: {
        reason: 'hitl_phase1',
        atNode: 'hitl_phase1_pause',
        requestedAt,
        metadata: {
          previousStep: state.step ?? null,
          originalUrl: state.originalUrl
        },
        resumeSignal: null
      },
      step: 'hitl_phase1_pause',
      timestamps: {
        ...(state.timestamps ?? {}),
        hitl_phase1_pause: requestedAt
      }
    };
    await persistStatePatch(jobId, { jobId, ...patch });
    logger.info({ jobId, requestedAt, previousStep: state.step ?? null }, 'hitlPhase1PauseNode: pause recorded');
    return patch;
  }

  logger.info({ jobId }, 'hitlPhase1PauseNode: pause already set, waiting for interrupt node');
  return {};
}

export async function hitlPhase2PauseNode(state: PipelineState | undefined): Promise<Partial<PipelineState>> {
  if (!state?.jobId) {
    logger.warn({ state }, 'hitlPhase2PauseNode missing jobId');
    return {};
  }

  const jobId = state.jobId;
  const pause = state.pause;
  const flags = state.flags ?? {};

  if (!flags.ghostReady || !flags.enrichReady) {
    logger.info(
      { jobId, ghostReady: flags.ghostReady ?? false, enrichReady: flags.enrichReady ?? false },
      'hitlPhase2PauseNode: waiting on automation outputs'
    );
    return {};
  }

  if (!pause || pause.reason !== 'hitl_phase2') {
    const requestedAt = new Date().toISOString();
    const patch: Partial<PipelineState> = {
      pause: {
        reason: 'hitl_phase2',
        atNode: 'hitl_phase2_pause',
        requestedAt,
        metadata: {
          previousStep: state.step ?? null,
          originalUrl: state.originalUrl
        },
        resumeSignal: null
      },
      step: 'hitl_phase2_pause',
      timestamps: {
        ...(state.timestamps ?? {}),
        hitl_phase2_pause: requestedAt
      }
    };
    await persistStatePatch(jobId, { jobId, ...patch });
    logger.info({ jobId, requestedAt, previousStep: state.step ?? null }, 'hitlPhase2PauseNode: pause recorded');
    return patch;
  }

  logger.info({ jobId }, 'hitlPhase2PauseNode: pause already set, waiting for interrupt node');
  return {};
}

export async function hitlPhase1InterruptNode(state: PipelineState | undefined): Promise<Partial<PipelineState>> {
  if (!state?.jobId) return {};
  const pause = state.pause;
  if (!pause || pause.reason !== 'hitl_phase1') return {};

  let resumeSignal = pause.resumeSignal ?? null;
  if (!resumeSignal) {
    logger.info({ jobId: state.jobId, atNode: pause.atNode }, 'hitlPhase1InterruptNode: interrupting for HITL');
    const resumed = interrupt({ jobId: state.jobId, reason: 'hitl_phase1', atNode: pause.atNode }) as PauseResumeSignal | undefined;
    if (!resumed) return {};
    resumeSignal = resumed;
  }

  const resumedAt = new Date().toISOString();
  const latest = await readState(state.jobId);
  const flagsBase = latest?.flags ?? state.flags ?? {};
  const timestampsBase = latest?.timestamps ?? state.timestamps ?? {};

  const patch: Partial<PipelineState> = {
    pause: null,
    step: resumeSignal.action === 'rerun' ? 'hitl_phase1_rerun' : 'hitl_phase1_resumed',
    timestamps: {
      ...timestampsBase,
      hitl_phase1_resumed: resumedAt
    },
    flags: {
      ...flagsBase,
      hitlPhase1Completed: resumeSignal.action === 'resume'
    }
  };

  await persistStatePatch(state.jobId, { jobId: state.jobId, ...patch });
  logger.info({ jobId: state.jobId, action: resumeSignal.action, actor: 'phase1' }, 'hitlPhase1InterruptNode: resume recorded');
  return patch;
}

export async function hitlPhase2InterruptNode(state: PipelineState | undefined): Promise<Partial<PipelineState>> {
  if (!state?.jobId) return {};
  const pause = state.pause;
  if (!pause || pause.reason !== 'hitl_phase2') return {};

  let resumeSignal = pause.resumeSignal ?? null;
  if (!resumeSignal) {
    logger.info({ jobId: state.jobId, atNode: pause.atNode }, 'hitlPhase2InterruptNode: interrupting for HITL');
    const resumed = interrupt({ jobId: state.jobId, reason: 'hitl_phase2', atNode: pause.atNode }) as PauseResumeSignal | undefined;
    if (!resumed) return {};
    resumeSignal = resumed;
  }

  const resumedAt = new Date().toISOString();
  const latest = await readState(state.jobId);
  const flagsBase = latest?.flags ?? state.flags ?? {};
  const timestampsBase = latest?.timestamps ?? state.timestamps ?? {};

  const patch: Partial<PipelineState> = {
    pause: null,
    step: resumeSignal.action === 'rerun' ? 'hitl_phase2_rerun' : 'hitl_phase2_resumed',
    timestamps: {
      ...timestampsBase,
      hitl_phase2_resumed: resumedAt
    },
    flags: {
      ...flagsBase,
      hitlPhase2Completed: resumeSignal.action === 'resume'
    }
  };

  await persistStatePatch(state.jobId, { jobId: state.jobId, ...patch });
  if (resumeSignal.action === 'rerun') {
    logger.info({ jobId: state.jobId, resumeSignal }, 'hitlPhase2InterruptNode: rerun resume recorded');
    return patch;
  }
  logger.info({ jobId: state.jobId, action: resumeSignal.action, actor: 'phase2' }, 'hitlPhase2InterruptNode: resume recorded');
  return patch;
}

type StageProductPayload = {
  id: string;
  type: string;
  brand: string;
  size: string;
  price: number;
  currency: string;
  image_url: string;
  description: string;
  color: string;
  product_name?: string | null;
  product_url?: string | null;
  type_category?: string | null;
  category_id?: string | null;
  color_group?: string | null;
  occasion?: string | null;
  material_type?: string | null;
  gender?: string | null;
  placement_x?: number | null;
  placement_y?: number | null;
  image_length?: number | null;
  product_length?: number | null;
  body_parts_visible?: string[] | null;
  size_chart?: Record<string, unknown> | null;
  fit?: string | null;
  feel?: string | null;
  vibes?: string | null;
  description_text?: string | null;
  garment_summary_front?: Record<string, unknown> | null;
  garment_summary_back?: Record<string, unknown> | null;
  garment_summary?: Record<string, unknown> | null;
  garment_summary_version?: string | null;
  product_specifications?: Record<string, unknown> | null;
  vector_embedding?: unknown;
  similar_items?: string | null;
  care?: string | null;
};

type StageImagePayload = {
  product_id: string;
  url: string;
  kind: 'flatlay' | 'model' | 'detail' | 'ghost';
  sort_order: number;
  is_primary: boolean;
  gender: string | null;
  vto_eligible: boolean;
  product_view: 'front' | 'back' | 'side' | 'detail' | 'other' | null;
  ghost_eligible: boolean;
  summary_eligible: boolean;
};

type StageValidationResult = {
  valid: boolean;
  messages: ValidationMessage[];
};

const STAGE_VALIDATION_CODES = new Set<string>([
  'missing_brand',
  'missing_product_name',
  'missing_product_url',
  'invalid_price',
  'missing_type',
  'missing_images',
  'invalid_primary_image',
  'missing_primary_image_url',
  'invalid_price_minor',
  'image_missing_url',
  'duplicate_image_url',
  'invalid_image_kind',
  'ghost_requires_view',
  'missing_placement_data',
  'missing_placement_x',
  'missing_placement_y',
  'missing_image_length',
  'missing_body_parts_visible'
]);

function dedupeValidations(
  existing: Array<{ code: string; message: string }>,
  additions: Array<{ code: string; message: string }>
): Array<{ code: string; message: string }> {
  const map = new Map<string, { code: string; message: string }>();
  for (const entry of existing) {
    map.set(`${entry.code}:${entry.message}`, entry);
  }
  for (const entry of additions) {
    map.set(`${entry.code}:${entry.message}`, entry);
  }
  return Array.from(map.values());
}

type PipelineErrorEntry = NonNullable<PipelineState['errors']>[number];

function dedupeErrors(
  existing: PipelineErrorEntry[],
  additions: PipelineErrorEntry[]
): PipelineErrorEntry[] {
  const map = new Map<string, PipelineErrorEntry>();
  for (const entry of existing) {
    map.set(`${entry.step}:${entry.message}:${entry.kind ?? 'unknown'}`, entry);
  }
  for (const entry of additions) {
    map.set(`${entry.step}:${entry.message}:${entry.kind ?? 'unknown'}`, entry);
  }
  return Array.from(map.values());
}

function removeStageValidations(validations: Array<{ code: string; message: string }> | undefined) {
  if (!validations) return undefined;
  const filtered = validations.filter((entry) => !STAGE_VALIDATION_CODES.has(entry.code));
  return filtered.length ? filtered : undefined;
}

function removeStageErrors(errors: PipelineErrorEntry[] | undefined) {
  if (!errors) return undefined;
  const filtered = errors.filter((entry) => entry.step !== 'stage');
  return filtered.length ? filtered : undefined;
}

function computePriceMinor(product: Record<string, unknown> | undefined): number | null {
  if (!product) return null;
  if (typeof product.price_minor === 'number' && Number.isFinite(product.price_minor)) {
    return Math.round(product.price_minor);
  }
  if (typeof product.price === 'number' && Number.isFinite(product.price)) {
    return Math.round(product.price);
  }
  if (typeof product.price === 'string') {
    const parsed = Number(product.price);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }
  return null;
}

function validateStageReadiness(state: PipelineState): StageValidationResult {
  const messages: ValidationMessage[] = [];
  for (const rule of PRODUCT_VALIDATION_RULES) {
    const result = rule(state);
    if (result) messages.push(result);
  }

  const product = state.draft?.product as Record<string, unknown> | undefined;
  const priceMinor = computePriceMinor(product);
  if (priceMinor == null || priceMinor <= 0) {
    messages.push({ code: 'invalid_price_minor', message: 'price_minor must be a positive integer.', severity: 'error' });
  }

  const images = Array.isArray(state.draft?.images) ? (state.draft?.images as Array<Record<string, unknown>>) : [];
  const seenUrls = new Set<string>();
  images.forEach((img) => {
    const url = typeof img.url === 'string' ? img.url : null;
    if (!url) {
      messages.push({ code: 'image_missing_url', message: 'All staged images must have a URL.', severity: 'error' });
      return;
    }
    if (seenUrls.has(url)) {
      messages.push({ code: 'duplicate_image_url', message: `Duplicate image URL detected: ${url}`, severity: 'error' });
    }
    seenUrls.add(url);
    const kind = typeof img.kind === 'string' ? img.kind.toLowerCase() : null;
    if (!kind || !['flatlay', 'model', 'detail', 'ghost'].includes(kind)) {
      messages.push({ code: 'invalid_image_kind', message: `Image kind must be flatlay, model, detail, or ghost (${url}).`, severity: 'error' });
    }
    if (img.ghost_eligible && !['front', 'back'].includes((img.product_view as string | undefined)?.toLowerCase() ?? '')) {
      messages.push({ code: 'ghost_requires_view', message: `Ghost eligible images must be tagged front/back (${url}).`, severity: 'error' });
    }
  });

  const errors = messages.filter((msg) => msg.severity === 'error');
  return { valid: errors.length === 0, messages };
}

function resolvePublicUrl(path: string): string {
  const { data } = supabaseAdmin.storage.from(config.STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error(`unable-to-resolve-public-url:${path}`);
  }
  return data.publicUrl;
}

function resolveImageUrl(state: PipelineState, image: Record<string, unknown>): string {
  const url = typeof image.url === 'string' ? image.url : null;
  const rawImages = collectRawImages(state);
  const match = rawImages.find((raw) => typeof raw.storagePath === 'string' && raw.originalUrl === url);
  if (match?.storagePath) {
    return resolvePublicUrl(match.storagePath);
  }

  if (url) return url;
  throw new Error('image-url-unresolvable');
}

function buildStageProduct(state: PipelineState): StageProductPayload {
  const product = (state.draft?.product as Record<string, unknown> | undefined) ?? {};
  const id = asString(product.id) ?? state.dedupeKey ?? state.jobId;
  const brand = asString(product.brand) ?? '';
  const type = asString(product.type) ?? '';
  const size = asString(product.size) ?? 'M';
  const currency = asString(product.currency) ?? 'INR';
  const color = asString(product.color) ?? '';
  const description = asString(product.description) ?? asString(product.description_text) ?? '';
  const imageUrl = asString(product.image_url) ?? '';
  const priceMinor = computePriceMinor(product);
  const bodyPartsVisible = normalizeBodyPartsVisible(
    product.body_parts_visible ?? (product as Record<string, unknown>).bodyPartsVisible
  );
  if (!priceMinor || priceMinor <= 0) {
    throw new Error('invalid-price-minor');
  }

  const coerceNullable = (value: unknown): string | null => {
    const str = asString(value);
    return str ?? null;
  };

  return {
    id,
    type,
    brand,
    size,
    price: priceMinor,
    currency,
    image_url: imageUrl,
    description,
    color,
    product_name: coerceNullable(product.product_name),
    product_url: coerceNullable(product.product_url),
    type_category: coerceNullable(product.type_category),
    category_id: coerceNullable(product.category_id),
    color_group: coerceNullable(product.color_group),
    occasion: coerceNullable((product as Record<string, unknown>).occasion),
    material_type: coerceNullable((product as Record<string, unknown>).material_type),
    gender: coerceNullable(product.gender),
    placement_x: typeof product.placement_x === 'number' ? product.placement_x : null,
    placement_y: typeof product.placement_y === 'number' ? product.placement_y : null,
    image_length: typeof product.image_length === 'number' ? product.image_length : null,
    product_length: typeof product.product_length === 'number' ? product.product_length : null,
    body_parts_visible: bodyPartsVisible,
    size_chart: typeof product.size_chart === 'object' && product.size_chart !== null ? (product.size_chart as Record<string, unknown>) : null,
    fit: coerceNullable(product.fit),
    feel: coerceNullable(product.feel),
    care: coerceNullable(product.care),
    vibes: coerceNullable(product.vibes),
    description_text: coerceNullable(product.description_text),
    garment_summary_front:
      typeof product.garment_summary_front === 'object' && product.garment_summary_front !== null
        ? (product.garment_summary_front as Record<string, unknown>)
        : null,
    garment_summary_back:
      typeof product.garment_summary_back === 'object' && product.garment_summary_back !== null
        ? (product.garment_summary_back as Record<string, unknown>)
        : null,
    garment_summary:
      typeof product.garment_summary === 'object' && product.garment_summary !== null
        ? (product.garment_summary as Record<string, unknown>)
        : null,
    garment_summary_version: coerceNullable(product.garment_summary_version),
    product_specifications:
      typeof product.product_specifications === 'object' && product.product_specifications !== null
        ? (product.product_specifications as Record<string, unknown>)
        : null,
    vector_embedding: product.vector_embedding,
    similar_items: coerceNullable(product.similar_items)
  };
}

function buildStageImages(state: PipelineState, productId: string): StageImagePayload[] {
  const rawImages = Array.isArray(state.draft?.images) ? (state.draft?.images as Array<Record<string, unknown>>) : [];
  return rawImages.map((image) => {
    const url = resolveImageUrl(state, image);
    const kindRaw = typeof image.kind === 'string' ? image.kind.trim().toLowerCase() : 'model';
    const kind = ['flatlay', 'model', 'detail', 'ghost'].includes(kindRaw) ? (kindRaw as 'flatlay' | 'model' | 'detail' | 'ghost') : 'model';
    const gender = typeof image.gender === 'string' ? image.gender : null;
    const productView = typeof image.product_view === 'string' ? normalizeProductView(image.product_view) : null;
    return {
      product_id: productId,
      url,
      kind,
      sort_order: typeof image.sort_order === 'number' ? image.sort_order : 0,
      is_primary: Boolean(image.is_primary),
      gender,
      vto_eligible: Boolean(image.vto_eligible),
      product_view: productView,
      ghost_eligible: Boolean(image.ghost_eligible),
      summary_eligible: Boolean(image.summary_eligible)
    };
  });
}

function buildGhostStageImages(state: PipelineState, productId: string, productGender: string | null): StageImagePayload[] {
  const ghostBackEnabled = isGhostBackEnabledForJob(state);
  const ghosts = Array.isArray(state.artifacts?.ghostImages) ? (state.artifacts?.ghostImages as Array<Record<string, unknown>>) : [];
  return ghosts
    .map((entry): StageImagePayload | null => {
      const view = entry.view === 'front' || entry.view === 'back' ? (entry.view as 'front' | 'back') : null;
      if (view === 'back' && !ghostBackEnabled) return null;
      const storagePath = typeof entry.storagePath === 'string' ? entry.storagePath : null;
      if (!view || !storagePath) return null;
      const url = resolvePublicUrl(storagePath);
      return {
        product_id: productId,
        url,
        kind: 'ghost' as const,
        sort_order: view === 'front' ? 0 : 1,
        is_primary: view === 'front',
        gender: productGender,
        vto_eligible: false,
        product_view: view,
        ghost_eligible: false,
        summary_eligible: false
      };
    })
    .filter((entry): entry is StageImagePayload => Boolean(entry));
}

async function upsertIngestedRecords(product: StageProductPayload, images: StageImagePayload[]) {
  const { error } = await supabaseAdmin
    .rpc('stage_ingested_product', { product, images });
  if (error) {
    throw new Error(`stage-ingested-product-failed:${error.message}`);
  }
}

export async function stageNode(state: PipelineState): Promise<Partial<PipelineState>> {
  if (!state?.jobId) return {};

  const validation = validateStageReadiness(state);
  if (!validation.valid) {
    const existingValidations = Array.isArray(state.draft?.validations)
      ? state.draft?.validations
      : [];
    const errors = validation.messages
      .filter((message) => message.severity === 'error')
      .map((message) => ({ code: message.code, message: message.message }));

    const dedupedValidations = dedupeValidations(existingValidations, errors);
    const stageErrors: PipelineErrorEntry[] = errors.map((error) => ({
      step: 'stage',
      message: error.message,
      kind: 'user'
    }));
    const nextErrors = dedupeErrors(state.errors ?? [], stageErrors);
    const normalizedValidations = dedupedValidations.length ? dedupedValidations : undefined;
    const normalizedErrors = nextErrors.length ? nextErrors : undefined;

    return {
      draft: {
        ...(state.draft ?? {}),
        validations: normalizedValidations
      },
      flags: {
        ...(state.flags ?? {}),
        stageCompleted: false,
        promoteCompleted: false,
        hitlPhase2Completed: false
      },
      errors: normalizedErrors,
      step: 'stage'
    };
  }

  const productPayload = buildStageProduct(state);
  let imagePayloads = buildStageImages(state, productPayload.id);
  const normalizedGender = normalizeGender(productPayload.gender);
  const ghostPayloads = buildGhostStageImages(state, productPayload.id, normalizedGender);
  if (ghostPayloads.length) {
    const hasFrontGhost = ghostPayloads.some((img) => img.is_primary);
    if (hasFrontGhost) {
      imagePayloads = imagePayloads.map((img) => ({ ...img, is_primary: false }));
    }
    imagePayloads = [...imagePayloads, ...ghostPayloads];
  }

  await upsertIngestedRecords(productPayload, imagePayloads);

  const clearedValidations = removeStageValidations(state.draft?.validations);
  const clearedErrors = removeStageErrors(state.errors);

  const patch: Partial<PipelineState> = {
    flags: {
      ...(state.flags ?? {}),
      stageCompleted: true
    },
    timestamps: {
      ...(state.timestamps ?? {}),
      stage_completed: nowIso()
    },
    draft: {
      ...(state.draft ?? {}),
      validations: clearedValidations
    },
    errors: clearedErrors ?? [],
    step: 'stage'
  };

  await persistStatePatch(state.jobId, { jobId: state.jobId, ...patch });
  return patch;
}

async function promoteProductRecord(productId: string, client = supabaseAdmin) {
  const { error } = await client
    .rpc('promote_ingested_product', { p_product_id: productId });
  if (error) {
    throw new Error(`promote-ingested-product-failed:${error.message}`);
  }
}

export async function promoteNode(state: PipelineState): Promise<Partial<PipelineState>> {
  if (!state?.jobId) return {};
  const productId = state.draft?.product?.id as string | undefined ?? state.dedupeKey;
  if (!productId) {
    return {
      errors: [
        ...(state.errors ?? []),
        { step: 'promote', message: 'product-id-missing', kind: 'fatal' }
      ],
      step: 'promote'
    };
  }

  if (!state.flags?.stageCompleted) {
    return {
      errors: [
        ...(state.errors ?? []),
        { step: 'promote', message: 'stage-must-complete-before-promote', kind: 'user' }
      ],
      step: 'promote'
    };
  }

  await promoteProductRecord(productId);

  const patch: Partial<PipelineState> = {
    flags: {
      ...(state.flags ?? {}),
      promoteCompleted: true,
      hitlPhase2Completed: true
    },
    timestamps: {
      ...(state.timestamps ?? {}),
      promote_completed: nowIso()
    },
    errors: [],
    step: 'promote'
  };

  await persistStatePatch(state.jobId, { jobId: state.jobId, ...patch });
  return patch;
}

type DraftImageInput = {
  product_id?: string;
  url?: unknown;
  sort_order?: unknown;
  is_primary?: unknown;
  kind?: unknown;
  gender?: unknown;
  vto_eligible?: unknown;
  product_view?: unknown;
  ghost_eligible?: unknown;
  summary_eligible?: unknown;
};

type NormalizedDraftImage = {
  product_id?: string;
  url: string;
  sort_order: number;
  is_primary: boolean;
  kind: 'flatlay' | 'model' | 'detail' | null;
  gender: string | null;
  vto_eligible: boolean;
  product_view: 'front' | 'back' | 'side' | 'detail' | 'other' | null;
  ghost_eligible: boolean;
  summary_eligible: boolean;
};

function normalizeDraftImageKind(kind: unknown): 'flatlay' | 'model' | 'detail' | null {
  if (typeof kind !== 'string') return null;
  const lower = kind.trim().toLowerCase();
  if (['flatlay', 'laydown', 'lay-flat'].includes(lower)) return 'flatlay';
  if (['model', 'on-model', 'lifestyle'].includes(lower)) return 'model';
  if (['detail', 'closeup', 'close-up'].includes(lower)) return 'detail';
  return null;
}

function normalizeProductView(value: unknown): 'front' | 'back' | 'side' | 'detail' | 'other' | null {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  return ['front', 'back', 'side', 'detail', 'other'].includes(lower)
    ? (lower as 'front' | 'back' | 'side' | 'detail' | 'other')
    : null;
}

function dedupeDraftImages(images: DraftImageInput[]): NormalizedDraftImage[] {
  const seen = new Set<string>();
  const result: NormalizedDraftImage[] = [];
  images.forEach((img, index) => {
    if (!img || typeof img.url !== 'string') return;
    const url = img.url.trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    const rawView = typeof img.product_view === 'string' ? img.product_view.trim().toLowerCase() : null;
    const normalizedView = rawView && ['front', 'back', 'side', 'detail', 'other'].includes(rawView) ? (rawView as 'front' | 'back' | 'side' | 'detail' | 'other') : null;
    result.push({
      url,
      sort_order: typeof img.sort_order === 'number' ? img.sort_order : index,
      is_primary: Boolean(img.is_primary),
      kind: normalizeDraftImageKind(img.kind),
      gender: typeof img.gender === 'string' && img.gender.trim() ? img.gender : null,
      vto_eligible: Boolean(img.vto_eligible),
      product_id: typeof img.product_id === 'string' ? img.product_id : undefined,
      product_view: normalizedView,
      ghost_eligible: Boolean(img.ghost_eligible),
      summary_eligible: Boolean(img.summary_eligible)
    });
  });
  return result;
}

async function downloadImageBuffer(url: string) {
  const isMyntraCdn = url.includes('assets.myntassets.com/');

  const attempt = async (candidateUrl: string) => {
    const response: AxiosResponse<ArrayBuffer> = await axios.get<ArrayBuffer>(candidateUrl, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: 15 * 1024 * 1024,
      headers: {
        'User-Agent': 'query-your-helper/ingestion-downloader'
      },
      validateStatus: () => true
    });
    if (response.status < 200 || response.status >= 400) {
      const err = new Error(`download-failed:${response.status}:${candidateUrl}`);
      (err as any).status = response.status;
      throw err;
    }
    const buffer = Buffer.from(response.data);
    if (buffer.length > 15 * 1024 * 1024) {
      throw new Error(`file-too-large:${buffer.length}`);
    }
    const contentType = response.headers['content-type'] ?? 'image/jpeg';
    return { buffer, contentType };
  };

  try {
    return await attempt(url);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = typeof (err as any)?.status === 'number' ? (err as any).status as number : null;
    if (!isMyntraCdn || status !== 404) {
      throw new Error(message);
    }

    // Myntra CDN fallback ladder (only on 404):
    // 1) Strip transform + /v1 prefix to the canonical /assets/images/ path
    // 2) If still /v1 without transforms, strip /v1
    const candidates: string[] = [];
    if (url.includes('/v1/assets/images/')) {
      const idx = url.indexOf('/v1/assets/images/');
      if (idx > 0) {
        candidates.push(`https://assets.myntassets.com/assets/images/${url.slice(idx + '/v1/assets/images/'.length)}`);
      }
      // If the URL is already "https://assets.../v1/assets/images/...", also try removing only "/v1"
      candidates.push(url.replace('/v1/assets/images/', '/assets/images/'));
    }

    for (const candidate of Array.from(new Set(candidates))) {
      try {
        return await attempt(candidate);
      } catch {
        // continue
      }
    }
    throw new Error(message);
  }
}

async function inferDimensions(buffer: Buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    return { width: metadata.width, height: metadata.height };
  } catch {
    return { width: undefined, height: undefined };
  }
}
