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
        return 'https://www.nykaafashion.com';
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
 * Nykaa Fashion product images are hosted on their CDN with URLs like:
 * https://adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/...
 */
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
    // Additional CDN patterns
    if (lower.includes('images-static.nykaa.com/')) return true;
    return false;
}

/**
 * Parse srcset and return the largest resolution URL.
 * Nykaa uses format like: "url1 1x, url2 2x, url3 3x"
 */
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
        // Match width descriptor (e.g., "1024w")
        const mW = descriptor.match(/^(\d+)w$/i);
        if (mW) score = Number(mW[1]);
        // Match density descriptor (e.g., "2x", "3x")
        const mX = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
        if (!mW && mX) score = Math.floor(Number(mX[1]) * 1000);
        if (score > bestScore) {
            bestScore = score;
            bestUrl = url;
        }
    }
    return bestUrl;
}

/**
 * Extract product ID from Nykaa URL.
 * Example: /cider-faux-leather-solid-split-mini-skirt/p/17910578
 * Returns: "17910578"
 */
export function nykaaProductIdFromUrl(url: string): string | null {
    try {
        const pathname = new URL(url).pathname;
        // Pattern: /product-name/p/<productId>
        const match = pathname.match(/\/p\/(\d+)/);
        return match?.[1] ?? null;
    } catch {
        return null;
    }
}

/**
 * Base asset key for deduplication.
 * Strips query params and resolution transforms to identify unique images.
 */
function nykaaBaseAssetKey(url: string): string {
    const withoutQuery = url.split('?')[0] ?? url;
    // Remove resolution suffix patterns like _Black_1, _Black_2
    // Keep the base filename without variant suffixes for grouping
    return withoutQuery;
}

/**
 * Parse resolution score from Nykaa URL.
 * Nykaa uses ?trw=128, ?trw=256, etc. for transformation width.
 */
function parseNykaaResolutionScore(url: string): number {
    try {
        const parsed = new URL(url);
        // trw = transformation width
        const trw = parsed.searchParams.get('trw');
        if (trw && /^\d+$/.test(trw)) return Number(trw) * 1_000_000;
        // Also check for rnd parameter as secondary (random cache buster, higher = newer)
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

/**
 * Extract gallery images from Nykaa HTML.
 * 
 * Nykaa structure (from screenshots):
 * - Images are in <img> tags with class containing "pdp-selector-img"
 * - They have data-at="pdp-product-image" attribute
 * - Container: div with css-la88oxd class (translateY transform for carousel)
 * - Each thumbnail: div with tabindex="0" and class like css-snjjyz
 */
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
        // Look for the gallery container area
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

/**
 * Extract the best (highest resolution) URL from an img tag.
 * Prefers srcset largest, falls back to src.
 */
function extractBestUrlFromImgTag(tag: string, baseOrigin: string): string | null {
    const tag_decoded = decodeHtmlEntities(tag);

    // Try srcset first (highest resolution)
    const srcsetMatch = tag_decoded.match(/srcset=["']([^"']+)["']/i);
    if (srcsetMatch) {
        const srcsetRaw = decodeHtmlEntities(srcsetMatch[1]);
        const largest = parseSrcsetLargest(srcsetRaw);
        if (largest) {
            const normalized = normalizeUrl(decodeHtmlEntities(largest), baseOrigin);
            if (normalized) return normalized;
        }
    }

    // Fall back to src
    const srcMatch = tag_decoded.match(/src=["']([^"']+)["']/i);
    if (srcMatch) {
        const srcRaw = decodeHtmlEntities(srcMatch[1]);
        const normalized = normalizeUrl(srcRaw, baseOrigin);
        if (normalized) return normalized;
    }

    return null;
}

export function nykaaOverridePrompt(originalUrl: string): string {
    const productId = nykaaProductIdFromUrl(originalUrl);
    const productLine = productId
        ? `Nykaa Fashion product_id for THIS PDP: ${productId}`
        : 'Nykaa Fashion product_id for THIS PDP: (unknown)';

    return [
        'NYKAA FASHION OVERRIDE (images only):',
        productLine,
        '',
        'The primary product gallery images are rendered as:',
        '- <img> tags with class containing "pdp-selector-img css-qyfk59"',
        '- <img> tags with data-at="pdp-product-image" attribute',
        '- Container: div with class css-la88oxd (translateY transform carousel)',
        '- Each thumbnail: div with tabindex="0"',
        '',
        'Image URLs are hosted on: adn-static1.nykaa.com/nykdesignstudio-images/pub/media/catalog/...',
        '',
        'IMAGES REQUIREMENTS (critical):',
        '- Extract ALL product gallery images from the thumbnail list in natural order.',
        '- Use srcset to get highest resolution (prefer 3x or largest trw value).',
        '- EXCLUDE: logos, icons, payment badges, recommendations, similar products, customer reviews.',
        '',
        'Return an images array of objects { url, is_primary_suggestion?, sort_order_suggestion? } with the first image as primary.'
    ].join('\n');
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
    const productId = nykaaProductIdFromUrl(originalUrl);

    // Extract from HTML first (most reliable)
    const htmlGallery = extractNykaaGalleryUrlsFromHtml(rawHtml ?? html, baseOrigin);

    // Collect all candidates
    const candidates: string[] = [];
    if (htmlGallery.length) candidates.push(...htmlGallery);

    // Also get from JSON if available
    const jsonImages = normalizeImageUrls(json['images']);
    if (jsonImages.length) candidates.push(...jsonImages);

    // Normalize and filter to only valid Nykaa image URLs
    const normalizedCandidates = candidates
        .map((url) => normalizeUrl(decodeHtmlEntities(url), baseOrigin))
        .filter((url): url is string => Boolean(url) && looksLikeNykaaImageUrl(url as string));

    // Deduplicate by base asset key, keeping highest resolution for each
    const bestByKey = new Map<string, { url: string; score: number; firstIndex: number }>();
    normalizedCandidates.forEach((url, index) => {
        const key = nykaaBaseAssetKey(url);
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

    // Sort by original appearance order
    const ordered = Array.from(bestByKey.values())
        .sort((a, b) => a.firstIndex - b.firstIndex)
        .map((entry) => entry.url);

    // If productId is known, prefer images that contain product-related patterns
    let finalUrls = ordered;
    if (productId && ordered.length === 0) {
        // Last resort: look for any Nykaa CDN images
        const fallback = normalizedCandidates.slice(0, 6);
        finalUrls = fallback;
    }

    const out: Record<string, unknown> = { ...json };
    out['images'] = finalUrls.map((url, idx) => ({
        url,
        sort_order_suggestion: idx,
        is_primary_suggestion: idx === 0
    }));

    return { json: out, imageUrls: finalUrls };
}

export function isNykaaHostname(hostname: string): boolean {
    const normalized = normalizeHostname(hostname);
    // Support both main Nykaa Fashion domain and potential subdomains
    return normalized === 'nykaafashion.com' ||
        normalized === 'nykaa.com' ||
        normalized.endsWith('.nykaa.com');
}
