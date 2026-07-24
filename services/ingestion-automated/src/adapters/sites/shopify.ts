import { looksLikeShopifyImageUrl, shopifyBaseAssetKey, parseShopifyResolutionScore, dedupeByResolution } from './shared';

export interface ShopifyApiResult {
  brand: string | null;
  product_name: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  imageUrls: string[];
  care?: string | null;
  accordions?: Array<{ title: string; content: string }>;
}

/**
 * Extracts the primary store name from a domain host, stripping common subdomains.
 * e.g. "www.toffle.in" -> "Toffle", "row.nishorama.com" -> "Nishorama"
 */
export function extractStoreNameFromHost(host: string): string {
  const cleanHost = host.toLowerCase().trim();
  const parts = cleanHost.split('.').filter(Boolean);
  if (parts.length === 0) return 'Brand';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);

  const SUBDOMAINS = new Set(['www', 'row', 'us', 'uk', 'store', 'shop', 'ca', 'eu', 'au', 'app', 'global', 'en', 'in', 'm', 'mobile', 'checkout']);
  let mainIndex = 0;
  if (parts.length >= 3 && SUBDOMAINS.has(parts[0])) {
    mainIndex = 1;
  }

  const rawName = parts[mainIndex] || parts[0];
  return rawName.charAt(0).toUpperCase() + rawName.slice(1);
}

/**
 * Dynamically resolves the canonical brand name for a Shopify store.
 * Cross-validates the vendor attribute returned by Shopify API against domain signals.
 * Handles D2C single-brand stores vs multi-brand platforms without hardcoded junk lists.
 */
export function resolveDynamicShopifyBrand(rawVendor: string | null | undefined, host: string): string {
  const domainBrand = extractStoreNameFromHost(host);
  const rawStoreName = domainBrand.toLowerCase();

  const vendorClean = (rawVendor || '').trim();
  if (!vendorClean || /^\d+$/.test(vendorClean) || vendorClean.length < 2) {
    return domainBrand;
  }

  const vendorSlug = vendorClean.toLowerCase().replace(/[^a-z0-9]/g, '');
  const domainSlug = rawStoreName.replace(/[^a-z0-9]/g, '');

  // 1. Exact or partial slug alignment (e.g., "Toffle" or "Toffle Official" on toffle.in)
  if (vendorSlug === domainSlug || vendorSlug.includes(domainSlug) || domainSlug.includes(vendorSlug)) {
    return vendorClean;
  }

  // 2. Multi-word brand names or uppercase brand acronyms (e.g. "Air Jordan", "FCUK")
  const isMultiWordOrAcronym = vendorClean.includes(' ') || (vendorClean === vendorClean.toUpperCase() && vendorClean.length >= 3);
  if (isMultiWordOrAcronym) {
    return vendorClean;
  }

  // 3. Single-word vendor tag on a D2C site that doesn't match the store domain (e.g., vendor="old" on toffle.in)
  // Fall back dynamically to the domain brand
  return domainBrand;
}

/**
 * Dynamically extracts product care instructions and website accordion disclosures
 * (e.g., General Instructions, Care for Prints, Hand Painted & Bleached, Raw Denim) from Shopify page HTML.
 */
