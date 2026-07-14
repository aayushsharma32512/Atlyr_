import {
  normalizeUrl,
  parseSrcsetLargest,
  decodeHtmlEntities,
  safeOriginFromUrl,
} from './shared';

// Allowed CDN domains for e-commerce images
const ALLOWED_CDN_DOMAINS = [
  'shopify.com',
  'shopifycdn.com',
  'shopifycdn.net',
  'cloudinary.com',
  'wp.com',
  'amazonaws.com',
  'cloudfront.net',
  'fastly.net',
  'akamaihd.net',
  'googleusercontent.com',
  'imgix.net',
  'squarespace.com',
  'wixstatic.com',
  'supabase.co',
  'supabase.in',
  'webflow.com',
  'webflow.io',
  'shoppub.com',
  'cdninstagram.com',
  'fbcdn.net',
];

function getBaseDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  if (parts.length <= 2) return hostname;
  
  const penult = parts[parts.length - 2];
  const last = parts[parts.length - 1];
  const isDoubleBarrel = ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac'].includes(penult) && last.length === 2;
  
  if (isDoubleBarrel && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

// Extract base filename key for deduplication and matching
export function getBaseAssetKey(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const lastSlash = pathname.lastIndexOf('/');
    let filename = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
    
    // Remove file extension
    filename = filename.replace(/\.[^/.]+$/, "");
    
    // Normalize resolution/transform markers commonly added in shopify, myntra, puma, etc.
    // e.g. name_100x100, name_800x, name_large, name_crop_center, w_540, h_720, w_2000
    let key = filename
      .toLowerCase()
      .replace(/[-_]\d+w[x_-]\d+h/gi, '')
      .replace(/[-_]\d+x\d*/g, '')
      .replace(/[-_]\d+x/g, '')
      .replace(/[-_]crop(?:[-_]center)?/g, '')
      .replace(/[-_](?:large|medium|small|thumb|thumbnail|hero|front|back|side|detail|click|icon|avatar|brand)/g, '')
      .replace(/[,/]w_\d+[,/]h_\d+/gi, '')
      .replace(/[,/][wh]_\d+/gi, '');
      
    return key;
  } catch {
    const cleaned = url.split('?')[0] ?? url;
    return cleaned.toLowerCase();
  }
}

export function looksLikeUnrelatedImage(url: string): boolean {
  const lower = url.toLowerCase();
  
  // Exclude swatches, chips, and color thumbnails
  if (
    lower.includes('/chip/') || 
    lower.includes('/swatch/') || 
    lower.includes('swatch.jpg') || 
    lower.includes('chip.jpg') || 
    lower.includes('swatch_') || 
    lower.endsWith('-swatch') || 
    lower.includes('_chip') ||
    lower.includes('-swatch.jpg') ||
    lower.includes('-swatch.png')
  ) {
    return true;
  }
  
  // Exclude SVGs and GIFs (typically icons, trackers, or loaders)
  if (/\.(svg|gif)(?:\?|$)/i.test(lower)) return true;
  
  // Exclude tracking pixels, analytics, social widgets, ad platforms
  const blocklistedDomains = [
    'doubleclick', 'google-analytics', 'googletagmanager', 'facebook.com',
    'facebook.net', 'pinterest.com', 'instagram.com', 'twitter.com',
    'tiktok.com', 'snapchat', 'adroll', 'criteo', 'hotjar', 'yotpo',
    'klaviyo', 'trustpilot', 'mcafee', 'norton', 'ads-twitter', 'fls.doubleclick'
  ];
  if (blocklistedDomains.some(domain => lower.includes(domain))) return true;

  // Exclude standard icon/logo/payment keywords in PNGs or paths
  const blocklistedPatterns = [
    /payment[-_]/i,
    /visa/i,
    /mastercard/i,
    /paypal/i,
    /amex/i,
    /apple-pay/i,
    /google-pay/i,
    /trust-badge/i,
    /sprite/i,
    /loading/i,
    /spinner/i,
    /chevron/i,
    /arrow[-_]/i,
    /cart[-_]icon/i,
    /search[-_]icon/i,
    /menu[-_]icon/i,
    /close[-_]icon/i,
    /header[-_]logo/i,
    /footer[-_]logo/i,
    /logo[-_]white/i,
    /logo[-_]black/i,
    /logo[-_]color/i,
  ];
  if (blocklistedPatterns.some(pattern => pattern.test(lower))) return true;

  // PNG logos/placeholders
  if (/\.png(?:\?|$)/i.test(lower)) {
    const pngBlocklist = ['logo', 'icon', 'badge', 'avatar', 'banner', 'placeholder'];
    if (pngBlocklist.some(keyword => {
      const regex = new RegExp(`(?:\\/|[-_])${keyword}(?:\\/|[-_]|\\.)`, 'i');
      return regex.test(lower);
    })) {
      return true;
    }
  }

  return false;
}

