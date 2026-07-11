import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config/index';
import { withRetry } from '../../utils/retry';
import type { TryonInput, TryonOutput, TryonProvider } from '../../domain/types';

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

const BG_HEX = '#808080';

// ── V-ToN prompts ──────────────────────────────────────────────────────────
// Ported (front-view only) from vton_intern_pack/code/ghost_mannequin/experiment_vton_prompts.py,
// validated recipe per vton_intern_pack/02_MODEL_LEARNINGS.md §3.

const VTON_SYSTEM_BASE = `\
You are a virtual try-on rendering engine. Your task is to dress the provided avatar body in the specified garment with photorealistic accuracy.

STRICT RULES:
1. POSE LOCK / GEOMETRY LOCK / BODY LOCK: The avatar's pose, body position, limb placement, proportions, body shape, build, and gender presentation in image_0 must remain EXACTLY unchanged. The outer silhouette and camera framing of your output MUST match image_0 precisely. Do not rotate, shift, re-angle, masculinize, feminize, or re-proportion the figure in any way. The camera stays at 0° azimuth — direct front view only.
2. GARMENT SOURCE: Render the garment from image_1 onto the avatar's body. Match the exact color, texture, pattern, and all hardware precisely.
3. FABRIC PHYSICS: Apply realistic gravity and tension at seams. Natural fold behavior based on fabric weight and fit described in the GARMENT SPEC.
4. OUTPUT: Photorealistic e-commerce product photoshoot. Plain seamless flat background of solid color ${BG_HEX} — NO floor line, NO wall corner, NO props, NO visible light fixtures/softboxes/lamps/reflectors/stands/equipment of any kind in frame. Even, soft, shadowless lighting. No harsh shadows. Fabric texture and surface detail clearly visible.
5. SOLID BODY: The avatar body is solid beneath the clothing. Do NOT make any part of the garment hollow or transparent.
6. PRINT & DETAIL FIDELITY: Reproduce EVERY print motif, pattern repeat, embroidery, applique, trim, and text/logo from image_1 at the correct scale, density, color, and placement. Do not simplify, blur, fade, sparsen, recolor, or omit any pattern element.
7. EDGE CLARITY: Render the garment silhouette with crisp, in-focus edges and high contrast between garment, body, and background. No motion blur, no soft focus at the boundaries.
8. FEATURELESS HEAD: The avatar is an abstract gray display mannequin, NOT a person. The head is a smooth, blank, bald gray ovoid — absolutely NO face, no eyes, no nose, no mouth, no eyebrows, no hair, no wig, no realistic skin. All exposed body surface stays matte neutral gray. Never render a human likeness.
9. BACKGROUND PRESERVATION: The background in image_0 is ALREADY the correct flat neutral gray (${BG_HEX}). Do NOT repaint, recolor, tint, or re-light it. Copy the background of image_0 into your output pixel-for-pixel unchanged. Your edit is LOCAL to the avatar's body region only — everything outside the figure stays exactly as it is in image_0. Match the EXPOSURE and overall brightness of image_0 — do not darken the scene to suit a dark garment.
10. CONSTRUCTION LOCK: Reproduce the garment's construction EXACTLY as shown in image_1 — collar/waistband type, closures, cuffs, hems. Count construction elements (buttons, ties, straps) in image_1 and render the SAME number in the SAME positions. Do NOT invent, add, restyle, or omit any construction element.
11. GARMENT ISOLATION: Transfer ONLY the target garment from image_1. If the reference in image_1 wears any OTHER clothing or accessories, do NOT transfer those. Every body area not covered by the target garment stays bare, matte neutral gray. Exactly ONE garment in the output.`;

