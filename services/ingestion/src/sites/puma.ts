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
        return 'https://in.puma.com';
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

/**
 * Puma product images are hosted on their CDN:
 * https://images.puma.com/image/upload/f_auto,q_auto,b_rgb:fafafa,w_600,h_600/global/392725/07/...
 * 
 * Resolution variants:
 * - w_100,h_100 (style picker thumbnails)
 * - w_600,h_600 (default gallery)
 * - w_2000,h_2000 (high resolution)
 * 
 * Exclusions:
 * - /video/upload/ (videos)
 * - Style picker images (from #style-picker container, w_100)
 */
function looksLikePumaImageUrl(url: string): boolean {
    const lower = url.toLowerCase();

    // Exclude videos
    if (lower.includes('/video/upload/')) return false;
    if (/\.(mp4|webm|mov|avi)(?:\?|$)/i.test(lower)) return false;

    // Must be Puma's image CDN
    if (!lower.includes('images.puma.com/image/upload/')) return false;

    // Exclude tiny style picker thumbnails (w_100 or smaller)
    if (/[,/]w_(?:[1-9]?\d|100)[,/]/i.test(lower)) return false;

    return true;
}

/**
 * Parse resolution score from Puma URL.
 * Puma uses w_XXX,h_XXX format for dimensions.
 */
function parsePumaResolutionScore(url: string): number {
    // Extract width from w_XXX pattern
    const match = url.match(/[,/]w_(\d+)[,/]/i);
    if (match) {
        return Number(match[1]);
    }
    return 0;
}

/**
 * Extract product ID from Puma URL.
 * Example: /pd/blktop-rider-suede-sneakers/392725
 * Returns: "392725"
 */
export function pumaProductIdFromUrl(url: string): string | null {
    try {
        const pathname = new URL(url).pathname;
        // Pattern: /pd/product-name/PRODUCTID at the end
        // Product IDs are numeric like 392725
        const match = pathname.match(/\/pd\/[^/]+\/(\d+)/i);
        return match?.[1] ?? null;
    } catch {
        return null;
    }
}


/**
 * Base asset key for deduplication.
 * Strips transform params to identify unique images.
 * Example: /global/392725/07/fnd/PNA/fmt/png/modell-front-view.png
 */
function pumaBaseAssetKey(url: string): string {
    // Remove query params
    const withoutQuery = url.split('?')[0] ?? url;

    // Extract the path after the transforms (after /global/)
    const globalMatch = withoutQuery.match(/\/global\/(.+)/i);
    if (globalMatch) {
        return globalMatch[1];
    }

    // Fallback: use last 3 segments for uniqueness
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

/**
 * Extract gallery images from Puma HTML.
 * 
 * Puma structure:
 * - Gallery container: #product-gallery
 * - Images use CDN: images.puma.com/image/upload/...
 * - Exclude: #style-picker (color swatches), /video/upload/ (videos)
 */
function extractPumaGalleryUrlsFromHtml(html: string | undefined, baseOrigin: string): string[] {
    if (!html) return [];

    const urls: string[] = [];

    // Method 1 (Primary): Look for images in #product-gallery container
    // Match the product-gallery section and extract img srcs from it
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

/**
 * Upgrade URL to highest available resolution.
 * Replace w_600,h_600 with w_2000,h_2000
 */
function upgradeToHighRes(url: string): string {
    // Replace any w_XXX,h_XXX with w_2000,h_2000 for highest resolution
    return url.replace(/w_\d+,h_\d+/i, 'w_2000,h_2000');
}

export function pumaOverridePrompt(originalUrl: string): string {
    const productId = pumaProductIdFromUrl(originalUrl);
    const productLine = productId
        ? `Puma product_id for THIS PDP: ${productId}`
        : 'Puma product_id for THIS PDP: (unknown)';

    return [
        'PUMA OVERRIDE (images only):',
        productLine,
        '',
        'The primary product gallery images are in: #product-gallery',
        'CDN pattern: images.puma.com/image/upload/',
        '',
        'Image URL patterns:',
        '- w_2000,h_2000 = highest resolution (prefer this)',
        '- w_600,h_600 = default gallery size',
        '- w_100,h_100 = style picker thumbnails (exclude)',
        '',
        'IMAGES REQUIREMENTS (critical):',
        '- Extract ALL product gallery images from #product-gallery in natural order.',
        '- Prefer highest resolution (w_2000,h_2000).',
        '- EXCLUDE: style picker thumbnails (w_100), videos (/video/upload/), recommendations, similar products.',
        '',
        'Return an images array of objects { url, is_primary_suggestion?, sort_order_suggestion? } with the first image as primary.'
    ].join('\n');
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

    // Extract from HTML first (most reliable)
    const htmlGallery = extractPumaGalleryUrlsFromHtml(rawHtml ?? html, baseOrigin);

    // Collect all candidates
    const candidates: string[] = [];
    if (htmlGallery.length) candidates.push(...htmlGallery);

    // Also get from JSON if available
    const jsonImages = normalizeImageUrls(json['images']);
    if (jsonImages.length) candidates.push(...jsonImages);

    // Normalize and filter to only valid Puma image URLs
    const normalizedCandidates = candidates
        .map((url) => normalizeUrl(decodeHtmlEntities(url), baseOrigin))
        .filter((url): url is string => Boolean(url) && looksLikePumaImageUrl(url as string))
        .map(upgradeToHighRes); // Upgrade to highest resolution

    // Deduplicate by base asset key, keeping highest resolution for each
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

    // Sort by original appearance order
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

export function isPumaHostname(hostname: string): boolean {
    const normalized = normalizeHostname(hostname);
    // Support all Puma regional domains: puma.com, in.puma.com, eu.puma.com, etc.
    return normalized === 'puma.com' ||
        normalized.endsWith('.puma.com');
}
