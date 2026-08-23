import { test, expect, describe } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  avatarKeyFor,
  buildPrompt,
  buildVtonRequest,
  CATEGORY_MAP,
  loadAvatar,
  sniffMimeType,
  VTON_GENERATION_CONFIG,
} from './vton-request';
import type { TryonInput } from '../../domain/types';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Golden hashes, not literal strings: the system prompt carries meaningful trailing whitespace
 * that an editor or a lint rule would silently strip, and a hash notices that where an inline
 * string comparison in a source file cannot.
 *
 * Captured from the pre-extraction gemini-vton.adapter.ts and cross-checked across all 48
 * (category × gender × physics-shape) combinations at the time of the extraction. Both lanes
 * build from this module, so a change here changes both — if one of these fails, the prompt
 * really did change and every downstream comparison of batch-vs-instant output is invalid until
 * the hash is deliberately re-blessed.
 */
const GOLDEN_SYSTEM = '5694b57c89770c4ce32246c0caf908d2bab64d617a355fa131b75fd50621245c';
const GOLDEN_PROMPTS: Record<string, string> = {
  'female/topwear': '6e1ef71651eadc75cb1097cb79adf185a1418810ba32eb29e8067db7b9e556d0',
  'female/bottomwear': 'e50520afec34114d52fbfd10be6d6808170aeb11df16b9c7e261bc192849ceac',
  'female/dresses': '54643f9adf9c80df6d23af448ea737428a7065ec4f1b288ef3befcd961b8e45b',
  'male/topwear': '6e1ef71651eadc75cb1097cb79adf185a1418810ba32eb29e8067db7b9e556d0',
  'male/bottomwear': '4d32249611b259ead0dad52d51555a928eb0ca2e523cd7825f8d43100d5be34a',
  'male/dresses': '54643f9adf9c80df6d23af448ea737428a7065ec4f1b288ef3befcd961b8e45b',
};

const PHYSICS = '[GARMENT_PHYSICS] Front view of a ribbed cotton tee, medium weight, opaque.';

describe('prompt parity with the pre-extraction adapter', () => {
  for (const [key, goldenPrompt] of Object.entries(GOLDEN_PROMPTS)) {
    const [gender, category] = key.split('/') as [string, 'topwear' | 'bottomwear' | 'dresses'];
    test(`${key} builds byte-identical system and prompt`, () => {
      const { system, prompt } = buildPrompt(category, 'Item', 'TECH', PHYSICS, 'COLOR', gender);
      expect(sha(system)).toBe(GOLDEN_SYSTEM);
      expect(sha(prompt)).toBe(goldenPrompt);
    });
  }

  test('the system prompt keeps its trailing whitespace', () => {
    const { system } = buildPrompt('topwear', 'Item', '', '', '', 'female');
    expect(system).toContain('body proportions. \n');
    expect(system).toContain('retain the pose. \n');
  });
});

describe('buildPrompt behaviours the two lanes must share', () => {
  test('strips the [GARMENT_PHYSICS] tag', () => {
    const { prompt } = buildPrompt('topwear', 'Item', '', '[GARMENT_PHYSICS] a plain description', '', 'female');
    expect(prompt).not.toContain('[GARMENT_PHYSICS]');
    expect(prompt).toContain('a plain description');
  });

  // The summary often opens with boilerplate before "view of"; everything before it is noise.
  // Note the cut lands ON "view of", so a leading "Front"/"Back" is dropped with the preamble —
  // pinned here because it is the shipped behaviour both lanes must share, not because it is ideal.
  test('truncates everything up to the first "view of"', () => {
    const { prompt } = buildPrompt('topwear', 'Item', '', 'PREAMBLE NOISE Front view of a shirt', '', 'female');
    expect(prompt).toContain('view of a shirt');
    expect(prompt).not.toContain('PREAMBLE NOISE');
    expect(prompt).not.toContain('Front view of');
  });

  test('keeps physics verbatim when it has no "view of" marker', () => {
    const { prompt } = buildPrompt('topwear', 'Item', '', 'no marker at all here', '', 'female');
    expect(prompt).toContain('no marker at all here');
  });

  test('omits the empty spec line rather than emitting a dangling header', () => {
    const { prompt } = buildPrompt('topwear', 'Item', '', '', '', 'female');
    expect(prompt).toContain("GARMENT SPEC (image_2 is the garment's visual truth");
    expect(prompt).not.toContain('\n\n\n\n');
  });

  // No male dress prompt exists; falling through to the female bundle is the shipped behaviour.
  test('a male dress falls back to the female prompt', () => {
    expect(sha(buildPrompt('dresses', 'Item', 'TECH', PHYSICS, 'COLOR', 'male').prompt))
      .toBe(GOLDEN_PROMPTS['female/dresses']);
  });

  test('an unrecognised gender is treated as female', () => {
    expect(sha(buildPrompt('topwear', 'Item', 'TECH', PHYSICS, 'COLOR', 'unisex').prompt))
      .toBe(GOLDEN_PROMPTS['female/topwear']);
  });
});

