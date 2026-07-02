// Shared utilities used across all site-specific image filters.

export function normalizeHostname(hostname: string): string {
  const h = (hostname || '').trim().toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

export function safeHostname(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

export function safeOriginFromUrl(url: string, fallback: string): string {
  try { return new URL(url).origin; } catch { return fallback; }
}

export function normalizeUrl(rawUrl: string, baseOrigin: string): string | null {
  const cleaned = (rawUrl || '').trim().replace(/&amp;/g, '&');
  if (!cleaned) return null;
  if (cleaned.startsWith('//'))    return `https:${cleaned}`;
  if (cleaned.startsWith('http'))  return cleaned;
  if (cleaned.startsWith('/'))     return `${baseOrigin}${cleaned}`;
  return `${baseOrigin}/${cleaned}`;
}

export function decodeHtmlEntities(value: string): string {
  if (!value) return value;
  return value.replace(/&quot;|\\u0026quot;|&amp;|\\u0026amp;|\\u003d|\\u002f/g, (t) => {
    if (t === '&quot;' || t === '\\u0026quot;') return '';
    if (t === '&amp;'  || t === '\\u0026amp;')  return '&';
    if (t === '\\u003d') return '=';
    if (t === '\\u002f') return '/';
    return t;
  });
}

export function parseSrcsetLargest(srcset: string): string | null {
  let bestUrl: string | null = null;
  let bestScore = -1;
  for (const part of srcset.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [url, descriptor = ''] = part.split(/\s+/).filter(Boolean);
    let score = 0;
    const mW = descriptor.match(/^(\d+)w$/i);
    if (mW) score = Number(mW[1]);
    const mX = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
    if (!mW && mX) score = Math.floor(Number(mX[1]) * 1000);
    if (score > bestScore) { bestScore = score; bestUrl = url; }
  }
  return bestUrl;
}

export function normalizeImageUrls(value: unknown): string[] {
  const urls: string[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') urls.push(entry);
      else if (isRecord(entry) && typeof entry['url'] === 'string') urls.push(entry['url']);
    }
  } else if (isRecord(value) && Array.isArray((value as Record<string, unknown>)['images'])) {
    return normalizeImageUrls((value as Record<string, unknown>)['images']);
  }
  return [...new Set(urls)];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ─── Generic Shopify CDN helpers ──────────────────────────────────────────────

export function looksLikeShopifyImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.includes('/cdn/shop/videos/')) return false;
  if (/\.(mp4|webm|mov)(?:\?|$)/i.test(lower)) return false;
  if (!/\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(lower)) return false;
  return lower.includes('/cdn/shop/files/') ||
         lower.includes('/cdn/shop/products/') ||
         lower.includes('cdn.shopify.com/');
}

export function shopifyBaseAssetKey(url: string): string {
  const withoutQuery = url.split('?')[0] ?? url;
  const lastSlash = withoutQuery.lastIndexOf('/');
  const filename = lastSlash >= 0 ? withoutQuery.slice(lastSlash + 1) : withoutQuery;
  const m = filename.match(/^(.*)_(\d+x\d*|\d+x)(_crop_center)?\.(jpg|jpeg|png|webp)$/i);
  if (!m) return withoutQuery.toLowerCase();
  const baseFile = `${m[1]}.${m[4]}`;
  const prefix = lastSlash >= 0 ? withoutQuery.slice(0, lastSlash + 1) : '';
  return `${prefix}${baseFile}`.toLowerCase();
}

export function parseShopifyResolutionScore(url: string): number {
  const withoutQuery = url.split('?')[0] ?? url;
  const m2d = withoutQuery.match(/_(\d+)x(\d+)/i);
  if (m2d) return Number(m2d[1]) * 1_000_000 + Number(m2d[2]) * 1_000;
  const m1d = withoutQuery.match(/_(\d+)x[^0-9]/i) || withoutQuery.match(/_(\d+)x$/i);
  if (m1d) return Number(m1d[1]) * 1_000_000;
  try {
    const p = new URL(url);
    const w = p.searchParams.get('width');
    if (w && /^\d+$/.test(w)) return Number(w) * 1_000_000;
  } catch { /* ignore */ }
  return 0;
}

export function dedupeByResolution(
  urls: string[],
  keyFn: (url: string) => string,
  scoreFn: (url: string) => number
): string[] {
  const best = new Map<string, { url: string; score: number; firstIndex: number }>();
  urls.forEach((url, index) => {
    const key = keyFn(url);
    const score = scoreFn(url);
    const existing = best.get(key);
    if (!existing) { best.set(key, { url, score, firstIndex: index }); return; }
    if (score > existing.score) best.set(key, { url, score, firstIndex: existing.firstIndex });
  });
  return [...best.values()].sort((a, b) => a.firstIndex - b.firstIndex).map((e) => e.url);
}
