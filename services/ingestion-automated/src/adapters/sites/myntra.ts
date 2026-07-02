import {
  normalizeHostname,
  safeOriginFromUrl,
  normalizeUrl,
  decodeHtmlEntities,
  dedupeByResolution,
} from './shared';

const MYNTRA_CDN_RE = /myntassets\.com\/dcp\/catalog\/pc\//i;
const STYLE_ID_RE = /[?&](?:style_id|styleId|id)=(\d+)/;

function getMyntraStyleId(url: string): string | null {
  try {
    const m = url.match(STYLE_ID_RE);
    if (m) return m[1] ?? null;
    const path = new URL(url).pathname;
    const pm = path.match(/\/(\d{5,})\//);
    return pm ? (pm[1] ?? null) : null;
  } catch { return null; }
}

function scoreMyntraImage(url: string): number {
  const m = url.match(/h_(\d+),w_(\d+)/);
  if (m) return Number(m[1]) * 10_000 + Number(m[2]);
  return 0;
}

function myntraBaseKey(url: string): string {
  const withoutQuery = url.split('?')[0] ?? url;
  return withoutQuery.toLowerCase().replace(/h_\d+,w_\d+,q_\d+/g, 'h_X,w_X,q_X');
}

export function extractMyntraImages(
  html: string,
  originalUrl: string,
  jsonImages: string[]
): string[] {
  const origin = safeOriginFromUrl(originalUrl, 'https://www.myntra.com');
  const styleId = getMyntraStyleId(originalUrl);

  // Collect candidate URLs from HTML attribute soup
  const candidates: string[] = [];

  // data-src / src / content / data-image patterns
  for (const attr of ['data-src', 'src', 'content', 'data-image', 'data-original']) {
    const re = new RegExp(`${attr}=["']([^"']+)["']`, 'gi');
    for (const m of html.matchAll(re)) {
      const url = normalizeUrl(decodeHtmlEntities(m[1]!), origin);
      if (url && MYNTRA_CDN_RE.test(url)) candidates.push(url);
    }
  }

  // image-grid-container JSON blob (Next.js __NEXT_DATA__ or inline JSON)
  for (const m of html.matchAll(/\\"url\\":\\"([^"\\]+)\\"/g)) {
    const url = decodeHtmlEntities(m[1]!.replace(/\\\//g, '/'));
    const norm = normalizeUrl(url, origin);
    if (norm && MYNTRA_CDN_RE.test(norm)) candidates.push(norm);
  }

  let filtered = candidates.filter((u) => {
    const lower = u.toLowerCase();
    if (/\.(mp4|webm|mov)(?:\?|$)/i.test(lower)) return false;
    if (!/\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(lower)) return false;
    return true;
  });

  // If we have a style_id, only keep images that contain it
  if (styleId && filtered.some((u) => u.includes(styleId))) {
    filtered = filtered.filter((u) => u.includes(styleId));
  }

  const deduped = dedupeByResolution(filtered, myntraBaseKey, scoreMyntraImage);
  if (deduped.length > 0) return deduped;

  // Fallback: filter JSON images to CDN pattern
  return jsonImages.filter((u) => MYNTRA_CDN_RE.test(u));
}

export const MYNTRA_HOSTNAMES = new Set(['myntra.com', 'www.myntra.com']);
export function isMyntra(hostname: string): boolean {
  return MYNTRA_HOSTNAMES.has(normalizeHostname(hostname));
}
