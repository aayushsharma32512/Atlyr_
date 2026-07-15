import { normalizeHostname } from './shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeOriginFromUrl(url: string, defaultOrigin = 'https://www.nykaafashion.com'): string {
  try {
    return new URL(url).origin;
  } catch {
    return defaultOrigin;
  }
}

function normalizeUrl(rawUrl: string, baseOrigin: string): string | null {
  const cleaned = (rawUrl || '').trim().replace(/&amp;/g, '&');
  if (!cleaned) return null;

  if (cleaned.startsWith('//')) return `https:${cleaned}`;
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) return cleaned;
  if (cleaned.startsWith('/')) return `${baseOrigin}${cleaned}`;

  return `${baseOrigin}/${cleaned}`;
}

function decodeHtmlEntities(value: string): string {
  if (!value) return value;
  return value.replace(/&quot;|\\u0026quot;|&amp;|\\u0026amp;|\\u003d|\\u002f/g, (token) => {
    if (token === '&quot;' || token === '\\u0026quot;') return '';
    if (token === '&amp;' || token === '\\u0026amp;') return '&';
    if (token === '\\u003d') return '=';
    if (token === '\\u002f') return '/';
    return token;
  });
}

function looksLikeNykaaImageUrl(url: string): boolean {
  const lower = url.toLowerCase();

  // Exclude videos
  if (lower.includes('/videos/')) return false;
  if (/\.(mp4|webm|mov|avi)(?:\?|$)/i.test(lower)) return false;

  // Must be a valid image extension
  if (!/\.(jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(lower)) return false;

  // Primary CDN patterns for Nykaa Fashion
  if (lower.includes('adn-static1.nykaa.com/nykdesignstudio-images/')) return true;
  if (lower.includes('adn-static1.nykaa.com/') && lower.includes('/pub/media/catalog/')) return true;
  if (lower.includes('images-static.nykaa.com/')) return true;
  return false;
}

function parseSrcsetLargest(srcset: string): string | null {
  const parts = srcset
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  let bestUrl: string | null = null;
  let bestScore = -1;
  for (const part of parts) {
    const tokens = part.split(/\s+/).filter(Boolean);
    const url = tokens[0];
    const descriptor = tokens[1] ?? '';
    let score = 0;
    
    const mW = descriptor.match(/^(\d+)w$/i);
    if (mW) score = Number(mW[1]);
    
    const mX = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
    if (!mW && mX) score = Math.floor(Number(mX[1]) * 1000);
    
    if (score > bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }
  return bestUrl;
}

function extractBestUrlFromImgTag(tag: string, baseOrigin: string): string | null {
  const tag_decoded = decodeHtmlEntities(tag);

  const srcsetMatch = tag_decoded.match(/srcset=["']([^"']+)["']/i);
  if (srcsetMatch) {
    const srcsetRaw = decodeHtmlEntities(srcsetMatch[1]);
    const largest = parseSrcsetLargest(srcsetRaw);
    if (largest) {
      const normalized = normalizeUrl(decodeHtmlEntities(largest), baseOrigin);
      if (normalized) return normalized;
    }
  }

  const srcMatch = tag_decoded.match(/src=["']([^"']+)["']/i);
  if (srcMatch) {
    const srcRaw = decodeHtmlEntities(srcMatch[1]);
    const normalized = normalizeUrl(srcRaw, baseOrigin);
    if (normalized) return normalized;
  }

  return null;
}

function extractNykaaGalleryUrlsFromHtml(html: string | undefined, baseOrigin: string): string[] {
  if (!html) return [];

  const urls: string[] = [];

  // Method 1 (Primary): Look for images with class containing "pdp-selector-img"
  const selectorImgMatches = html.matchAll(/<img[^>]*class=["'][^"']*pdp-selector-img[^"']*["'][^>]*>/gi);
  for (const match of selectorImgMatches) {
    const tag = match[0];
    const urlFromTag = extractBestUrlFromImgTag(tag, baseOrigin);
    if (urlFromTag && looksLikeNykaaImageUrl(urlFromTag)) {
      urls.push(urlFromTag);
    }
  }

  // Method 2 (Fallback): Look for images with data-at="pdp-product-image"
  if (!urls.length) {
    const productImageMatches = html.matchAll(/<img[^>]*data-at=["']pdp-product-image["'][^>]*>/gi);
    for (const match of productImageMatches) {
      const tag = match[0];
      const urlFromTag = extractBestUrlFromImgTag(tag, baseOrigin);
      if (urlFromTag && looksLikeNykaaImageUrl(urlFromTag)) {
        urls.push(urlFromTag);
      }
    }
  }

  // Method 3: Fallback - extract all Nykaa CDN images from a reasonable gallery section
  if (!urls.length) {
    let galleryStart = html.indexOf('css-la88oxd');
    if (galleryStart < 0) galleryStart = html.indexOf('pdp-selector-img');
    if (galleryStart < 0) galleryStart = html.indexOf('pdp-product-image');

    if (galleryStart >= 0) {
      const gallerySlice = html.slice(galleryStart, Math.min(html.length, galleryStart + 200_000));
      const allImgMatches = gallerySlice.matchAll(/<img[^>]+>/gi);
      for (const match of allImgMatches) {
        const tag = match[0];
        const urlFromTag = extractBestUrlFromImgTag(tag, baseOrigin);
        if (urlFromTag && looksLikeNykaaImageUrl(urlFromTag)) {
          urls.push(urlFromTag);
        }
      }
    }
  }

  return urls;
}

function parseNykaaResolutionScore(url: string): number {
  try {
    const parsed = new URL(url);
    const trw = parsed.searchParams.get('trw') || parsed.searchParams.get('tr');
    if (trw) {
      const wM = trw.match(/w-(\d+)/i) || [null, trw];
      if (wM && wM[1] && /^\d+$/.test(wM[1])) return Number(wM[1]) * 1_000_000;
    }
    const rnd = parsed.searchParams.get('rnd');
    if (rnd && /^\d+$/.test(rnd)) return Number(rnd);
    return 0;
  } catch {
    return 0;
  }
}

function normalizeImageUrls(value: unknown): string[] {
  const urls: string[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') urls.push(entry);
      else if (isRecord(entry) && typeof entry['url'] === 'string') urls.push(entry['url']);
    }
  } else if (isRecord(value) && Array.isArray(value['images'])) {
    return normalizeImageUrls(value['images']);
  }
  return Array.from(new Set(urls));
}

export function applyNykaaDeterministicImageFilter(params: {
  originalUrl: string;
  finalUrl?: string;
  json: Record<string, unknown>;
  html?: string;
  rawHtml?: string;
}): { json: Record<string, unknown>; imageUrls: string[] } {
  const { originalUrl, finalUrl, json, html, rawHtml } = params;
  const baseOrigin = safeOriginFromUrl(finalUrl ?? originalUrl);

  const htmlGallery = extractNykaaGalleryUrlsFromHtml(rawHtml ?? html, baseOrigin);

  const candidates: string[] = [];
  if (htmlGallery.length) candidates.push(...htmlGallery);

  const jsonImages = normalizeImageUrls(json['images']);
  if (jsonImages.length) candidates.push(...jsonImages);

  const normalizedCandidates = candidates
    .map((url) => normalizeUrl(decodeHtmlEntities(url), baseOrigin))
    .filter((url): url is string => Boolean(url) && looksLikeNykaaImageUrl(url as string));

  const bestByKey = new Map<string, { url: string; score: number; firstIndex: number }>();
  normalizedCandidates.forEach((url, index) => {
    const withoutTr = url.split('?')[0] ?? url;
    const key = withoutTr.toLowerCase();
    const score = parseNykaaResolutionScore(url);
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, { url, score, firstIndex: index });
      return;
    }
    if (score > existing.score) {
      bestByKey.set(key, { url, score, firstIndex: existing.firstIndex });
    }
  });

  const ordered = Array.from(bestByKey.values())
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map((entry) => entry.url);

  const out: Record<string, unknown> = { ...json };
  out['images'] = ordered.map((url, idx) => ({
    url,
    sort_order_suggestion: idx,
    is_primary_suggestion: idx === 0
  }));

  return { json: out, imageUrls: ordered };
}

export function extractNykaaImages(
  html: string,
  originalUrl: string,
  jsonImages: string[]
): string[] {
  const res = applyNykaaDeterministicImageFilter({
    originalUrl,
    json: { images: jsonImages },
    html
  });
  return res.imageUrls;
}

export const NYKAA_HOSTNAMES = new Set(['nykaa.com', 'www.nykaa.com', 'nykaafashion.com', 'www.nykaafashion.com']);
export function isNykaa(hostname: string): boolean {
  return NYKAA_HOSTNAMES.has(normalizeHostname(hostname));
}
