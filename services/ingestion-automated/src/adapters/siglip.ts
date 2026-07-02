import { config } from '../config/index';
import { withRetry } from '../utils/retry';

export type ImageLabel =
  | 'model_front'
  | 'flatlay_front'
  | 'model_side'
  | 'flatlay_back'
  | 'model_back'
  | 'detail_texture'
  | 'unknown';

export interface SigLIPClassification {
  imageUrl: string;
  label: ImageLabel;
  confidence: number;
}

// Priority order for VTON image selection (lower index = higher priority)
export const LABEL_PRIORITY: ImageLabel[] = [
  'model_front',
  'flatlay_front',
  'model_side',
  'flatlay_back',
  'model_back',
  'detail_texture',
];

// SigLIP bulk classify endpoint.
// Expected request:  POST { images: string[] }
// Expected response: { results: Array<{ image_url: string, label: string, confidence: number }> }
export async function classifyImages(imageUrls: string[]): Promise<SigLIPClassification[]> {
  if (!config.SIGLIP_ENDPOINT) throw new Error('SIGLIP_ENDPOINT is not set');
  if (!config.SIGLIP_API_KEY)  throw new Error('SIGLIP_API_KEY is not set');

  return withRetry(
    async () => {
      const resp = await fetch(config.SIGLIP_ENDPOINT!, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.SIGLIP_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ images: imageUrls }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`SigLIP error ${resp.status}: ${body}`);
      }

      const payload = await resp.json() as { results: Array<{ image_url: string; label: string; confidence: number }> };
      const results = payload.results ?? [];

      return results.map((r) => ({
        imageUrl:   r.image_url,
        label:      (LABEL_PRIORITY.includes(r.label as ImageLabel) ? r.label : 'unknown') as ImageLabel,
        confidence: r.confidence,
      }));
    },
    { retries: 2, backoffMs: 1000 }
  );
}

export function selectVtonImage(
  classifications: SigLIPClassification[],
  preference: { type: string } | null
): SigLIPClassification | null {
  if (classifications.length === 0) return null;

  let candidates = classifications.filter((c) => c.label !== 'unknown');
  if (candidates.length === 0) candidates = classifications;

  // If admin specified a preference, filter to matching labels first
  if (preference?.type === 'flat_lay') {
    const flatlay = candidates.filter((c) => c.label === 'flatlay_front' || c.label === 'flatlay_back');
    if (flatlay.length > 0) {
      return flatlay.reduce((best, c) => c.confidence > best.confidence ? c : best);
    }
  }

  // Default priority-based selection
  for (const label of LABEL_PRIORITY) {
    const matches = candidates.filter((c) => c.label === label);
    if (matches.length > 0) {
      return matches.reduce((best, c) => c.confidence > best.confidence ? c : best);
    }
  }

  // Last resort: highest confidence of anything
  return candidates.reduce((best, c) => c.confidence > best.confidence ? c : best);
}