// Signal 1: JSON-LD Product Schema Image Extractor
export function extractJsonLdProductImages(html: string): string[] {
  const images: string[] = [];
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  
  for (const match of html.matchAll(scriptRe)) {
    const jsonStr = match[1] ?? '';
    try {
      const decoded = decodeHtmlEntities(jsonStr.trim());
      const parsed = JSON.parse(decoded);
      
      const traverse = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        
        if (Array.isArray(obj)) {
          obj.forEach(traverse);
          return;
        }
        
        // Check if this object represents a Product
        const type = obj['@type'] ?? obj['type'];
        if (type === 'Product' || type === 'ProductModel') {
          const imgField = obj['image'];
          if (typeof imgField === 'string') {
            images.push(imgField);
          } else if (Array.isArray(imgField)) {
            imgField.forEach((img: any) => {
              if (typeof img === 'string') {
                images.push(img);
              } else if (img && typeof img === 'object' && typeof img.url === 'string') {
                images.push(img.url);
              }
            });
          } else if (imgField && typeof imgField === 'object' && typeof imgField.url === 'string') {
            images.push(imgField.url);
          }
        }
        
        // Continue traversing nested properties
        for (const key of Object.keys(obj)) {
          traverse(obj[key]);
        }
      };
      
      traverse(parsed);
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }
  
  return [...new Set(images.filter(Boolean))];
}

// Signal 2: OG Meta Image Extractor
export function extractOgImages(html: string): string[] {
  const images: string[] = [];
  
  // Matches <meta property="og:image" content="..." /> or similar
  const ogPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/gi,
    /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image["']/gi,
  ];
  
  for (const pattern of ogPatterns) {
    for (const match of html.matchAll(pattern)) {
      const url = match[1];
      if (url) {
        images.push(url.trim());
      }
    }
  }
  
  return [...new Set(images)];
}

// Signal 3: Generic E-commerce Gallery Heuristics
export function extractGenericGalleryImages(html: string, baseOrigin: string): string[] {
  const urls: string[] = [];
  
  // Look for gallery container divs/sections
  const galleryContainerRe = /(?:class|id)=["']([^"']*(?:product-gallery|product-images|product-media|pdp-image|gallery-image|main-image|product-detail|product-slideshow)[^"']*)["']/gi;
  const excludeContainerRe = /(?:recommend|also-like|cross-sell|related|similar|recently-viewed|upsell|you-may-like)/i;
  
  const matches = [...html.matchAll(galleryContainerRe)];
  
  for (const match of matches) {
    const classOrIdVal = match[1] ?? '';
    // Skip containers that explicitly look like recommendation/cross-sell areas
    if (excludeContainerRe.test(classOrIdVal)) {
      continue;
    }
    
    // Find container start index
    const startIdx = match.index ?? -1;
    if (startIdx < 0) continue;
    
    let block = html.slice(startIdx, Math.min(html.length, startIdx + 15000));
    const excludeIdx = block.search(/(?:class|id)=["'][^"']*(?:recommend|also-like|cross-sell|related|similar|recently-viewed|upsell|you-may-like)[^"']/i);
    if (excludeIdx > 0) {
      block = block.slice(0, excludeIdx);
    }
    
    const imgMatches = block.matchAll(/<img[^>]+>/gi);
    for (const imgMatch of imgMatches) {
      const tag = imgMatch[0] ?? '';
      
      // Extract from srcset first (preferred)
      const srcsetMatch = tag.match(/(?:data-srcset|srcset)=["']([^"']+)["']/i);
      if (srcsetMatch) {
        const srcsetDecoded = decodeHtmlEntities(srcsetMatch[1] ?? '');
        const largest = parseSrcsetLargest(srcsetDecoded);
        const norm = largest ? normalizeUrl(largest, baseOrigin) : null;
        if (norm) urls.push(norm);
      }
      
      // Fallback to src
      const srcMatch = tag.match(/(?:data-src|src)=["']([^"']+)["']/i);
      if (srcMatch) {
        const srcDecoded = decodeHtmlEntities(srcMatch[1] ?? '');
        const norm = normalizeUrl(srcDecoded, baseOrigin);
        if (norm) urls.push(norm);
      }
    }
  }
  
  return [...new Set(urls)];
}

