import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config/index';
import { withRetry, errorHttpStatus, isTransientUpstreamError } from '../../utils/retry';
import { createLogger } from '../../utils/logger';
import type { TryonInput, TryonOutput, TryonProvider } from '../../domain/types';

const logger = createLogger({ stage: 'adapter:gemini-vton' });

// Primary image model + fallbacks, tried in order when one is overloaded (503) or missing (404).
function imageModelCandidates(): string[] {
  const fallbacks = config.GEMINI_IMAGE_MODEL_FALLBACKS.split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([config.GEMINI_IMAGE_MODEL, ...fallbacks])];
}

// ponytail: gender-specific mannequin avatars (from vton_intern_pack/avatars/gemini_seedream/).
// No 'unisex' avatar exists in that pack — falls back to the female asset.
// Note: male_asset.png is actually JPEG bytes despite the .png name — detect by
// magic number rather than trust the extension.
const AVATAR_PATHS: Record<'male' | 'female', string> = {
  female: join(import.meta.dir, '../../../assets/gemini-avatar-female.png'),
  male: join(import.meta.dir, '../../../assets/gemini-avatar-male.png'),
};

function sniffMimeType(bytes: Buffer): string {
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
}

function loadAvatar(gender: string): { b64: string; mimeType: string } {
  const path = AVATAR_PATHS[gender === 'male' ? 'male' : 'female'];
  const bytes = readFileSync(path);
  return { b64: bytes.toString('base64'), mimeType: sniffMimeType(bytes) };
}

type VtonCategory = 'topwear' | 'bottomwear' | 'dresses';

const CATEGORY_MAP: Record<string, VtonCategory> = {
  topwear: 'topwear',
  bottomwear: 'bottomwear',
  dress: 'dresses',
};

// const BG_HEX = '#808080';

// ── V-ToN prompts ──────────────────────────────────────────────────────────
// Ported (front-view only) from vton_intern_pack/code/ghost_mannequin/experiment_vton_prompts.py,
// validated recipe per vton_intern_pack/02_MODEL_LEARNINGS.md §3.

const VTON_SYSTEM_BASE = `\
You are a virtual tryon engine. The first image is the identity-locked base avatar and must remain unchanged in pose, height and body proportions. 
Ignore faces and bodies in the reference garment images entirely, they are for garment appearance reference only. Replace clothing in avatar image, following the Garment Summaries as guiding specifications.
BODY/SILHOUETTE LOCK: Use the base image as the geometry mask. Do not alter the body outline or internal proportions (torso, arms, legs). No scaling, slimming, elongation, widening, or warping of the body, retain the pose. 
PRIORITY: If objectives conflict, preserve pose and body proportions/silhouette, then garment blueprint, then aesthetics.
`;

const CATEGORY_PROMPTS = {
  female: {
    topwear: {
      system: ``,
      prompt: `\

Dress the full body avatar (neutral pose) in [img 1] with the referenced top wear in [img 2], retain original bottom wear in [img 1].
Use the Garment Summary as a guiding specification. Preserve pose and body proportions. Output editorial/catalogue sharpness. The text and logo/design from [img 2] should be preserved.

{GARMENT_SPEC_BLOCK}
`,
    },
    bottomwear: {
      system: ``,
      prompt: `\

Dress the full body avatar (neutral pose) in [img 1] with the referenced bottom wear in [img 2], retain original top wear in [img 1].
Use the Garment Summary as a guiding specification. Preserve pose and body proportions. Output editorial/catalogue sharpness. The text and logo/design from [img 2] should be preserved.

{GARMENT_SPEC_BLOCK}
`,
    },
    dresses: {
      system: ``,
      prompt: `\

Dress the full body avatar (neutral pose) in [img 1] with the referenced dress in [img 2]. Use the Garment Summary as a guiding specification. Preserve pose and body proportions. Output editorial/catalogue sharpness. The text and logo/design from [img 2] should be preserved.

{GARMENT_SPEC_BLOCK}
`,
    },
  },
  male: {
    topwear: {
      system: ``,
      prompt: `\

Dress the full body avatar (neutral pose) in [img 1] with the referenced top wear in [img 2], retain original bottom wear in [img 1].
Use the Garment Summary as a guiding specification. Preserve pose and body proportions. Output editorial/catalogue sharpness. The text and logo/design from [img 2] should be preserved.

{GARMENT_SPEC_BLOCK}
`,
    },
    bottomwear: {
      system: ``,
      prompt: `\

Dress the full body avatar (neutral pose) in [img 1] with the referenced bottom wear in [img 2].
Use the Garment Summary as a guiding specification. Preserve pose and body proportions. Output editorial/catalogue sharpness. The text and logo/design from [img 2] should be preserved.

{GARMENT_SPEC_BLOCK}
`,
    },
  },
};

