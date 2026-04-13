/**
 * Bonkers Corner site profile (Shopify-based)
 * 
 * From DOM analysis (user screenshots):
 * - Container: div.product-images.product-images--collage
 * - Slides: div.product-images__slide
 * - Images: img.no-blur.lazyautosizes (with data-srcset for high-res)
 * 
 * CDN pattern: bonkerscorner.com/cdn/shop/files/<slug>_<resolution>.jpg
 */

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
        return 'https://www.bonkerscorner.com';
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

function looksLikeShopifyProductImage(url: string): boolean {
    const lower = url.toLowerCase();
    // Exclude videos
    if (lower.includes('/cdn/shop/videos/')) return false;
    if (/\.(mp4|webm|mov)(?:\?|$)/i.test(lower)) return false;
    // Must be an image
    if (!/\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(lower)) return false;
    // Must be from Shopify CDN
    return lower.includes('/cdn/shop/files/') || lower.includes('/cdn/shop/products/') || lower.includes('cdn.shopify.com/');
}

function bonkersCornerBaseAssetKey(url: string): string {
    const withoutQuery = url.split('?')[0] ?? url;
    const lastSlash = withoutQuery.lastIndexOf('/');
    const filename = lastSlash >= 0 ? withoutQuery.slice(lastSlash + 1) : withoutQuery;
    // Strip resolution suffixes like _100x100, _1800x, _960x and optional _crop_center suffix
    // Pattern: name_WxH_crop_center.ext or name_Wx_crop_center.ext or name_WxH.ext
    const m = filename.match(/^(.*)_(\d+x\d*|\d+x)(_crop_center)?\.([a-z]+)$/i);
    if (!m) {
        // No resolution suffix - use lowercase filename for case-insensitive deduplication
        return withoutQuery.toLowerCase();
    }
    const baseFile = `${m[1]}.${m[4]}`;
    const result = lastSlash >= 0 ? `${withoutQuery.slice(0, lastSlash + 1)}${baseFile}` : baseFile;
    // Return lowercase for case-insensitive deduplication (Shopify URLs can vary in casing)
    return result.toLowerCase();
}

function parseBonkersCornerResolutionScore(url: string): number {
    const withoutQuery = url.split('?')[0] ?? url;
    // Match _WxH pattern (e.g., _960x_crop_center)
    const m2d = withoutQuery.match(/_(\d+)x(\d+)/i);
    if (m2d) return Number(m2d[1]) * 1_000_000 + Number(m2d[2]) * 1_000;
    // Match _Wx pattern (e.g., _960x)
    const m1d = withoutQuery.match(/_(\d+)x[^0-9]/i) || withoutQuery.match(/_(\d+)x$/i);
    if (m1d) return Number(m1d[1]) * 1_000_000;
    // Check for width/height query params
    try {
        const parsed = new URL(url);
        const w = parsed.searchParams.get('width');
        const h = parsed.searchParams.get('height');
        if (w && /^\d+$/.test(w)) return Number(w) * 1_000_000 + (h ? Number(h) * 1_000 : 0);
    } catch {
        // ignore
    }
    return 0;
}

function extractBonkersCornerGalleryUrlsFromHtml(html: string | undefined, baseOrigin: string): string[] {
    if (!html) return [];

    // Find all product-images__slide elements in order (DOM-based inclusion)
    const slideMarker = 'product-images__slide';
    const indices: number[] = [];
    let idx = html.indexOf(slideMarker);
    while (idx >= 0) {
        indices.push(idx);
        idx = html.indexOf(slideMarker, idx + 1);
    }
    if (!indices.length) return [];

    const urlsInOrder: string[] = [];
    for (let i = 0; i < indices.length; i += 1) {
        const start = indices[i];
        const next = indices[i + 1] ?? -1;
        // Each slide section ends at the next slide or after reasonable distance
        const end = (next > start) ? next : Math.min(html.length, start + 30_000);
        const slice = html.slice(start, end);

        // Extract image URLs from srcset, data-srcset, src, data-src attributes
        // These contain the actual product images
        const srcsetMatch = slice.match(/(?:data-srcset|srcset)=["']([^"']+)["']/i);
        if (srcsetMatch) {
            const srcset = srcsetMatch[1].replace(/&amp;/g, '&');
            // Parse srcset to get all URLs
            const entries = srcset.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
            for (const entry of entries) {
                const normalized = normalizeUrl(entry, baseOrigin);
                if (normalized && looksLikeShopifyProductImage(normalized)) {
                    urlsInOrder.push(normalized);
                }
            }
        }

        // Also check src and data-src as fallback
        const srcMatch = slice.match(/(?:data-src|src)=["'](\/\/[^"']+|https?:\/\/[^"']+)["']/i);
        if (srcMatch) {
            const normalized = normalizeUrl(srcMatch[1].replace(/&amp;/g, '&'), baseOrigin);
            if (normalized && looksLikeShopifyProductImage(normalized)) {
                urlsInOrder.push(normalized);
            }
        }
    }

    return urlsInOrder;
}

export function bonkersCornerOverridePrompt(originalUrl: string): string {
    return [
        'BONKERS CORNER (Shopify) OVERRIDE (images):',
        `Product URL: ${originalUrl}`,
        '',
        'The primary product gallery is rendered as a vertical list of slides:',
        '- Container: div.product-images.product-images--collage',
        '- Each slide: div.product-images__slide',
        '- Images: img.no-blur.lazyautosizes with high-res URLs in data-srcset',
        '',
        'IMAGES REQUIREMENTS (critical):',
        '- Extract ONLY images from the main gallery (product-images__slide elements)',
        '- EXCLUDE color variant swatches (found in .product-option section)',
        '- EXCLUDE "You May Also Like" recommendation images',
        '- EXCLUDE payment icons, logos, pop-up images',
        '- Prefer highest resolution variant from srcset',
        '',
        'Return an images array of objects { url, is_primary_suggestion?, sort_order_suggestion? } with the first image as primary.'
    ].join('\n');
}

export function applyBonkersCornerDeterministicImageFilter(params: {
    originalUrl: string;
    finalUrl?: string;
    json: Record<string, unknown>;
    html?: string;
    rawHtml?: string;
}): { json: Record<string, unknown>; imageUrls: string[] } {
    const { originalUrl, finalUrl, json, html, rawHtml } = params;
    const baseOrigin = safeOriginFromUrl(finalUrl ?? originalUrl);

    const htmlGallery = extractBonkersCornerGalleryUrlsFromHtml(rawHtml ?? html, baseOrigin);

    const candidates: string[] = [];
    if (htmlGallery.length) candidates.push(...htmlGallery);

    // Also check JSON images array
    const jsonImages = json['images'];
    if (Array.isArray(jsonImages)) {
        for (const entry of jsonImages) {
            if (typeof entry === 'string') candidates.push(entry);
            else if (isRecord(entry) && typeof entry['url'] === 'string') candidates.push(entry['url']);
        }
    }

    const normalizedCandidates = candidates
        .map((u) => normalizeUrl(u, baseOrigin))
        .filter((u): u is string => Boolean(u) && looksLikeShopifyProductImage(u as string));

    // Deduplicate by base asset key, keeping highest resolution
    const bestByKey = new Map<string, { url: string; score: number; firstIndex: number }>();
    normalizedCandidates.forEach((url, index) => {
        const key = bonkersCornerBaseAssetKey(url);
        const score = parseBonkersCornerResolutionScore(url);
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

export function isBonkersCornerHostname(hostname: string): boolean {
    const normalized = normalizeHostname(hostname);
    return normalized === 'bonkerscorner.com';
}
