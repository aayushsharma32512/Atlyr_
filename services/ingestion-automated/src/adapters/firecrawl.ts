import { config } from '../config/index';
import { withRetry } from '../utils/retry';
import { selectProfile } from './sites/registry';
import { isShopifySite, extractShopifyGenericImages } from './sites/shopify-generic';
import { applyGenericImageFilter } from './sites/generic-filter';
import { scrapeShopifyApi } from './sites/shopify';
import { resolveCurrency, extractOfferFromHtml, type CurrencySource } from './sites/currency';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'firecrawl' });

export interface FirecrawlProductResult {
  finalUrl: string;
  siteProfile: string | null;
  meta: {
    brand: string | null;
    product_name: string | null;
    description: string | null;
    price: number | null;
    currency: string | null;
    currency_source?: CurrencySource;
    currency_mismatch?: boolean;
    color: string | null;
    care?: string | null;
    accordions?: Array<{ title: string; content: string }>;
  };
  imageUrls: string[];
}

const PRODUCT_PROMPT = `Extract product data from this product detail page. Return a JSON object with:
- brand: brand/manufacturer name (string or null)
- product_name: full product name (string or null)
- description: product description text (string or null)
- price: price as a number in standard units e.g. 4000 for INR, 19.99 for USD (number or null)
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
        color:        null,
        care:         shopifyResult.care ?? null,
        accordions:   shopifyResult.accordions ?? [],
      },
      imageUrls: shopifyResult.imageUrls,
    };
  }

  if (!config.FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY is not set');

  const profile = selectProfile(url);
  const targetUrl = profile?.transformUrl ? profile.transformUrl(url) : url;

  return withRetry(
    async () => {
      // rawHtml is always requested now, not just for profiles that parse it directly: the cleaned
      // `html` drops <head> and <script>, which is where client-rendered PDPs keep their gallery
      // and their structured price/currency data. The generic filter uses it only as a fallback.
      const formats: string[] = ['json', 'html', 'rawHtml'];
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
          // Render from the catalogue's home market. Firecrawl's default proxies exit in the US,
          // and multi-currency storefronts (Fabindia, Tasva, Shopify Markets) localise off the
          // visitor IP — so an unpinned scrape returns a converted USD price for an INR product.
          location: { country: config.FIRECRAWL_COUNTRY, languages: [config.FIRECRAWL_LANGUAGE] },
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
      const cleanedHtml = typeof data['html'] === 'string' ? data['html'] : undefined;
      const rawHtml = typeof data['rawHtml'] === 'string' ? data['rawHtml'] : undefined;
      const html = profile?.needsRawHtml ? rawHtml : cleanedHtml;
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
        imageUrls = applyGenericImageFilter(html, targetUrl, jsonImages, rawHtml);
      }

      if (imageUrls.length === 0 && jsonImages.length > 0) {
        // Filter returned nothing — fall back to LLM images rather than hard-failing
        imageUrls = jsonImages;
      }

      if (imageUrls.length === 0) throw new Error('No product images found on page');

      const detectedProfile = profile?.id ?? (isShopifySite(jsonImages) ? 'shopify-generic' : null);

      // Shopify structured data (JSON-LD, meta tags) always stores prices in
      // subunits (cents/paise). VLMs read these and return the raw value despite
      // prompt instructions. When we detect a Shopify page, divide by 100.
      let price = (json['price'] as number | null) ?? null;
      if (price != null && detectedProfile === 'shopify-generic') {
        price = Math.round(price / 100);
      }

      const pageHtml = rawHtml ?? cleanedHtml;
      const llmCurrency = (json['currency'] as string | null) ?? null;

      // Price and currency must come from ONE source or they can contradict each other. A JSON-LD
      // Offer carries both, so when the page has one it wins outright — including over the model's
      // price. That is what makes this robust to a geo-localised render: if the proxy was served
      // the US storefront, the model reads "$89" while the server-side Offer still declares
      // INR 2899, and taking the Offer whole keeps the amount and the code consistent.
      //
      // Scoped to the generic path: Shopify pages state prices in subunits, which the branch above
      // already compensates for, and mixing the two corrections would double-count.
      const offer = detectedProfile === null && pageHtml ? extractOfferFromHtml(pageHtml) : null;

      const resolved = resolveCurrency({
        html: pageHtml,
        host: new URL(finalUrl || targetUrl).hostname,
        llmCurrency,
        defaultCurrency: config.DEFAULT_CURRENCY,
      });

      const currency = offer ? offer.currency : resolved.currency;
      const currencySource = offer ? ('json-ld' as const) : resolved.source;
      if (offer && price != null && Math.abs(offer.price - price) > 0.01) {
        logger.warn(
          { url: targetUrl, modelPrice: price, offerPrice: offer.price, currency },
          'model price disagrees with the page Offer — using the Offer (page was likely rendered for another market)'
        );
      }
      if (offer) price = Math.round(offer.price);

      // A model that read a different currency than the page declares is the signature of a
      // localised render. Worth surfacing even when the Offer let us recover the right numbers.
      const localised = llmCurrency != null && llmCurrency.toUpperCase() !== currency;
      if (localised || resolved.mismatch) {
        logger.warn(
          { url: targetUrl, currency, modelCurrency: llmCurrency, source: currencySource, price },
          'scraped currency disagrees with the page or its storefront TLD — check for a localised price'
        );
      }

      return {
        finalUrl,
        siteProfile: detectedProfile,
        meta: {
          brand:        (json['brand'] as string | null)        ?? null,
          product_name: (json['product_name'] as string | null) ?? null,
          description:  (json['description'] as string | null)  ?? null,
          price,
          currency,
          currency_source:   currencySource,
          currency_mismatch: localised || resolved.mismatch,
          color:        (json['color'] as string | null)        ?? null,
        },
        imageUrls,
      };
    },
    { retries: 3, backoffMs: 1000 }
  );
}
