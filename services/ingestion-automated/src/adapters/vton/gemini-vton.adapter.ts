import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config/index';
import { readUsage } from '../gemini';
import { geminiRouter } from '../llm/index';
import type { TryonInput, TryonOutput, TryonProvider } from '../../domain/types';

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
BACKGROUND: Plain uniform white studio background, exactly like the base avatar image. Never a black or dark background.
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
    "GARMENT SPEC (image_2 is the garment's visual truth — where any line below conflicts with image_2, follow image_2):",
    cleanedPhysics,
  ].filter(Boolean).join('\n\n');

  const prompt = bundle.prompt
    .replace('{GARMENT_SPEC_BLOCK}', garmentSpecBlock)
    .replace('{ITEM_NAME}', itemName);

  return { system, prompt };
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

    // Route failover, model fallback, 429 handling and per-route concurrency all live in the
    // router — this adapter only assembles the request and unpacks the image.
    const { response, routeUsed, modelUsed, attempted } = await geminiRouter().call({
      models: imageModelCandidates(),
      parts: [
        { inlineData: { mimeType: avatar.mimeType, data: avatar.b64 } },
        { inlineData: { mimeType: garment.mimeType, data: garment.b64 } },
        { text: prompt },
      ],
      systemInstruction: system,
      // A 200 with no image (finishReason=IMAGE_SAFETY on e.g. camis/lingerie-adjacent garments)
      // walks the model chain and then the route chain instead of failing the job — safety
      // filters are tuned differently per model and per endpoint, so a sibling often passes.
      expectImage: true,
      // Validated VTON recipe — deterministic output (temperature 0) so the model faithfully
      // dresses the base avatar instead of regurgitating the reference model, at portrait 9:16 / 2K.
      generationConfig: {
        responseModalities: ['IMAGE'],
        temperature: 0,
        imageConfig: { aspectRatio: '9:16', imageSize: '2K' },
        // This is catalogue clothing on a neutral base avatar; block only high-severity content
        // instead of the default threshold that false-positives on fitted/strappy womenswear.
        safetySettings: [
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      },
    });

    const imagePart = response.parts.find((p) => p.inlineData)?.inlineData;
    if (!imagePart) {
      throw new Error(`${modelUsed}: no image in response (finishReason=${response.finishReason ?? 'unknown'})`);
    }

    return {
      bytes: Buffer.from(imagePart.data, 'base64'),
      mimeType: imagePart.mimeType,
      inferenceMs: Date.now() - start,
      modelUsed,
      routeUsed,
      attempted,
      usage: readUsage(response.usageMetadata),
    };
  },
};
