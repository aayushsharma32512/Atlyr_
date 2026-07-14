import { config } from '../config/index';
import { withRetry } from '../utils/retry';
import { selectProfile } from './sites/registry';
import { isShopifySite, extractShopifyGenericImages } from './sites/shopify-generic';
import { applyGenericImageFilter } from './sites/generic-filter';
import { scrapeShopifyApi } from './sites/shopify';

export interface FirecrawlProductResult {
  finalUrl: string;
  siteProfile: string | null;
  meta: {
    brand: string | null;
    product_name: string | null;
    description: string | null;
    price: number | null;
    currency: string | null;
    color: string | null;
  };
  imageUrls: string[];
}

const PRODUCT_PROMPT = `Extract product data from this product detail page. Return a JSON object with:
- brand: brand/manufacturer name (string or null)
- product_name: full product name (string or null)
- description: product description text (string or null)
- price: price as a number in the smallest currency unit e.g. paise for INR, cents for USD (number or null)
- currency: ISO currency code e.g. INR, USD (string or null)
- color: primary color description (string or null)
- images: array of objects { url: string } containing ALL product gallery image URLs (front, back, side, detail views). Exclude recommendation sections, related products, ads, icons, and logos.`;

function extractJsonImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  const urls: string[] = [];
  for (const img of images) {
    if (typeof img === 'string' && img.startsWith('http')) urls.push(img);
    else if (typeof img === 'object' && img !== null && typeof (img as Record<string, unknown>)['url'] === 'string') {
      urls.push((img as Record<string, unknown>)['url'] as string);
    }
  }
  return [...new Set(urls)];
}

export async function scrapeProductPage(url: string): Promise<FirecrawlProductResult> {
  // 1. Try Shopify API first (fast, reliable, and does not require Firecrawl API key)
  const shopifyResult = await scrapeShopifyApi(url);
  if (shopifyResult) {
    return {
      finalUrl: url,
      siteProfile: 'shopify-api',
      meta: {
        brand:        shopifyResult.brand,
        product_name: shopifyResult.product_name,
        description:  shopifyResult.description,
        price:        shopifyResult.price,
        currency:     shopifyResult.currency,
        color:        null
      },
      imageUrls: shopifyResult.imageUrls,
    };
  }

  if (!config.FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY is not set');

  const profile = selectProfile(url);
  const targetUrl = profile?.transformUrl ? profile.transformUrl(url) : url;

  return withRetry(
    async () => {
      const formats: string[] = ['json', 'html'];
      const prompt = profile?.buildScrapePrompt ? `${PRODUCT_PROMPT}\n\n${profile.buildScrapePrompt(targetUrl)}` : PRODUCT_PROMPT;
      const actions = profile?.extraActions ?? [
        { type: 'wait', milliseconds: 1500 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 1000 },
      ];

      const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: targetUrl,
          formats,
          jsonOptions: { prompt },
          actions,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Firecrawl error ${resp.status}: ${body}`);
      }

      const payload = await resp.json() as Record<string, unknown>;
      const data = (payload['data'] ?? payload) as Record<string, unknown>;
      const json = (data['json'] ?? {}) as Record<string, unknown>;
      const html = typeof data['html'] === 'string' ? data['html'] : undefined;
      const metadata = (data['metadata'] ?? {}) as Record<string, unknown>;

      const finalUrl = (metadata['sourceURL'] ?? metadata['sourceUrl'] ?? targetUrl) as string;
      const jsonImages = extractJsonImages(json['images']);

      // Apply site-specific image filter; fall back to generic Shopify; then raw JSON images with generic filter.
      let imageUrls: string[];
      if (profile) {
        imageUrls = profile.postProcess({ originalUrl: targetUrl, finalUrl, html, jsonImages });
      } else if (isShopifySite(jsonImages)) {
        imageUrls = extractShopifyGenericImages(jsonImages);
      } else {
        imageUrls = applyGenericImageFilter(html, targetUrl, jsonImages);
      }

      if (imageUrls.length === 0 && jsonImages.length > 0) {
        // Filter returned nothing — fall back to LLM images rather than hard-failing
        imageUrls = jsonImages;
      }

      if (imageUrls.length === 0) throw new Error('No product images found on page');

      return {
        finalUrl,
        siteProfile: profile?.id ?? (isShopifySite(jsonImages) ? 'shopify-generic' : null),
        meta: {
          brand:        (json['brand'] as string | null)        ?? null,
          product_name: (json['product_name'] as string | null) ?? null,
          description:  (json['description'] as string | null)  ?? null,
          price:        (json['price'] as number | null)        ?? null,
          currency:     (json['currency'] as string | null)     ?? null,
          color:        (json['color'] as string | null)        ?? null,
        },
        imageUrls,
      };
    },
    { retries: 3, backoffMs: 1000 }
  );
}
