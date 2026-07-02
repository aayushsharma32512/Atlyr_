import { config } from '../config/index';
import { withRetry } from '../utils/retry';

export interface FirecrawlProductResult {
  finalUrl: string;
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

function extractImageUrls(images: unknown): string[] {
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
  if (!config.FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY is not set');

  return withRetry(
    async () => {
      const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['json'],
          jsonOptions: { prompt: PRODUCT_PROMPT },
          actions: [
            { type: 'wait', milliseconds: 1500 },
            { type: 'scroll', direction: 'down' },
            { type: 'wait', milliseconds: 1000 },
          ],
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
      const metadata = (data['metadata'] ?? {}) as Record<string, unknown>;

      const finalUrl = (metadata['sourceURL'] ?? metadata['sourceUrl'] ?? url) as string;

      const imageUrls = extractImageUrls(json['images']);
      if (imageUrls.length === 0) throw new Error('No product images found on page');

      return {
        finalUrl,
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
