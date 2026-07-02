import { createHash } from 'crypto';

export function computeDedupeKey(productUrl: string): string {
  return createHash('md5').update(productUrl.trim().toLowerCase()).digest('hex');
}
