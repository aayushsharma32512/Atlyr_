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
        return 'https://www.nishorama.com';
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

function looksLikeNishoramaImageUrl(url: string): boolean {
    const lower = url.toLowerCase();
    // Exclude videos
    if (lower.includes('/cdn/shop/videos/')) return false;
    if (/\.(mp4|webm)(?:\?|$)/i.test(lower)) return false;
    // Must have valid image extension
    if (!/\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(lower)) return false;
    // Must be from Nishorama Shopify CDN (either www. or row. subdomain)
    return lower.includes('nishorama.com/cdn/shop/files/') ||
        lower.includes('nishorama.com/cdn/shop/products/') ||
        lower.includes('cdn.shopify.com/');
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

function nishoramaBaseAssetKey(url: string): string {
    const withoutQuery = url.split('?')[0] ?? url;
    const lastSlash = withoutQuery.lastIndexOf('/');
    const filename = lastSlash >= 0 ? withoutQuery.slice(lastSlash + 1) : withoutQuery;
    // Strip resolution suffix patterns like _1800x1800 or _500x
    const m = filename.match(/^(.*)_(\d+x\d+|\d+x|\d+)\.(jpg|jpeg|png|webp)$/i);
    if (!m) return withoutQuery;
    const baseFile = `${m[1]}.${m[3]}`;
    return (lastSlash >= 0 ? `${withoutQuery.slice(0, lastSlash + 1)}${baseFile}` : baseFile);
}

function parseNishoramaResolutionScore(url: string): number {
    // Try ?width= param first (Nishorama uses this)
    try {
        const parsed = new URL(url);
        const w = parsed.searchParams.get('width');
        if (w && /^\d+$/.test(w)) return Number(w) * 1_000_000;
    } catch {
        // ignore
    }
    // Fall back to filename patterns like _WxH or _W
    const withoutQuery = url.split('?')[0] ?? url;
    const m2d = withoutQuery.match(/_(\d+)x(\d+)\.(?:jpg|jpeg|png|webp)$/i);
    if (m2d) return Number(m2d[1]) * 1_000_000 + Number(m2d[2]) * 1_000;
    const m1d = withoutQuery.match(/_(\d+)\.(?:jpg|jpeg|png|webp)$/i);
    if (m1d) return Number(m1d[1]) * 1_000_000;
    return 0;
}

function extractNishoramaGalleryUrlsFromHtml(html: string | undefined, baseOrigin: string): string[] {
    if (!html) return [];

    // Strategy 1: Look for product-gallery-new__media-item elements
    const indices: number[] = [];
    let idx = html.indexOf('product-gallery-new__media-item');
    while (idx >= 0) {
        const nextChunk = html.slice(idx, Math.min(html.length, idx + 500));
        // Skip only if explicitly marked as video
        const isVideo = nextChunk.includes('data-media-type="video"') || nextChunk.includes("data-media-type='video'");
        if (!isVideo) {
            indices.push(idx);
        }
        idx = html.indexOf('product-gallery-new__media-item', idx + 1);
    }
    if (!indices.length) return [];

    const urlsInOrder: string[] = [];
    for (let i = 0; i < indices.length; i += 1) {
        const start = indices[i];
        const next = indices[i + 1] ?? -1;
        const end = (next > start) ? next : Math.min(html.length, start + 30_000);
        const slice = html.slice(start, end);

        // Prefer srcset/data-srcset for highest resolution
        const srcsetMatch = slice.match(/(?:data-srcset|srcset)=(['"])([^'"]+)\1/i);
        const srcsetRaw = srcsetMatch?.[2] ?? '';
        const largestRaw = srcsetRaw ? parseSrcsetLargest(srcsetRaw) : null;
        const largest = largestRaw ? normalizeUrl(largestRaw, baseOrigin) : null;
        if (largest && looksLikeNishoramaImageUrl(largest)) {
            urlsInOrder.push(largest);
            continue;
        }

        // Fall back to src attribute
        const srcMatch = slice.match(/<img[^>]+src=(['"])([^'"]+)\1/i);
        const srcRaw = srcMatch?.[2] ?? '';
        const src = srcRaw ? normalizeUrl(srcRaw, baseOrigin) : null;
        if (src && looksLikeNishoramaImageUrl(src)) {
            urlsInOrder.push(src);
        }
    }

    return urlsInOrder;
}

export function nishoramaOverridePrompt(originalUrl: string): string {
    return [
        'NISHORAMA (Shopify) OVERRIDE (images):',
        `Product URL: ${originalUrl}`,
        '',
        'The primary product gallery is rendered as:',
        '- div.product-gallery-new__images-scroll (scroll container)',
        '- div.product-gallery-new__media-item (each gallery image)',
        '- img.image-res.srcset-full-size with srcset containing multiple resolutions',
        '',
        'IMAGES REQUIREMENTS (critical):',
        '- Extract ALL product gallery images from the media items in natural order.',
        '- Prefer the highest-resolution variant (e.g. width=1920 or width=1728) from srcset.',
        '- EXCLUDE videos (mp4/webm), customer photos, payment icons, logos, recommendations, and any non-product images.',
        '',
        'Return an images array of objects { url, is_primary_suggestion?, sort_order_suggestion? } with the first image as primary.'
    ].join('\n');
}

export function applyNishoramaDeterministicImageFilter(params: {
    originalUrl: string;
    finalUrl?: string;
    json: Record<string, unknown>;
    html?: string;
    rawHtml?: string;
}): { json: Record<string, unknown>; imageUrls: string[] } {
    const { originalUrl, finalUrl, json, html, rawHtml } = params;
    const baseOrigin = safeOriginFromUrl(finalUrl ?? originalUrl);

    const htmlGallery = extractNishoramaGalleryUrlsFromHtml(rawHtml ?? html, baseOrigin);

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
        .filter((u): u is string => Boolean(u) && looksLikeNishoramaImageUrl(u as string));

    const bestByKey = new Map<string, { url: string; score: number; firstIndex: number }>();
    normalizedCandidates.forEach((url, index) => {
        const key = nishoramaBaseAssetKey(url);
        const score = parseNishoramaResolutionScore(url);
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

/**
 * Transform nishorama.com URLs to use row. subdomain directly.
 * This avoids the redirect from www.nishorama.com → row.nishorama.com
 * which can result in scraping the wrong product (homepage instead of product page).
 */
export function transformNishoramaUrl(originalUrl: string): string {
    try {
        const parsed = new URL(originalUrl);
        const normalized = normalizeHostname(parsed.hostname);
        if (normalized === 'nishorama.com') {
            // Convert www.nishorama.com to row.nishorama.com
            parsed.hostname = 'row.nishorama.com';
            return parsed.toString();
        }
        return originalUrl;
    } catch {
        return originalUrl;
    }
}

export function isNishoramaHostname(hostname: string): boolean {
    const normalized = normalizeHostname(hostname);
    // Match both www.nishorama.com and row.nishorama.com (regional subdomain)
    return normalized === 'nishorama.com' || normalized === 'row.nishorama.com';
}