// Verbatim per-category "front" system + prompt, transcribed from VTON_PROMPTS in
// experiment_vton_prompts.py (back-view variants dropped — this pipeline only
// generates a single front image). {BODY_TYPE_DESC} is filled exactly as
// run_stage2_once does for a front view; {GARMENT_SPEC_BLOCK} mirrors
// build_garment_spec() — tech_pack slot lines + color/fabric + physics paragraph,
// all sourced from the garment_summary artifact.
const BODY_TYPE_DESC = 'Standard proportions mannequin, gender-neutral posture.';

const CATEGORY_PROMPTS: Record<VtonCategory, { system: string; prompt: string }> = {
  topwear: {
    system: `
TOPWEAR SPECIFIC:
- Collar/neckline must sit naturally on the avatar's neck — no floating, no gap.
- Sleeve ends terminate exactly at the avatar's wrist position.
- Hem falls at the anatomically correct level relative to the avatar's hip.
- The shoulder seam aligns with the avatar's shoulder break point.`,
    prompt: `\
Images:
- image_0 (AVATAR — POSE LOCKED): This avatar's exact silhouette, pose, and proportions are the rigid form. Dress this figure. Do not change the body in any way.
- image_1 (GARMENT SOURCE): Dress the avatar in this exact topwear. Match all color, texture, pattern, and hardware precisely.

Body Type:
${BODY_TYPE_DESC}

{GARMENT_SPEC_BLOCK}

Rendering Rules:
1. DIRECT FRONT VIEW. Camera at 0° azimuth, perfectly level. Shoulders perfectly leveled.
2. GEOMETRY LOCK: Avatar pose, body position, and camera framing from image_0 are FIXED. No rotation, no shift, no re-angling.
3. Collar sits on avatar neck naturally; sleeve cuffs at avatar wrists.
4. Fabric weight drives drape — heavy fabric structured, light fabric flowing.
5. All surface details (buttons, zippers, graphics, stitching) rendered photorealistic.
6. Plain seamless flat ${BG_HEX} background — no props, no visible lighting equipment. Even soft shadowless lighting. Product photoshoot quality.

FRAMING ANCHOR: Figure vertically centered; vertical centerline bisects the body symmetrically; both shoulders at identical height and equal distance from the centerline. Camera lens at chest height, perpendicular to the figure — true front elevation, no tilt, no perspective foreshortening, no lean, no twist. Head near top of frame; full garment hem inside frame.

Item: {ITEM_NAME}

NEGATIVE: ghost mannequin, hollow collar void, empty neck hole, invisible body, floating fabric, disembodied garment, side view, 3/4 view, three-quarter angle, profile shot, rotated pose, angled view, turned body, two figures, side by side, split image, comparison image, diptych, before after, multiple avatars, duplicate figure, human face, eyes, hair, realistic skin, sculpted facial features, molded mannequin face, dark background, gradient background, vignette, darkened corners, spotlight glow, lighting falloff, studio backdrop gradient, purple background, violet background, lavender background, blue background, pink background, tinted background, color cast, hue shift, dark moody lighting, low-key lighting, dramatic lighting, cinematic relighting, flat illustration, vector art, 2D render, cel shading, cartoon, flat unshaded fabric, faded print, washed-out pattern, simplified motif, sparse pattern, garbled text, blurred embroidery, invented waistband, added trim, restyled collar, extra ruffles, redesigned garment, added panels, invented stitching.`,
  },
  bottomwear: {
    system: `
BOTTOMWEAR SPECIFIC:
- Waistband sits at the correct anatomical rise level — high/mid/low as per garment type.
- Leg opening hems terminate at the correct ankle/calf/knee/hip level precisely.
- Fabric tension wrinkles through thigh/knee follow fabric weight and fit.
- Belt loops, fly hardware, and pocket openings rendered accurately.`,
    prompt: `\
Images:
- image_0 (AVATAR — POSE LOCKED): Avatar's exact lower-body pose and proportions are fixed.
- image_1 (GARMENT SOURCE): Dress the avatar in this exact bottomwear.

Body Type:
${BODY_TYPE_DESC}

{GARMENT_SPEC_BLOCK}

Rendering Rules:
1. DIRECT FRONT VIEW. Camera at 0° azimuth. Both legs visible, symmetrical framing.
2. GEOMETRY LOCK: Avatar pose from image_0 is FIXED. No rotation, no shift.
3. RISE LOCK: Waistband sits at the garment's true rise. A high-waist/high-rise garment sits at the natural waist (at or above the navel) — do NOT drop it to the hips or expose midriff. Match the rise shown in the garment reference exactly.
4. Trouser/skirt hems reach the correct ankle/floor/knee level — do not crop.
5. All hardware (zippers, buttons, belt loops) photorealistic.
6. STITCHING & TRIM LOCK: Match the thread color and stitch prominence of image_1 exactly. Do NOT add contrast stitching, chains, gold trim, embroidery, studs, or any decorative element not present in image_1. Leg-opening hems are plain finished exactly as in image_1 — NO chains, beads, embroidery, or trim at the hems. Wash pattern, wash color/value, and fade intensity must match image_1 — do not darken the wash toward indigo, do not amplify whiskering or knee fading.
7. LEG SILHOUETTE LOCK: Preserve the exact leg width and silhouette from image_1. A wide-leg garment stays equally wide from hip to hem. Do NOT slim, taper, straighten, or reshape the legs.
8. Plain seamless flat ${BG_HEX} background — no props, no visible lighting equipment. Even soft shadowless lighting. Product photoshoot quality.

FRAMING ANCHOR: Figure vertically centered; vertical centerline bisects the body symmetrically; both hips at identical height and equal distance from the centerline. Camera lens at hip height, perpendicular to the figure — true front elevation, no tilt, no perspective foreshortening, no lean, no twist. Full hem inside frame; no cropping at waist or hem.

Item: {ITEM_NAME}

NEGATIVE: ghost mannequin, floating fabric, hollow legs, side view, 3/4 view, angled pose, split image, duplicate figure, cropped hem, cut-off legs, low-rise rendering of a high-waist garment, dropped waistband, exposed midriff, human face, eyes, hair, realistic skin, sculpted facial features, molded mannequin face, dark background, gradient background, vignette, darkened corners, spotlight glow, lighting falloff, studio backdrop gradient, purple background, violet background, lavender background, blue background, pink background, tinted background, color cast, hue shift, dark moody lighting, low-key lighting, dramatic lighting, cinematic relighting, flat illustration, vector art, 2D render, cel shading, cartoon, flat unshaded fabric, faded print, washed-out pattern, simplified motif, garbled text, invented waistband, added trim, extra ruffles, redesigned garment, added panels, invented stitching, gold chain trim, contrast stitching, decorative embellishment, added embroidery, studs, chain trim at hems, beaded hem, embellished hem, matching top, added top, knit top on torso, second garment, coordinated set, tapered legs, slimmed legs, skinny rendering of wide-leg jeans, narrowed silhouette.`,
  },
  dresses: {
    system: `
FLAT FRONT PROJECTION: The avatar in image_0 is a flat-on, perfectly symmetrical manikin facing the camera at 0° yaw. Both shoulders are at identical height and identical distance from the vertical center-line. Replicate this exact bilateral symmetry — no lean, no twist.

DRESSES SPECIFIC:
- Neckline sits exactly at the avatar's neckline — no floating, no gap.
- Bodice seams follow the avatar's torso geometry precisely.
- Skirt hem falls at the correct midi/mini/maxi level with realistic gravity.
- Side seams are perfectly vertical from armhole to hem — no angling.`,
    prompt: `\
Images:
- image_0 (AVATAR — POSE LOCKED): This avatar's exact silhouette, pose, and proportions are the rigid form. Dress this figure. Do not change the body in any way.
- image_1 (GARMENT SOURCE): Dress the avatar in this exact dress. Match all color, texture, pattern, and hardware precisely.

Body Type:
${BODY_TYPE_DESC}

{GARMENT_SPEC_BLOCK}

Rendering Rules:
1. The figure is bilaterally symmetrical left-to-right. Both shoulders at equal height.
2. DIRECT FRONT VIEW. Camera at 0° azimuth, perfectly level. No 3/4 angle.
3. GEOMETRY LOCK: Avatar pose, body position, and camera framing from image_0 are FIXED.
4. Neckline, bodice seams, and skirt fall at anatomically correct positions.
5. Skirt hem must reach the correct length — do not crop. Full hem visible in frame.
6. Fabric drape and sheen match the physics description exactly.
7. Plain seamless flat ${BG_HEX} background — no props, no visible lighting equipment. Even soft shadowless lighting. Product photoshoot quality.

FRAMING ANCHOR: Figure vertically centered; vertical centerline bisects the body symmetrically; both shoulders at identical height and equal distance from the centerline. Camera lens at chest height, perpendicular to the figure — true front elevation, no tilt, no perspective foreshortening, no lean, no twist. Head near top of frame; full skirt hem inside frame.

Item: {ITEM_NAME}

NEGATIVE: leaning figure, twisted torso, asymmetric shoulders, perspective distortion, ghost mannequin, hollow collar void, empty neck hole, floating fabric, side view, 3/4 view, three-quarter angle, profile shot, rotated pose, angled view, two figures, split image, before after, duplicate figure, cropped hem, human face, eyes, hair, realistic skin, sculpted facial features, molded mannequin face, dark background, gradient background, vignette, darkened corners, spotlight glow, lighting falloff, studio backdrop gradient, purple background, violet background, lavender background, blue background, pink background, tinted background, color cast, hue shift, dark moody lighting, low-key lighting, dramatic lighting, cinematic relighting, flat illustration, vector art, 2D render, cel shading, cartoon, flat unshaded fabric, faded print, washed-out pattern, simplified motif, sparse pattern, garbled text, blurred embroidery, invented waistband, added trim, restyled collar, extra ruffles, redesigned garment, added panels, invented stitching.`,
  },
};

