import {
  normalizeHostname,
  safeOriginFromUrl,
  normalizeUrl,
  dedupeByResolution,
} from './shared';

const PUMA_CDN_RE = /images\.puma\.com/i;
const PUMA_THUMB_RE = /w_\d{1,3},h_\d{1,3}(?!00)/;

function upgradePumaUrl(url: string): string {
  return url
    .replace(/f_auto,q_auto,b_rgb:fafafa[^/]*/i, 'f_auto,q_auto,b_rgb:fafafa,w_2000,h_2000')
    .replace(/w_\d+,h_\d+/g, 'w_2000,h_2000');
}

function scorePumaImage(url: string): number {
  const m = url.match(/w_(\d+),h_(\d+)/);
  if (m) return Number(m[1]) * 10_000 + Number(m[2]);
  return 0;
}

function pumaBaseKey(url: string): string {
  return url.replace(/w_\d+,h_\d+/g, 'w_X,h_X').toLowerCase();
}

function extractFromProductGallery(html: string, origin: string): string[] {
  const images: string[] = [];
  // #product-gallery or data-testid="product-gallery" section
  const galleryM = html.match(/(id="product-gallery"|data-testid="product-gallery")[\s\S]{0,20000}?(?=<\/section>|id="related|id="you-may)/i);
  const scope = galleryM ? galleryM[0] : html;

  const srcRe = /(?:src|data-src|srcset|data-srcset)="([^"]+)"/gi;
  for (const m of scope.matchAll(srcRe)) {
    const raw = m[1]!;
    for (const part of raw.split(',').map((p) => p.trim())) {
      const urlPart = part.split(/\s+/)[0] ?? '';
      if (!PUMA_CDN_RE.test(urlPart)) continue;
      const url = normalizeUrl(urlPart, origin);
      if (url) images.push(url);
    }
  }
  return images;
}

export function extractPumaImages(
  html: string,
  originalUrl: string,
  jsonImages: string[]
): string[] {
  const origin = safeOriginFromUrl(originalUrl, 'https://in.puma.com');
  const fromHtml = extractFromProductGallery(html, origin);

  let filtered = fromHtml
    .filter((u) => PUMA_CDN_RE.test(u))
    .filter((u) => !/\.(mp4|webm)(?:\?|$)/i.test(u))
    .filter((u) => !PUMA_THUMB_RE.test(u)); // exclude thumbnails with small dims

  const upgraded = filtered.map(upgradePumaUrl);
  const deduped = dedupeByResolution(upgraded, pumaBaseKey, scorePumaImage);
  if (deduped.length > 0) return deduped;

  // Fallback: filter JSON images to Puma CDN and upgrade
  return jsonImages
    .filter((u) => PUMA_CDN_RE.test(u))
    .map(upgradePumaUrl);
}

export const PUMA_HOSTNAMES = new Set(['puma.com', 'in.puma.com', 'eu.puma.com', 'us.puma.com', 'www.puma.com']);
export function isPuma(hostname: string): boolean {
  return PUMA_HOSTNAMES.has(normalizeHostname(hostname));
}