describe('avatar selection', () => {
  // There is no unisex avatar in the pack — anything that is not male resolves to female.
  test('only "male" gets the male avatar', () => {
    expect(avatarKeyFor('male')).toBe('male');
    expect(avatarKeyFor('female')).toBe('female');
    expect(avatarKeyFor('unisex')).toBe('female');
    expect(avatarKeyFor('')).toBe('female');
  });

  // The male asset is JPEG bytes behind a .png name; trusting the extension mislabels the part.
  test('mime type comes from the magic number, not the file extension', () => {
    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
  });

  test('loads the real assets and labels them by their actual bytes', () => {
    const female = loadAvatar('female');
    const male = loadAvatar('male');
    expect(female.b64.length).toBeGreaterThan(0);
    expect(male.b64.length).toBeGreaterThan(0);
    expect(loadAvatar('unisex').b64).toBe(female.b64);
    expect(['image/png', 'image/jpeg']).toContain(female.mimeType);
    expect(['image/png', 'image/jpeg']).toContain(male.mimeType);
  });
});

describe('buildVtonRequest', () => {
  const input = (over: Partial<TryonInput> = {}): TryonInput => ({
    imageUrl: 'https://example.com/g.jpg',
    gender: 'female',
    productType: 'topwear',
    productSubType: 't-shirt',
    techPack: 'TECH',
    garmentPhysics: PHYSICS,
    itemName: 'Item',
    colorAndFabric: 'COLOR',
    ...over,
  });

  test('maps product types to prompt categories', () => {
    expect(CATEGORY_MAP).toEqual({ topwear: 'topwear', bottomwear: 'bottomwear', dress: 'dresses' });
    expect(buildVtonRequest(input({ productType: 'dress' })).category).toBe('dresses');
  });

  test('assembles the same prompt the builder produces directly', () => {
    const spec = buildVtonRequest(input());
    expect(sha(spec.system)).toBe(GOLDEN_SYSTEM);
    expect(sha(spec.prompt)).toBe(GOLDEN_PROMPTS['female/topwear']);
    expect(spec.avatarKey).toBe('female');
  });

  test('substitutes a placeholder name when the summary produced none', () => {
    expect(buildVtonRequest(input({ itemName: '' })).prompt).toBe(buildVtonRequest(input({ itemName: 'x' })).prompt);
  });

  test('rejects a product type the prompts do not cover', () => {
    expect(() => buildVtonRequest(input({ productType: 'footwear' }))).toThrow(/unsupported productType footwear/);
  });

  // The batch lane's economics assume 2K output; a silent drop to 1K would halve the product.
  test('pins the deterministic 9:16 / 2K recipe', () => {
    expect(VTON_GENERATION_CONFIG).toEqual({
      responseModalities: ['IMAGE'],
      temperature: 0,
      imageConfig: { aspectRatio: '9:16', imageSize: '2K' },
    });
    expect(buildVtonRequest(input()).generationConfig).toBe(VTON_GENERATION_CONFIG);
  });
});