export function extractShopifyCareAndAccordions(html: string): { care: string | null; accordions: Array<{ title: string; content: string }> } {
  if (!html) return { care: null, accordions: [] };

  const accordions: Array<{ title: string; content: string }> = [];
  const careTexts: string[] = [];

  // Match <details> or accordion disclosure elements in HTML
  const detailsRegex = /<details[^>]*>([\s\S]*?)<\/details>/gi;
  let match: RegExpExecArray | null;

  while ((match = detailsRegex.exec(html)) !== null) {
    const block = match[1];
    const summaryMatch = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(block);
    if (!summaryMatch) continue;

    const rawTitle = summaryMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    if (!rawTitle) continue;

    const contentBlock = block.slice(summaryMatch[0].length);
    const rawContent = contentBlock
      .replace(/^[^>]*>/, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();

    if (rawTitle && rawContent && rawContent.length > 5) {
      accordions.push({ title: rawTitle, content: rawContent });

      if (/care|wash|maintain|fabric|hand painted|bleached|denim|instruction/i.test(rawTitle)) {
        careTexts.push(`${rawTitle}: ${rawContent}`);
      }
    }
  }

  // Fallback regex search for care sections if no <details> disclosures were found
  if (careTexts.length === 0) {
    const careSectionRegex = /(?:how to care|care instructions|wash care|product care)[^<]*<\/h[1-6]>[\s\S]*?(?:<div[^>]*>([\s\S]*?)<\/div>|<p[^>]*>([\s\S]*?)<\/p>)/gi;
    let careMatch: RegExpExecArray | null;
    while ((careMatch = careSectionRegex.exec(html)) !== null) {
      const text = (careMatch[1] || careMatch[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && text.length > 10) {
        careTexts.push(text);
      }
    }
  }

  const care = careTexts.length > 0 ? careTexts.join('\n\n') : null;
  return { care, accordions };
}

/**
 * Attempts to fetch the Shopify product .js endpoint.
 * Returns structured metadata and images if successful, otherwise null.
 */
export async function scrapeShopifyApi(url: string): Promise<ShopifyApiResult | null> {
  console.log('[shopify-api] attempting pre-scrape for:', url);
  try {
    const parsed = new URL(url);
    
    // The Shopify product detail page endpoint is typically /products/{slug}
    // We append .js to fetch the raw JSON metadata directly.
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    const productsIndex = pathSegments.indexOf('products');
    
    if (productsIndex < 0 || productsIndex === pathSegments.length - 1) {
      return null;
    }
    
    const slug = pathSegments[productsIndex + 1];
    const jsUrl = `${parsed.origin}/products/${slug}.js`;
    
    const resp = await fetch(jsUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
      },
      signal: AbortSignal.timeout(8000)
    });
    
    if (!resp.ok) {
      console.log('[shopify-api] non-ok response:', resp.status, resp.statusText);
      return null;
    }
    
    const data = await resp.json() as Record<string, any>;
    if (!data || typeof data !== 'object' || !data.title || !Array.isArray(data.images)) {
      console.log('[shopify-api] invalid data shape, keys:', data ? Object.keys(data) : 'null');
      return null;
    }
    console.log('[shopify-api] success! vendor:', data.vendor, 'price:', data.price, 'images:', data.images?.length);
    
    // Clean and normalize image URLs to get the highest resolution possible
    const rawImages = data.images.map((img: string) => {
      let cleanImg = img.trim();
      if (cleanImg.startsWith('//')) {
        cleanImg = `https:${cleanImg}`;
      }
      return cleanImg;
    });
    
    const filteredImages = rawImages.filter(looksLikeShopifyImageUrl);
    const imageUrls = filteredImages.length > 0 
      ? dedupeByResolution(filteredImages, shopifyBaseAssetKey, parseShopifyResolutionScore)
      : rawImages;
      
    // Shopify .js endpoint returns price in cents/paise (e.g. 199900 for 1999.00)
    // We divide by 100 to convert to standard units (e.g. 1999) matching the database schema.
    const price = typeof data.price === 'number' ? Math.round(data.price / 100) : null;
    
    // Infer currency code based on the domain TLD
    const host = parsed.hostname.toLowerCase();
    let currency = 'USD';
    if (host.endsWith('.in') || host.includes('.in.')) {
      currency = 'INR';
    } else if (host.endsWith('.uk') || host.endsWith('.gb') || host.includes('.uk.')) {
      currency = 'GBP';
    } else if (host.endsWith('.ca')) {
      currency = 'CAD';
    } else if (host.endsWith('.au')) {
      currency = 'AUD';
    } else if (host.endsWith('.eu')) {
      currency = 'EUR';
    }
    
    // Derive brand dynamically via multi-signal cross-validation (zero hardcoded junk lists)
    const brand = resolveDynamicShopifyBrand(data.vendor, host);

    // Best-effort HTML fetch to extract website Accordions & Care disclosures
    let care: string | null = null;
    let accordions: Array<{ title: string; content: string }> = [];
    try {
      const pageResp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(4000)
      });
      if (pageResp.ok) {
        const html = await pageResp.text();
        const extracted = extractShopifyCareAndAccordions(html);
        care = extracted.care;
        accordions = extracted.accordions;
      }
    } catch {
      // Non-blocking: continue if HTML fetch times out
    }

    return {
      brand,
      product_name: data.title || null,
      description: data.description || null,
      price,
      currency,
      imageUrls,
      care,
      accordions
    };
  } catch (err) {
    console.log('[shopify-api] error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
