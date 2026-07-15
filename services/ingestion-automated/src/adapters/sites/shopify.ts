import { looksLikeShopifyImageUrl, shopifyBaseAssetKey, parseShopifyResolutionScore, dedupeByResolution } from './shared';

export interface ShopifyApiResult {
  brand: string | null;
  product_name: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  imageUrls: string[];
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
    
    // Derive brand: prefer vendor, but fall back to domain name when vendor looks
    // like junk (year, purely numeric, empty, or very short).
    let brand: string | null = data.vendor || null;
    if (!brand || /^\d+$/.test(brand) || brand.length < 2) {
      // Extract store name from domain: e.g. toffle.in → Toffle
      const parts = host.split('.');
      const storeName = parts[0] === 'www' ? (parts[1] ?? parts[0]) : parts[0];
      brand = storeName.charAt(0).toUpperCase() + storeName.slice(1);
    }

    return {
      brand,
      product_name: data.title || null,
      description: data.description || null,
      price,
      currency,
      imageUrls
    };
  } catch (err) {
    console.log('[shopify-api] error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