function buildPrompt(
  category: VtonCategory,
  itemName: string,
  techPack: string,
  garmentPhysics: string,
  colorAndFabric: string,
  gender: string = 'female',
): { system: string; prompt: string } {
  const genderKey = gender === 'male' ? 'male' : 'female';
  const categoryGroup = CATEGORY_PROMPTS[genderKey];
  const bundle = (categoryGroup as Record<string, { system: string; prompt: string }>)[category] || CATEGORY_PROMPTS.female[category];

  const system = VTON_SYSTEM_BASE + bundle.system;

  let cleanedPhysics = (garmentPhysics || '')
    .replace(/^\[GARMENT_PHYSICS\]\s*/i, '')
    .trim();

  const matchIndex = cleanedPhysics.search(/view of/i);
  if (matchIndex !== -1) {
    cleanedPhysics = cleanedPhysics.slice(matchIndex);
  }

  const garmentSpecBlock = [
    "GARMENT SPEC (image_1 is the garment's visual truth — where any line below conflicts with image_1, follow image_1):",
    cleanedPhysics,
  ].filter(Boolean).join('\n\n');

  const prompt = bundle.prompt
    .replace('{GARMENT_SPEC_BLOCK}', garmentSpecBlock)
    .replace('{ITEM_NAME}', itemName);

  return { system, prompt };
}

async function callGemini(modelName: string, systemInstruction: string, prompt: string, avatarB64: string, avatarMime: string, garmentB64: string, garmentMime: string): Promise<{ b64: string; mimeType: string }> {
  if (!config.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${config.GOOGLE_API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{
        parts: [
          { inlineData: { mimeType: avatarMime, data: avatarB64 } },
          { inlineData: { mimeType: garmentMime, data: garmentB64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) throw new Error(`${modelName} ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] }; finishReason?: string }[];
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData)?.inlineData;
  if (!imagePart) {
    const finishReason = data.candidates?.[0]?.finishReason ?? 'unknown';
    throw new Error(`${modelName}: no image in response (finishReason=${finishReason})`);
  }
  return { b64: imagePart.data, mimeType: imagePart.mimeType };
}

async function fetchImageAsBase64(url: string): Promise<{ b64: string; mimeType: string }> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`Garment image fetch failed ${resp.status}: ${url}`);
  const mimeType = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  const buf = await resp.arrayBuffer();
  return { b64: Buffer.from(buf).toString('base64'), mimeType };
}

export const geminiVtonProvider: TryonProvider = {
  name: 'gemini_nano_banana',

  async run(input: TryonInput): Promise<TryonOutput> {
    const category = CATEGORY_MAP[input.productType];
    if (!category) throw new Error(`gemini_nano_banana: unsupported productType ${input.productType}`);

    const avatar = loadAvatar(input.gender);
    const garment = await fetchImageAsBase64(input.imageUrl);
    const { system, prompt } = buildPrompt(
      category,
      input.itemName || 'garment',
      input.techPack || '',
      input.garmentPhysics || '',
      input.colorAndFabric || '',
      input.gender,
    );

    const start = Date.now();

    // A single image model can be overloaded for a while (sustained 503 "high demand"), so
    // after per-model retries are exhausted we move down the fallback chain. A non-transient
    // error (e.g. 400 bad request) fails fast without trying the rest.
    const candidates = imageModelCandidates();
    let image: { b64: string; mimeType: string } | undefined;
    let usedModel = candidates[0];
    let lastErr: unknown;

    for (const modelName of candidates) {
      try {
        image = await withRetry(
          () => callGemini(modelName, system, prompt, avatar.b64, avatar.mimeType, garment.b64, garment.mimeType),
          { retries: 2, backoffMs: 1000, shouldRetry: isTransientUpstreamError },
        );
        usedModel = modelName;
        break;
      } catch (err) {
        lastErr = err;
        const status = errorHttpStatus(err);
        if (isTransientUpstreamError(err) || status === 404) {
          logger.warn({ model: modelName, status, error: (err as Error).message }, 'vton image model unavailable, trying next fallback');
          continue;
        }
        throw err;
      }
    }

    if (!image) {
      throw lastErr instanceof Error ? lastErr : new Error(`All Gemini image models failed: ${candidates.join(', ')}`);
    }

    return {
      bytes: Buffer.from(image.b64, 'base64'),
      mimeType: image.mimeType,
      inferenceMs: Date.now() - start,
      modelUsed: usedModel,
    };
  },
};
