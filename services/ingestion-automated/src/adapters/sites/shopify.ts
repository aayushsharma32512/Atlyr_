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
      signal: AbortSignal.timeout(10000)
    });
    
    if (!resp.ok) return null;
    
    const data = await resp.json() as Record<string, any>;
    if (!data || typeof data !== 'object' || !data.title || !Array.isArray(data.images)) {
      return null;
    }
    
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
    const price = typeof data.price === 'number' ? data.price : null;
    
    return {
      brand: data.vendor || null,
      product_name: data.title || null,
      description: data.description || null,
      price,
      currency: null, // Shopify .js API doesn't guarantee currency field, we'll let firecrawl fallback resolve it if needed
      imageUrls
    };
  } catch {
    return null;
  }
}