function buildPrompt(
  category: VtonCategory,
  itemName: string,
  techPack: string,
  garmentPhysics: string,
  colorAndFabric: string,
): { system: string; prompt: string } {
  const bundle = CATEGORY_PROMPTS[category];
  const system = VTON_SYSTEM_BASE + bundle.system;
  const garmentSpecBlock = [
    "GARMENT SPEC (image_1 is the garment's visual truth — where any line below conflicts with image_1, follow image_1):",
    techPack,
    colorAndFabric && `Color & Fabric: ${colorAndFabric}`,
    garmentPhysics,
  ].filter(Boolean).join('\n\n');
  const prompt = bundle.prompt
    .replace('{GARMENT_SPEC_BLOCK}', garmentSpecBlock)
    .replace('{ITEM_NAME}', itemName);

  return { system, prompt };
}

async function callGemini(systemInstruction: string, prompt: string, avatarB64: string, avatarMime: string, garmentB64: string, garmentMime: string): Promise<{ b64: string; mimeType: string }> {
  if (!config.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_IMAGE_MODEL}:generateContent?key=${config.GOOGLE_API_KEY}`;
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

  if (!resp.ok) throw new Error(`gemini_nano_banana ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] }; finishReason?: string }[];
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData)?.inlineData;
  if (!imagePart) {
    const finishReason = data.candidates?.[0]?.finishReason ?? 'unknown';
    throw new Error(`gemini_nano_banana: no image in response (finishReason=${finishReason})`);
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
    );

    const start = Date.now();
    const image = await withRetry(
      () => callGemini(system, prompt, avatar.b64, avatar.mimeType, garment.b64, garment.mimeType),
      { retries: 3, backoffMs: 1000 },
    );

    return {
      bytes: Buffer.from(image.b64, 'base64'),
      mimeType: image.mimeType,
      inferenceMs: Date.now() - start,
      modelUsed: 'gemini_nano_banana',
    };
  },
};
