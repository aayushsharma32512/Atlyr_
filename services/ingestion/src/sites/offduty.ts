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
    return 'https://offduty.in';
  }
}

function normalizeUrl(rawUrl: string, baseOrigin: string): string | null {
  const cleaned = (rawUrl || '').trim().replace(/&amp;/g, '&');
  if (!cleaned) return null;

  if (cleaned.startsWith('//')) return `https:${cleaned}`;
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) return cleaned;
  if (cleaned.startsWith('/')) return `${baseOrigin}${cleaned}`;

  // Fall back to treating as a relative URL.
  return `${baseOrigin}/${cleaned}`;
}

function looksLikeShopifyImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.includes('/cdn/shop/videos/')) return false;
  if (/\.(mp4|webm)(?:\?|$)/i.test(lower)) return false;
  if (!/\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(lower)) return false;
  return lower.includes('/cdn/shop/files/') || lower.includes('/cdn/shop/products/') || lower.includes('cdn.shopify.com/');
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
    // Format: "<url> <width>w" (sometimes "1x")
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

function offdutyBaseAssetKey(url: string): string {
  const withoutQuery = url.split('?')[0] ?? url;
  const lastSlash = withoutQuery.lastIndexOf('/');
  const filename = lastSlash >= 0 ? withoutQuery.slice(lastSlash + 1) : withoutQuery;
  const m = filename.match(/^(.*)_(\d+x\d+|\d+x|\d+)\.(jpg|jpeg|png|webp)$/i);
  if (!m) return withoutQuery;
  const baseFile = `${m[1]}.${m[3]}`;
  return (lastSlash >= 0 ? `${withoutQuery.slice(0, lastSlash + 1)}${baseFile}` : baseFile);
}

function parseOffdutyResolutionScore(url: string): number {
  const withoutQuery = url.split('?')[0] ?? url;
  const m2d = withoutQuery.match(/_(\d+)x(\d+)\.(?:jpg|jpeg|png|webp)$/i);
  if (m2d) return Number(m2d[1]) * 1_000_000 + Number(m2d[2]) * 1_000;
  const m1d = withoutQuery.match(/_(\d+)\.(?:jpg|jpeg|png|webp)$/i);
  if (m1d) return Number(m1d[1]) * 1_000_000;
  try {
    const parsed = new URL(url);
    const w = parsed.searchParams.get('width');
    if (w && /^\d+$/.test(w)) return Number(w) * 1_000_000;
  } catch {
    // ignore
  }
  return 0;
}

function extractOffdutyGalleryUrlsFromHtml(html: string | undefined, baseOrigin: string): string[] {
  if (!html) return [];

  const indices: number[] = [];
  let idx = html.indexOf('product__thumb-item');
  while (idx >= 0) {
    indices.push(idx);
    idx = html.indexOf('product__thumb-item', idx + 1);
  }
  if (!indices.length) return [];

  const urlsInOrder: string[] = [];
  for (let i = 0; i < indices.length; i += 1) {
    const start = indices[i];
    const next = indices[i + 1] ?? -1;
    const end = (next > start) ? next : Math.min(html.length, start + 30_000);
    const slice = html.slice(start, end);

    // Prefer explicit <a href="..._1800x1800.jpg"> when present.
    const hrefMatch = slice.match(/<a[^>]+href=(["'])([^"']+)\1/i);
    const hrefRaw = hrefMatch?.[2] ?? '';
    const href = hrefRaw ? normalizeUrl(hrefRaw, baseOrigin) : null;
    if (href && looksLikeShopifyImageUrl(href)) {
      urlsInOrder.push(href);
      continue;
    }

    // Fall back to srcset/data-srcset.
    const srcsetMatch = slice.match(/(?:data-srcset|srcset)=(["'])([^"']+)\1/i);
    const srcsetRaw = srcsetMatch?.[2] ?? '';
    const largestRaw = srcsetRaw ? parseSrcsetLargest(srcsetRaw) : null;
    const largest = largestRaw ? normalizeUrl(largestRaw, baseOrigin) : null;
    if (largest && looksLikeShopifyImageUrl(largest)) {
      urlsInOrder.push(largest);
    }
  }

  return urlsInOrder;
}

export function offdutyOverridePrompt(originalUrl: string): string {
  return [
    'OFFDUTY (Shopify) OVERRIDE (images):',
    `Product URL: ${originalUrl}`,
    '',
    'The primary product gallery is rendered as a list of thumbnail items, typically:',
    '- div.product__thumb-item (within a product__thumbs container)',
    '- each thumb often has <a href="..._1800x1800.jpg"> and/or an <img> with (data-)srcset.',
    '',
    'IMAGES REQUIREMENTS (critical):',
    '- Extract ALL product gallery images from the thumb list in natural order.',
    '- Prefer the highest-resolution variant (e.g. _1800x1800) when multiple sizes exist.',
    '- EXCLUDE videos (mp4/webm), customer review/gallery images, payment icons, logos, recommendations, and any non-product images.',
    '',
    'Return an images array of objects { url, is_primary_suggestion?, sort_order_suggestion? } with the first image as primary.'
  ].join('\n');
}

export function applyOffdutyDeterministicImageFilter(params: {
  originalUrl: string;
  finalUrl?: string;
  json: Record<string, unknown>;
  html?: string;
  rawHtml?: string;
}): { json: Record<string, unknown>; imageUrls: string[] } {
  const { originalUrl, finalUrl, json, html, rawHtml } = params;
  const baseOrigin = safeOriginFromUrl(finalUrl ?? originalUrl);

  const htmlGallery = extractOffdutyGalleryUrlsFromHtml(rawHtml ?? html, baseOrigin);

  const candidates: string[] = [];
  if (htmlGallery.length) candidates.push(...htmlGallery);
  const jsonImages = json['images'];
  if (Array.isArray(jsonImages)) {
    for (const entry of jsonImages) {
      if (typeof entry === 'string') candidates.push(entry);
      else if (isRecord(entry) && typeof entry['url'] === 'string') candidates.push(entry['url']);
    }
  }

  const normalizedCandidates = candidates
    .map((u) => normalizeUrl(u, baseOrigin))
    .filter((u): u is string => Boolean(u) && looksLikeShopifyImageUrl(u as string));

  const bestByKey = new Map<string, { url: string; score: number; firstIndex: number }>();
  normalizedCandidates.forEach((url, index) => {
    const key = offdutyBaseAssetKey(url);
    const score = parseOffdutyResolutionScore(url);
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

export function isOffdutyHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === 'offduty.in';
}

