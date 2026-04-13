function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeHostname(hostname: string): string {
  const lower = (hostname || '').trim().toLowerCase();
  return lower.startsWith('www.') ? lower.slice(4) : lower;
}

export function myntraStyleIdFromUrl(url: string): string | null {
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

export function myntraOverridePrompt(originalUrl: string): string {
  const styleId = myntraStyleIdFromUrl(originalUrl);
  const styleLine = styleId ? `Myntra style_id for THIS PDP: ${styleId}` : 'Myntra style_id for THIS PDP: (unknown)';

  return [
    'MYNTRA OVERRIDE (images only):',
    styleLine,
    '',
    'The primary product gallery images are stored as CSS background-image URLs on the main image grid.',
    'Extract gallery images ONLY from elements like:',
    '- div.image-grid-image (style="background-image: url(...)")',
    '- within containers such as image-grid-imageContainer / image-grid-container / pdp-details.',
    '',
    'EXCLUDE images from:',
    '- "More Colors" / color variants section (e.g., img.colors-image, colors-heading, or any container labeled "More Colors")',
    '- cross-sell / recommendations / similar products / product lists (e.g., "Customers also liked")',
    '- header/footer icons, logos, sprites, ads, trackers.',
    '',
    'CRITICAL FILTER:',
    '- If the style_id is known (above) and the URL contains an explicit numeric `/assets/images/<id>/` segment, only keep URLs where <id> matches this style_id.',
    '- Some Myntra PDPs use date-based paths like `/assets/images/YYYY/MONTH/...` that do not encode style_id; keep those when they come from the main gallery grid.',
    '',
    'QUALITY:',
    '- Prefer higher-resolution assets (e.g., h_720,q_90 or larger) when multiple variants exist.',
    '- Avoid tiny thumbnail transforms.',
    '',
    'Return ALL distinct gallery images in natural order with the hero image first.',
  ].join('\n');
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
  if (gridStart < 0) return [];

  const gridEndCandidates = [
    html.indexOf('pdp-description-container', gridStart),
  ];
  const gridEnd = gridEndCandidates.filter((n) => n > gridStart).sort((a, b) => a - b)[0];
  const gridHtml = (gridEnd && gridEnd > gridStart)
    ? html.slice(gridStart, gridEnd)
    : html.slice(gridStart, Math.min(html.length, gridStart + 250_000));

  const matches = gridHtml.match(/https:\/\/(?:assets|constant)\.myntassets\.com\/[^\s"'\\)>]+/g);
  if (!matches?.length) return [];

  const urls: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/&quot;|\\u0026quot;|\\u0026amp;|&amp;|\\u003d|\\u002f/g, (token) => {
      if (token === '&quot;' || token === '\\u0026quot;') return '';
      if (token === '&amp;' || token === '\\u0026amp;') return '&';
      if (token === '\\u003d') return '=';
      if (token === '\\u002f') return '/';
      return token;
    });

    if (!cleaned.startsWith('https://assets.myntassets.com/') && !cleaned.startsWith('https://constant.myntassets.com/')) continue;
    // Accept both:
    // - .../v1/assets/images/<styleId>/...
    // - .../v1/assets/images/YYYY/MONTH/... (date-based paths as in Myntra's current grid)
    if (!cleaned.includes('/v1/assets/images/')) continue;

    // If styleId is known and the URL contains an explicit numeric /assets/images/<id>/ segment,
    // drop mismatched ids (common source of "more colors"/cross-sell leakage). If the URL is
    // date-based (e.g. /assets/images/2025/JULY/...), keep it.
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

export function applyMyntraDeterministicImageFilter(params: {
  originalUrl: string;
  json: Record<string, unknown>;
  html?: string;
  rawHtml?: string;
}): { json: Record<string, unknown>; imageUrls: string[] } {
  const { originalUrl, json, html, rawHtml } = params;
  const styleId = myntraStyleIdFromUrl(originalUrl);

  const htmlGallery = extractMyntraGalleryUrlsFromHtml(rawHtml ?? html, styleId);
  const placeholderStyleImageRe = styleId ? new RegExp(`/assets/images/${styleId}/(?:large|front|back|side)\\.jpg$`, 'i') : null;
  const candidates = Array.from(new Set([
    ...htmlGallery,
    ...normalizeImageUrls(json['images'])
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

  const finalUrls = deduped.length
    ? deduped
    : candidates.slice(0, 6);

  // Do NOT force-rewrite Myntra CDN URLs. Use HTML-derived URLs as-is when available, and keep
  // JSON-derived URLs unmodified as a fallback. URL rewriting happens (if needed) at download time.
  const normalizedFinalUrls = Array.from(new Set(finalUrls));

  const out: Record<string, unknown> = { ...json };
  out['images'] = normalizedFinalUrls.map((url, idx) => ({
    url,
    sort_order_suggestion: idx,
    is_primary_suggestion: idx === 0
  }));

  return { json: out, imageUrls: normalizedFinalUrls };
}

export function isMyntraHostname(hostname: string): boolean {
  return normalizeHostname(hostname) === 'myntra.com';
}
