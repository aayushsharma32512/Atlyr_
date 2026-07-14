import { normalizeHostname } from './shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getMyntraStyleId(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    if (!segments.length) return null;
    const buyIndex = segments.lastIndexOf('buy');
    const candidate = buyIndex > 0 ? segments[buyIndex - 1] : null;
    if (candidate && /^\d+$/.test(candidate)) return candidate;
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const seg = segments[i];
      if (/^\d+$/.test(seg)) return seg;
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeImageUrls(value: unknown): string[] {
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

function extractMyntraGalleryUrlsFromHtml(html: string | undefined, styleId: string | null): string[] {
  if (!html) return [];

  let gridStart = html.indexOf('image-grid-container');
  // Sometimes Firecrawl's HTML may miss this exact marker; fall back to another stable class.
  if (gridStart < 0) gridStart = html.indexOf('image-grid-image');

  let gridHtml = html;
  if (gridStart >= 0) {
    const gridEndCandidates = [
      html.indexOf('pdp-description-container', gridStart),
    ];
    const gridEnd = gridEndCandidates.filter((n) => n > gridStart).sort((a, b) => a - b)[0];
    gridHtml = (gridEnd && gridEnd > gridStart)
      ? html.slice(gridStart, gridEnd)
      : html.slice(gridStart, Math.min(html.length, gridStart + 250_000));
  }

  const matches = gridHtml.match(/(?:https?:)?\/\/(?:assets|constant)\.myntassets\.com\/[^\s"'\\)>]+/g);
  if (!matches?.length) return [];

  const urls: string[] = [];
  for (const raw of matches) {
    let cleaned = raw.replace(/&quot;|\\u0026quot;|\\u0026amp;|&amp;|\\u003d|\\u002f/g, (token) => {
      if (token === '&quot;' || token === '\\u0026quot;') return '';
      if (token === '&amp;' || token === '\\u0026amp;') return '&';
      if (token === '\\u003d') return '=';
      if (token === '\\u002f') return '/';
      return token;
    });

    if (cleaned.startsWith('//')) {
      cleaned = `https:${cleaned}`;
    }

    if (!cleaned.startsWith('https://assets.myntassets.com/') && !cleaned.startsWith('https://constant.myntassets.com/')) continue;
    if (!cleaned.includes('/v1/assets/images/')) continue;

    // If styleId is known and the URL contains an explicit numeric /assets/images/<id>/ segment,
    // drop mismatched ids. If the URL is date-based, keep it.
    if (styleId) {
      const m = cleaned.match(/\/assets\/images\/(\d+)\//);
      if (m?.[1] && m[1] !== styleId) {
        const candidate = m[1];
        const asNum = Number(candidate);
        const looksLikeYear = candidate.length === 4 && Number.isFinite(asNum) && asNum >= 2000 && asNum <= 2100;
        if (!looksLikeYear) continue;
      }
    }

    urls.push(cleaned);
  }

  const deduped = Array.from(new Set(urls));
  if (!styleId) return deduped;
  const styleMarker = `/assets/images/${styleId}/`;
  return [
    ...deduped.filter((u) => u.includes(styleMarker)),
    ...deduped.filter((u) => !u.includes(styleMarker))
  ];
}

function parseMyntraTransformScore(url: string): number {
  const mH = url.match(/(?:^|[/,])h_(\d+)(?:[/,]|$)/i);
  const mW = url.match(/(?:^|[/,])w_(\d+)(?:[/,]|$)/i);
  const mQ = url.match(/(?:^|[/,])q_(\d+)(?:[/,]|$)/i);
  const h = mH ? Number(mH[1]) : 0;
  const w = mW ? Number(mW[1]) : 0;
  const q = mQ ? Number(mQ[1]) : 0;
  return h * 1_000_000 + w * 1_000 + q;
}

function myntraBaseAssetKey(url: string, styleId: string | null): string {
  const cleaned = url.split('?')[0] ?? url;
  const v1Index = cleaned.indexOf('/v1/');
  if (v1Index >= 0) return cleaned.slice(v1Index);
  if (styleId) {
    const marker = `/assets/images/${styleId}/`;
    const idx = cleaned.indexOf(marker);
    if (idx >= 0) return cleaned.slice(idx);
  }
  const parts = cleaned.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? cleaned;
}

export function extractMyntraImages(
  html: string,
  originalUrl: string,
  jsonImages: string[]
): string[] {
  const styleId = getMyntraStyleId(originalUrl);

  const htmlGallery = extractMyntraGalleryUrlsFromHtml(html, styleId);
  const placeholderStyleImageRe = styleId ? new RegExp(`/assets/images/${styleId}/(?:large|front|back|side)\\.jpg$`, 'i') : null;
  const candidates = Array.from(new Set([
    ...htmlGallery,
    ...normalizeImageUrls(jsonImages)
  ])).filter((url) => {
    if (url.startsWith('https://www.myntra.com/assets/images/')) return false;
    if (url.startsWith('http://www.myntra.com/assets/images/')) return false;
    if (placeholderStyleImageRe && placeholderStyleImageRe.test(url)) return false;
    return true;
  });

  const styleMarker = styleId ? `/assets/images/${styleId}/` : null;
  const matchesStyle = (url: string) => (styleMarker ? url.includes(styleMarker) : false);

  let filtered = htmlGallery.length > 0
    ? htmlGallery
    : (styleId ? candidates.filter(matchesStyle) : candidates);

  if (styleId && filtered.length === 0) {
    const myntraAssets = candidates.filter((url) => /myntassets\.com\/.*\/assets\/images\//i.test(url));
    filtered = myntraAssets;
  }

  const bestByKey = new Map<string, { url: string; score: number; firstIndex: number }>();
  filtered.forEach((url, index) => {
    const key = myntraBaseAssetKey(url, styleId);
    const score = parseMyntraTransformScore(url);
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, { url, score, firstIndex: index });
      return;
    }
    if (score > existing.score) {
      bestByKey.set(key, { url, score, firstIndex: existing.firstIndex });
    }
  });

  const deduped = Array.from(bestByKey.values())
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map((entry) => entry.url);

  return deduped.length ? deduped : candidates.slice(0, 6);
}

export const MYNTRA_HOSTNAMES = new Set(['myntra.com', 'www.myntra.com']);
export function isMyntra(hostname: string): boolean {
  return MYNTRA_HOSTNAMES.has(normalizeHostname(hostname));
}