export function filterByUrlNumericId(images: string[], originalUrl: string): string[] {
  const digitSequences = originalUrl.match(/\d{6,12}/g) || [];
  if (digitSequences.length === 0) {
    return images;
  }
  
  const matchedImages = images.filter(img => 
    digitSequences.some(seq => img.includes(seq))
  );
  
  if (matchedImages.length > 0) {
    return matchedImages;
  }
  
  return images;
}

// Extract images from product-ID-tagged grid containers (e.g. H&M's data-testid="grid-image-{id}_N")
function extractProductIdGridImages(html: string, originalUrl: string, baseOrigin: string): string[] {
  const digitSequences = originalUrl.match(/\d{6,12}/g) || [];
  if (digitSequences.length === 0) return [];

  const urls: string[] = [];
  for (const productId of digitSequences) {
    // Find all grid-image containers for this product ID
    const gridRe = new RegExp(`data-testid=["']grid-image-${productId}_\\d+["']`, 'gi');
    for (const match of html.matchAll(gridRe)) {
      const startIdx = match.index ?? -1;
      if (startIdx < 0) continue;

      // Extract a small block after this attribute to find the img inside
      const block = html.slice(startIdx, Math.min(html.length, startIdx + 3000));
      
      // Find img src/srcset in this block
      const imgMatches = block.matchAll(/<img[^>]+>/gi);
      for (const imgMatch of imgMatches) {
        const tag = imgMatch[0] ?? '';
        
        const srcsetMatch = tag.match(/(?:data-srcset|srcset)=["']([^"']+)["']/i);
        if (srcsetMatch) {
          const largest = parseSrcsetLargest(decodeHtmlEntities(srcsetMatch[1] ?? ''));
          const norm = largest ? normalizeUrl(largest, baseOrigin) : null;
          if (norm) urls.push(norm);
          continue; // prefer srcset over src
        }
        
        const srcMatch = tag.match(/(?:data-src|src)=["']([^"']+)["']/i);
        if (srcMatch) {
          const norm = normalizeUrl(decodeHtmlEntities(srcMatch[1] ?? ''), baseOrigin);
          if (norm) urls.push(norm);
        }
      }
    }
  }
  
  return [...new Set(urls)];
}

function parseGenericResolutionScore(url: string): number {
  const wMatch = url.match(/[,/_]w_(\d+)/i) || url.match(/[-_](\d+)x/i) || url.match(/[-_](\d+)w/i) || url.match(/\/t(\d+)\//i);
  if (wMatch) return Number(wMatch[1]);
  
  const dimsMatch = url.match(/[-_](\d+)Wx(\d+)H/i);
  if (dimsMatch) return Number(dimsMatch[1]) * Number(dimsMatch[2]);
  
  return 0;
}

function isImageFileOrPath(url: string): boolean {
  const lower = url.toLowerCase().split('?')[0] ?? '';
  if (/\.(jpg|jpeg|png|webp|gif|svg|bmp)(?:\?|$)/i.test(lower)) return true;
  if (
    lower.includes('/images/') || 
    lower.includes('/imagesgoods/') || 
    lower.includes('/media/') || 
    lower.includes('/upload/') ||
    lower.includes('/medias/')
  ) {
    return true;
  }
  return false;
}

function upgradeGenericResolution(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('uniqlo.com') && lower.includes('width=')) {
    return url.replace(/width=\d+/g, 'width=1000');
  }
  if (lower.includes('ajio.com') || lower.includes('sheinindia.in')) {
    return url.replace(/\d+Wx\d+H/gi, '1000Wx1250H');
  }
  return url;
}

// Extract any images in the HTML whose URL contains the numeric product ID sequence
function extractProductIdImagesFromHtml(html: string, originalUrl: string, baseOrigin: string): string[] {
  const digitSequences = originalUrl.match(/\d{5,12}/g) || [];
  if (digitSequences.length === 0) return [];

  const urls: string[] = [];
  for (const productId of digitSequences) {
    if (productId === '2026' || productId === '2025') continue;
    
    // Avoid syntax errors with backticks inside RegExp pattern
    const re = new RegExp('(?:https?:)?//[^\\s"\'>`]+' + productId + '[^\\s"\'>`]+', 'gi');
    for (const match of html.matchAll(re)) {
      const decoded = decodeHtmlEntities(match[0]);
      const norm = normalizeUrl(decoded, baseOrigin);
      if (norm && !looksLikeUnrelatedImage(norm) && isImageFileOrPath(norm)) {
        urls.push(norm);
      }
    }
  }
  
  return [...new Set(urls)];
}

