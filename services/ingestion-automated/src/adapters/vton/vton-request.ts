/**
 * The one place a VTON request is built.
 *
 * Both lanes assemble the same request from here — the instant adapter, which sends it to
 * `generateContent` and awaits the image, and the economy-lane collector, which packs it into a
 * batch tray. Extracted from gemini-vton.adapter.ts verbatim: the subtle behaviours below
 * (unisex → female avatar, male-dress → female prompt, JPEG-bytes-in-a-.png sniffing, the
 * body-lock system prompt, the deterministic 9:16 / 2K recipe) are exactly what drifts apart
 * when two lanes each keep their own copy.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TryonInput } from '../../domain/types';

// ponytail: gender-specific mannequin avatars (from vton_intern_pack/avatars/gemini_seedream/).
// No 'unisex' avatar exists in that pack — falls back to the female asset.
// Note: male_asset.png is actually JPEG bytes despite the .png name — detect by
// magic number rather than trust the extension.
export const AVATAR_PATHS: Record<'male' | 'female', string> = {
  female: join(import.meta.dir, '../../../assets/gemini-avatar-female.png'),
  male: join(import.meta.dir, '../../../assets/gemini-avatar-male.png'),
};

export type AvatarKey = 'male' | 'female';

/** Which avatar a gender resolves to. Split out so the batch lane can key its Files API cache on it. */
export function avatarKeyFor(gender: string): AvatarKey {
  return gender === 'male' ? 'male' : 'female';
}

export function sniffMimeType(bytes: Buffer): string {
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
}

export function loadAvatar(gender: string): { b64: string; mimeType: string } {
  const bytes = loadAvatarBytes(gender);
  return { b64: bytes.toString('base64'), mimeType: sniffMimeType(bytes) };
}

/** Raw bytes of the avatar — what the batch lane uploads to the Files API instead of inlining. */
export function loadAvatarBytes(gender: string): Buffer {
  return readFileSync(AVATAR_PATHS[avatarKeyFor(gender)]);
}

export type VtonCategory = 'topwear' | 'bottomwear' | 'dresses';

export const CATEGORY_MAP: Record<string, VtonCategory> = {
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

export function buildPrompt(
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

/**
 * Validated VTON recipe — matches the Google AI Studio settings that produce good try-ons:
 * deterministic output (temperature 0) so the model faithfully dresses the base avatar instead
 * of regurgitating the reference model, at portrait 9:16 / 2K.
 *
 * imageConfig field names verified against the v1beta gemini-3-pro-image (and the
 * gemini-2.5-flash-image fallback) API — both accept this shape. AI Studio batch documents the
 * same modality support as the interactive API, and a live 2K batch run confirmed it.
 */
export const VTON_GENERATION_CONFIG = {
  responseModalities: ['IMAGE'],
  temperature: 0,
  imageConfig: { aspectRatio: '9:16', imageSize: '2K' },
} as const;

/**
 * A fresh mutable copy of the same recipe, for SDK call sites whose types reject the readonly
 * arrays `as const` produces. Copying also keeps the shared constant un-mutatable by a caller.
 */
export function vtonGenerationConfig(): {
  responseModalities: string[];
  temperature: number;
  imageConfig: { aspectRatio: string; imageSize: string };
} {
  return {
    responseModalities: [...VTON_GENERATION_CONFIG.responseModalities],
    temperature: VTON_GENERATION_CONFIG.temperature,
    imageConfig: { ...VTON_GENERATION_CONFIG.imageConfig },
  };
}

export async function fetchImageAsBase64(url: string): Promise<{ b64: string; mimeType: string }> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`Garment image fetch failed ${resp.status}: ${url}`);
  const mimeType = resp.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  const buf = await resp.arrayBuffer();
  return { b64: Buffer.from(buf).toString('base64'), mimeType };
}

/**
 * Everything a VTON call needs except the garment bytes, which each lane sources differently:
 * the instant lane fetches them inline, the collector fetches them with bounded concurrency and
 * may reference the avatar by Files API URI rather than inlining it.
 */
export interface VtonRequestSpec {
  category: VtonCategory;
  system: string;
  prompt: string;
  avatar: { b64: string; mimeType: string };
  avatarKey: AvatarKey;
  generationConfig: typeof VTON_GENERATION_CONFIG;
}

/** Build the shared half of a VTON request. Throws on a product type the prompts do not cover. */
export function buildVtonRequest(input: TryonInput): VtonRequestSpec {
  const category = CATEGORY_MAP[input.productType];
  if (!category) throw new Error(`gemini_nano_banana: unsupported productType ${input.productType}`);

  const avatar = loadAvatar(input.gender);
  const { system, prompt } = buildPrompt(
    category,
    input.itemName || 'garment',
    input.techPack || '',
    input.garmentPhysics || '',
    input.colorAndFabric || '',
    input.gender,
  );

  return {
    category,
    system,
    prompt,
    avatar,
    avatarKey: avatarKeyFor(input.gender),
    generationConfig: VTON_GENERATION_CONFIG,
  };
}
