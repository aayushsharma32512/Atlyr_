function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeOriginFromUrl(url: string, fallback: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return fallback;
  }
}

function normalizeUrl(rawUrl: string, baseOrigin: string): string | null {
  const cleaned = (rawUrl || '').trim().replace(/&amp;/g, '&');
  if (!cleaned) return null;
  if (cleaned.startsWith('//')) return `https:${cleaned}`;
  if (cleaned.startsWith('http')) return cleaned;
  if (cleaned.startsWith('/')) return `${baseOrigin}${cleaned}`;
  return `${baseOrigin}/${cleaned}`;
}
function decodeHtmlEntities(value: string): string {
  if (!value) return value;
  return value.replace(/&quot;|\\u0026quot;|&amp;|\\u0026amp;|\\u003d|\\u002f/g, (t) => {
    if (t === '&quot;' || t === '\\u0026quot;') return '"';
    if (t === '&amp;' || t === '\\u0026amp;') return '&';
    if (t === '\\u003d') return '=';
    if (t === '\\u002f') return '/';
    return t;
  });
}
function parseSrcsetLargest(srcset: string): string | null {
  let bestUrl: string | null = null;
  let bestScore = -1;
  for (const part of srcset.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [url, descriptor = ''] = part.split(/\s+/).filter(Boolean);
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

export function getBaseAssetKey(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const lastSlash = pathname.lastIndexOf('/');
    let filename = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
    
    filename = filename.replace(/\.[^/.]+$/, "");
    
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
  
  if (/\.(svg|gif)(?:\?|$)/i.test(lower)) return true;
  
  const blocklistedDomains = [
    'doubleclick', 'google-analytics', 'googletagmanager', 'facebook.com',
    'facebook.net', 'pinterest.com', 'instagram.com', 'twitter.com',
    'tiktok.com', 'snapchat', 'adroll', 'criteo', 'hotjar', 'yotpo',
    'klaviyo', 'trustpilot', 'mcafee', 'norton', 'ads-twitter', 'fls.doubleclick'
  ];
  if (blocklistedDomains.some(domain => lower.includes(domain))) return true;

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
        
        for (const key of Object.keys(obj)) {
          traverse(obj[key]);
        }
      };
      
      traverse(parsed);
    } catch {
      // Ignore
    }
  }
  
  return [...new Set(images.filter(Boolean))];
}

export function extractOgImages(html: string): string[] {
  const images: string[] = [];
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

export function extractGenericGalleryImages(html: string, baseOrigin: string): string[] {
  const urls: string[] = [];
  const galleryContainerRe = /(?:class|id)=["']([^"']*(?:product-gallery|product-images|product-media|pdp-image|gallery-image|main-image|product-detail|product-slideshow)[^"']*)["']/gi;
  const excludeContainerRe = /(?:recommend|also-like|cross-sell|related|similar|recently-viewed|upsell|you-may-like)/i;
  
  const matches = [...html.matchAll(galleryContainerRe)];
  
  for (const match of matches) {
    const classOrIdVal = match[1] ?? '';
    if (excludeContainerRe.test(classOrIdVal)) {
      continue;
    }
    
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
      
      const srcsetMatch = tag.match(/(?:data-srcset|srcset)=["']([^"']+)["']/i);
      if (srcsetMatch) {
        const srcsetDecoded = decodeHtmlEntities(srcsetMatch[1] ?? '');
        const largest = parseSrcsetLargest(srcsetDecoded);
        const norm = largest ? normalizeUrl(largest, baseOrigin) : null;
        if (norm) urls.push(norm);
      }
      
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

export function applyDefaultImageFilter(params: {
  originalUrl: string;
  finalUrl: string;
  json: Record<string, unknown>;
  metadata: Record<string, unknown>;
  html?: string;
  rawHtml?: string;
  imageUrls: string[];
}): {
  json: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  imageUrls: string[];
} {
  const { originalUrl, finalUrl, json, metadata, html, rawHtml, imageUrls } = params;
  const baseOrigin = safeOriginFromUrl(finalUrl ?? originalUrl, new URL(originalUrl).origin);
  
  const cleanJsonImages = imageUrls
    .map(url => normalizeUrl(url, baseOrigin))
    .filter((url): url is string => typeof url === 'string' && !looksLikeUnrelatedImage(url));
    
  const contentHtml = rawHtml ?? html;
  if (!contentHtml) {
    const out = { ...json };
    out['images'] = cleanJsonImages.map((url, idx) => ({
      url,
      sort_order_suggestion: idx,
      is_primary_suggestion: idx === 0
    }));
    return { json: out, imageUrls: cleanJsonImages, metadata };
  }
  
  const jsonLdImages = extractJsonLdProductImages(contentHtml)
    .map(url => normalizeUrl(url, baseOrigin))
    .filter((url): url is string => typeof url === 'string' && !looksLikeUnrelatedImage(url));
    
  const ogImages = extractOgImages(contentHtml)
    .map(url => normalizeUrl(url, baseOrigin))
    .filter((url): url is string => typeof url === 'string' && !looksLikeUnrelatedImage(url));
    
  const galleryImages = extractGenericGalleryImages(contentHtml, baseOrigin)
    .map(url => normalizeUrl(url, baseOrigin))
    .filter((url): url is string => typeof url === 'string' && !looksLikeUnrelatedImage(url));
    
  const trustedImages = [...new Set([...jsonLdImages, ...ogImages, ...galleryImages])];
  
  if (trustedImages.length === 0) {
    const out = { ...json };
    out['images'] = cleanJsonImages.map((url, idx) => ({
      url,
      sort_order_suggestion: idx,
      is_primary_suggestion: idx === 0
    }));
    return { json: out, imageUrls: cleanJsonImages, metadata };
  }
  
  const trustedKeys = new Set(trustedImages.map(getBaseAssetKey));
  
  const filtered = cleanJsonImages.filter(url => {
    if (trustedImages.includes(url)) return true;
    
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
  
  const finalUrls = filtered.length > 0 ? filtered : (trustedImages.length > 0 ? trustedImages : cleanJsonImages);
  
  const out = { ...json };
  out['images'] = finalUrls.map((url, idx) => ({
    url,
    sort_order_suggestion: idx,
    is_primary_suggestion: idx === 0
  }));
  
  return { json: out, imageUrls: finalUrls, metadata };
}