function deduplicateImagesByKey(urls: string[]): string[] {
  const bestByKey = new Map<string, { url: string; score: number; firstIndex: number }>();
  urls.forEach((url, index) => {
    const key = getBaseAssetKey(url);
    const score = parseGenericResolutionScore(url);
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, { url, score, firstIndex: index });
      return;
    }
    if (score > existing.score) {
      bestByKey.set(key, { url, score, firstIndex: existing.firstIndex });
    }
  });

  return Array.from(bestByKey.values())
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map((entry) => entry.url);
}

// Core Generic Image Filter Function
export function applyGenericImageFilter(
  html: string | undefined,
  originalUrl: string,
  jsonImages: string[]
): string[] {
  const baseOrigin = safeOriginFromUrl(originalUrl, new URL(originalUrl).origin);
  
  // Clean raw LLM extracted images
  const cleanJsonImages = jsonImages
    .map(url => normalizeUrl(url, baseOrigin))
    .filter((url): url is string => url !== null && !looksLikeUnrelatedImage(url))
    .map(upgradeGenericResolution);
    
  if (!html) {
    return deduplicateImagesByKey(filterByUrlNumericId(cleanJsonImages, originalUrl));
  }
  
  // Signal 0 (highest trust): Product-ID-tagged grid containers or any image URLs containing product-ID in HTML
  const productIdGridImages = extractProductIdGridImages(html, originalUrl, baseOrigin)
    .filter(url => !looksLikeUnrelatedImage(url));
    
  const productIdHtmlImages = extractProductIdImagesFromHtml(html, originalUrl, baseOrigin);
  
  const combinedIdImages = [...new Set([...productIdGridImages, ...productIdHtmlImages])]
    .map(upgradeGenericResolution);

  if (combinedIdImages.length > 0) {
    const ordered = deduplicateImagesByKey(combinedIdImages);
    if (ordered.length > 0) return ordered;
  }

  // Extract trusted images from JSON-LD and OG tags
  const jsonLdImages = extractJsonLdProductImages(html)
    .map(url => normalizeUrl(url, baseOrigin))
    .filter((url): url is string => url !== null && !looksLikeUnrelatedImage(url));
    
  const ogImages = extractOgImages(html)
    .map(url => normalizeUrl(url, baseOrigin))
    .filter((url): url is string => url !== null && !looksLikeUnrelatedImage(url));
    
  const galleryImages = extractGenericGalleryImages(html, baseOrigin)
    .map(url => normalizeUrl(url, baseOrigin))
    .filter((url): url is string => url !== null && !looksLikeUnrelatedImage(url));
  
  // If the LLM extracted a reasonable number of images (1-10) and the gallery
  // returned a suspiciously large number (3x+ more), the gallery is likely polluted 
  // with cross-sell/recommendation images. Trust the LLM output instead.
  const llmCount = cleanJsonImages.length;
  const galleryCount = galleryImages.length;
  if (llmCount >= 1 && llmCount <= 10 && galleryCount > llmCount * 3) {
    return deduplicateImagesByKey(cleanJsonImages);
  }

  const rawTrustedImages = [...new Set([...jsonLdImages, ...ogImages, ...galleryImages])];
  const trustedImages = filterByUrlNumericId(rawTrustedImages, originalUrl);
  
  if (trustedImages.length === 0) {
    return deduplicateImagesByKey(filterByUrlNumericId(cleanJsonImages, originalUrl));
  }
  
  // Use trusted images to filter the combined candidates.
  const trustedKeys = new Set(trustedImages.map(getBaseAssetKey));
  
  const filtered = [...new Set([...cleanJsonImages, ...trustedImages])].filter(url => {
    if (trustedImages.includes(url)) return true;
    
    const key = getBaseAssetKey(url);
    if (trustedKeys.has(key)) return true;
    
    const hasBaseKeyPrefixMatch = Array.from(trustedKeys).some(tKey => {
      if (tKey.length >= 4 && (key.startsWith(tKey) || tKey.startsWith(key))) {
        return true;
      }
      return false;
    });
    if (hasBaseKeyPrefixMatch) return true;
    
    return false;
  });
  
  if (filtered.length > 0) {
    return deduplicateImagesByKey(filtered.map(upgradeGenericResolution));
  }
  
  return deduplicateImagesByKey(
    trustedImages.length > 0 
      ? trustedImages.map(upgradeGenericResolution) 
      : filterByUrlNumericId(cleanJsonImages, originalUrl)
  );
}
