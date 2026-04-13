function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeHostname(hostname: string): string {
  const lower = (hostname || '').trim().toLowerCase();
  return lower.startsWith('www.') ? lower.slice(4) : lower;
}

function safeOriginFromUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'https://shop.mango.com';
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

function looksLikeMangoImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (!lower.includes('shop.mango.com/assets/rcs/pics/static/')) return false;
  return /\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(lower);
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

function mangoBaseAssetKey(url: string): string {
  const withoutQuery = url.split('?')[0] ?? url;
  return withoutQuery;
}

function parseMangoResolutionScore(url: string): number {
  try {
    const parsed = new URL(url);
    const w = parsed.searchParams.get('imwidth');
    const d = parsed.searchParams.get('imdensity');
    const width = w && /^\d+$/.test(w) ? Number(w) : 0;
    const density = d && /^\d+$/.test(d) ? Number(d) : 0;
    return width * 1_000_000 + density * 1_000;
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

function extractMangoGalleryUrlsFromHtml(html: string | undefined, baseOrigin: string): string[] {
  if (!html) return [];

  let gridStart = html.indexOf('ImageGrid_imageGrid');
  if (gridStart < 0) gridStart = html.indexOf('ProductDetail_gallery');
  if (gridStart < 0) return [];

  const gridHtml = html.slice(gridStart, Math.min(html.length, gridStart + 300_000));
  const imgMatches = gridHtml.matchAll(/<img[^>]*ImageGridItem_image[^>]*>/gi);
  const urls: string[] = [];

  for (const match of imgMatches) {
    const tag = match[0];
    const srcsetMatch = tag.match(/srcset=(["'])([^"']+)\1/i);
    const srcMatch = tag.match(/src=(["'])([^"']+)\1/i);
    const srcsetRaw = decodeHtmlEntities(srcsetMatch?.[2] ?? '');
    const srcRaw = decodeHtmlEntities(srcMatch?.[2] ?? '');
    const largest = srcsetRaw ? parseSrcsetLargest(srcsetRaw) : null;
    const candidates = [largest, srcRaw].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      const normalized = normalizeUrl(decodeHtmlEntities(candidate), baseOrigin);
      if (normalized && looksLikeMangoImageUrl(normalized)) {
        urls.push(normalized);
        break;
      }
    }
  }

  return urls;
}

export function mangoOverridePrompt(originalUrl: string): string {
  return [
    'MANGO OVERRIDE (images only):',
    `Product URL: ${originalUrl}`,
    '',
    'The primary product gallery images live inside:',
    '- div.ProductDetail_gallery__* > ul.ImageGrid_imageGrid__*',
    '- li.ImageGrid_twoRowImage__* and li.ImageGrid_fourRowImage__* (each contains img.ImageGridItem_image__*)',
    '',
    'IMAGES REQUIREMENTS (critical):',
    '- Extract ALL gallery images from the ImageGrid list in natural order.',
    '- Use the highest-resolution variant from srcset (largest imwidth).',
    '- Include fotos/outfit images along with standard fotos/S images.',
    '- EXCLUDE headers/footers, recommendations, color variants, and any non-product images.',
    '',
    'Return an images array of objects { url, is_primary_suggestion?, sort_order_suggestion? } with the first image as primary.'
  ].join('\n');
}

export function applyMangoDeterministicImageFilter(params: {
  originalUrl: string;
  finalUrl?: string;
  json: Record<string, unknown>;
  html?: string;
  rawHtml?: string;
}): { json: Record<string, unknown>; imageUrls: string[] } {
  const { originalUrl, finalUrl, json, html, rawHtml } = params;
  const baseOrigin = safeOriginFromUrl(finalUrl ?? originalUrl);

  const htmlGallery = extractMangoGalleryUrlsFromHtml(rawHtml ?? html, baseOrigin);
  const candidates: string[] = [];
  if (htmlGallery.length) candidates.push(...htmlGallery);

  const jsonImages = normalizeImageUrls(json['images']);
  if (jsonImages.length) candidates.push(...jsonImages);

  const normalizedCandidates = candidates
    .map((url) => normalizeUrl(decodeHtmlEntities(url), baseOrigin))
    .filter((url): url is string => Boolean(url) && looksLikeMangoImageUrl(url as string));

  const bestByKey = new Map<string, { url: string; score: number; firstIndex: number }>();
  normalizedCandidates.forEach((url, index) => {
    const key = mangoBaseAssetKey(url);
    const score = parseMangoResolutionScore(url);
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

  const finalUrls = ordered.length ? ordered : [];
  const out: Record<string, unknown> = { ...json };
  out['images'] = finalUrls.map((url, idx) => ({
    url,
    sort_order_suggestion: idx,
    is_primary_suggestion: idx === 0
  }));

  return { json: out, imageUrls: finalUrls };
}

export function isMangoHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === 'shop.mango.com';
}
