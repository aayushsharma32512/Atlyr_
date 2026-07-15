import { normalizeHostname } from './shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeOriginFromUrl(url: string, defaultOrigin = 'https://in.puma.com'): string {
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

function looksLikePumaImageUrl(url: string): boolean {
  const lower = url.toLowerCase();

  // Exclude videos
  if (lower.includes('/video/upload/')) return false;
  if (/\.(mp4|webm|mov|avi)(?:\?|$)/i.test(lower)) return false;

  // Must be Puma's image CDN
  if (!lower.includes('images.puma.com/image/upload/')) return false;

  // Exclude tiny style picker thumbnails (w_100 or smaller)
  if (/[,/]w_(?:[1-9]?\d|100)[,/]/i.test(lower)) return false;

  // Exclude raw CDN path without specific image content hash
  if (lower.endsWith('/upload/f_auto') || lower.endsWith('/upload/f_auto/')) return false;

  return true;
}

function parsePumaResolutionScore(url: string): number {
  const match = url.match(/[,/]w_(\d+)[,/]/i);
  if (match) {
    return Number(match[1]);
  }
  return 0;
}

export function getPumaProductId(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/pd\/[^/]+\/(\d+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function pumaBaseAssetKey(url: string): string {
  const withoutQuery = url.split('?')[0] ?? url;
  const globalMatch = withoutQuery.match(/\/global\/(.+)/i);
  if (globalMatch) {
    return globalMatch[1];
  }

  const segments = withoutQuery.split('/');
  if (segments.length >= 3) {
    return segments.slice(-3).join('/');
  }

  return segments[segments.length - 1] || withoutQuery;
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

function extractPumaGalleryUrlsFromHtml(html: string | undefined, baseOrigin: string): string[] {
  if (!html) return [];

  const urls: string[] = [];

  // Method 1 (Primary): Look for images in #product-gallery container
  const galleryMatch = html.match(/<[^>]*id=["']product-gallery["'][^>]*>[\s\S]*?(?=<\/section|<section|$)/i);
  if (galleryMatch) {
    const galleryHtml = galleryMatch[0];
    const imgMatches = galleryHtml.matchAll(/<img[^>]+src=["']([^"']+images\.puma\.com[^"']+)["'][^>]*>/gi);
    for (const match of imgMatches) {
      const url = match[1];
      if (url && looksLikePumaImageUrl(url)) {
        urls.push(url);
      }
    }
  }

  // Method 2: Look for high-res Puma CDN images (w_600 or larger)
  if (!urls.length) {
    const highResMatches = html.matchAll(/https:\/\/images\.puma\.com\/image\/upload\/[^"'\s>]+w_(?:[6-9]\d{2}|[1-9]\d{3})[^"'\s>]*/gi);
    for (const match of highResMatches) {
      const url = match[0];
      if (looksLikePumaImageUrl(url)) {
        urls.push(url);
      }
    }
  }

  // Method 3: Fallback - any Puma image CDN URLs (excluding style-picker by URL pattern)
  if (!urls.length) {
    const allCdnMatches = html.matchAll(/https:\/\/images\.puma\.com\/image\/upload\/[^"'\s>]+/gi);
    for (const match of allCdnMatches) {
      const url = match[0];
      if (looksLikePumaImageUrl(url)) {
        urls.push(url);
      }
    }
  }

  return urls;
}

function upgradeToHighRes(url: string): string {
  return url.replace(/w_\d+,h_\d+/i, 'w_2000,h_2000');
}

export function applyPumaDeterministicImageFilter(params: {
  originalUrl: string;
  finalUrl?: string;
  json: Record<string, unknown>;
  html?: string;
  rawHtml?: string;
}): { json: Record<string, unknown>; imageUrls: string[] } {
  const { originalUrl, finalUrl, json, html, rawHtml } = params;
  const baseOrigin = safeOriginFromUrl(finalUrl ?? originalUrl);

  const htmlGallery = extractPumaGalleryUrlsFromHtml(rawHtml ?? html, baseOrigin);

  const candidates: string[] = [];
  if (htmlGallery.length) candidates.push(...htmlGallery);

  const jsonImages = normalizeImageUrls(json['images']);
  if (jsonImages.length) candidates.push(...jsonImages);

  const normalizedCandidates = candidates
    .map((url) => normalizeUrl(decodeHtmlEntities(url), baseOrigin))
    .filter((url): url is string => Boolean(url) && looksLikePumaImageUrl(url as string))
    .map(upgradeToHighRes);

  const bestByKey = new Map<string, { url: string; score: number; firstIndex: number }>();
  normalizedCandidates.forEach((url, index) => {
    const key = pumaBaseAssetKey(url);
    const score = parsePumaResolutionScore(url);
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

export function extractPumaImages(
  html: string,
  originalUrl: string,
  jsonImages: string[]
): string[] {
  const res = applyPumaDeterministicImageFilter({
    originalUrl,
    json: { images: jsonImages },
    html
  });
  return res.imageUrls;
}

export const PUMA_HOSTNAMES = new Set(['puma.com', 'in.puma.com', 'eu.puma.com', 'us.puma.com', 'www.puma.com']);
export function isPuma(hostname: string): boolean {
  return PUMA_HOSTNAMES.has(normalizeHostname(hostname));
}
