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
    .filter((url): url is string => Boolean(url) && !looksLikeUnrelatedImage(url));
    
  if (!html) {
    return cleanJsonImages;
  }
  
  // Extract trusted images from JSON-LD and OG tags
  const jsonLdImages = extractJsonLdProductImages(html)
    .map(url => normalizeUrl(url, baseOrigin))
    .filter((url): url is string => Boolean(url) && !looksLikeUnrelatedImage(url));
    
  const ogImages = extractOgImages(html)
    .map(url => normalizeUrl(url, baseOrigin))
    .filter((url): url is string => Boolean(url) && !looksLikeUnrelatedImage(url));
    
  const galleryImages = extractGenericGalleryImages(html, baseOrigin)
    .map(url => normalizeUrl(url, baseOrigin))
    .filter((url): url is string => Boolean(url) && !looksLikeUnrelatedImage(url));
    
  const trustedImages = [...new Set([...jsonLdImages, ...ogImages, ...galleryImages])];
  
  if (trustedImages.length === 0) {
    // If no trusted images parsed, just return the filtered LLM images
    return cleanJsonImages;
  }
  
  // Use trusted images to filter cleanJsonImages.
  // We want to keep jsonImages that match trusted images, or share the same base key (filename)
  // or domain + subdirectory as a trusted image (to filter out other products).
  const trustedKeys = new Set(trustedImages.map(getBaseAssetKey));
  
  const filtered = cleanJsonImages.filter(url => {
    // Check direct URL match
    if (trustedImages.includes(url)) return true;
    
    // Check base asset key match (e.g. name of the image file matches)
    const key = getBaseAssetKey(url);
    if (trustedKeys.has(key)) return true;
    
    // Check if the keys share a common prefix of at least 4 characters
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
    return filtered;
  }
  
  // If the filter would discard everything, fall back to trustedImages itself, 
  // and if that is empty, fall back to cleanJsonImages
  return trustedImages.length > 0 ? trustedImages : cleanJsonImages;
}
