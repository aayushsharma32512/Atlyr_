import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config/index';
import { withRetry } from '../../utils/retry';
import type { TryonInput, TryonOutput, TryonProvider } from '../../domain/types';

// ponytail: single unisex FASHN avatar (from vton_intern_pack/avatars/fashn/avatar_clean.png).
// No gendered variant exists yet — add one and branch on input.gender when it does.
const AVATAR_PATH = join(import.meta.dir, '../../../assets/fashn-avatar.png');
const AVATAR_B64 = readFileSync(AVATAR_PATH).toString('base64');

const CATEGORY_MAP: Record<string, string> = {
  topwear: 'tops',
  bottomwear: 'bottoms',
  dress: 'one-pieces',
};

async function fetchImageAsBase64(url: string): Promise<string> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`Garment image fetch failed ${resp.status}: ${url}`);
  const buf = await resp.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

export const fashnVtonProvider: TryonProvider = {
  name: 'fashn_vton',

  async run(input: TryonInput): Promise<TryonOutput> {
    if (!config.FASHN_VTON_API_URL) throw new Error('FASHN_VTON_API_URL is not set');
    const category = CATEGORY_MAP[input.productType];
    if (!category) throw new Error(`fashn_vton: unsupported productType ${input.productType}`);

    const garment_b64 = await fetchImageAsBase64(input.imageUrl);
    const start = Date.now();

    const image_b64 = await withRetry(async () => {
      const resp = await fetch(config.FASHN_VTON_API_URL!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Modal-Token': config.FASHN_VTON_API_KEY ?? '',
        },
        body: JSON.stringify({ person_b64: AVATAR_B64, garment_b64, category }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) throw new Error(`fashn_vton ${resp.status}: ${await resp.text()}`);
      const data = (await resp.json()) as { image_b64?: string };
      if (!data.image_b64) throw new Error('fashn_vton: no image_b64 in response');
      return data.image_b64;
    }, { retries: 3, backoffMs: 2000 });

    return {
      bytes: Buffer.from(image_b64, 'base64'),
      mimeType: 'image/png',
      inferenceMs: Date.now() - start,
      modelUsed: 'fashn_vton',
    };
  },
};
