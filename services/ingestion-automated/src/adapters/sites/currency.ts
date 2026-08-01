// Store-currency resolution, shared by the Shopify fast path and the Firecrawl fallback.
//
// Multi-currency storefronts (SAP Hybris, Magento, Shopify Markets) pick a currency from the
// visitor's IP. A scraper rendering from a US datacentre therefore sees a US-localised page and
// reads a USD price off it — correct for what was on screen, wrong for the catalogue. The primary
// defence is pinning the render location (see FIRECRAWL_COUNTRY); this module is the second one:
// prefer the currency the page states in structured data over whatever a vision model read off
// the rendered price, and fall back to the market default only when the page says nothing at all.

// 'json-ld' means the price and the currency were taken together from one Offer node — the only
// source that guarantees the two agree. The rest supply a currency alone.
export type CurrencySource = 'json-ld' | 'html' | 'llm' | 'tld' | 'default';

export interface ResolvedCurrency {
  currency: string;
  source: CurrencySource;
  /** True only when a country-specific TLD implies a currency and the resolved one differs. */
  mismatch: boolean;
}

// Country-code TLDs that pin a storefront to one market. Generic TLDs (.com, .co, .store, .shop)
// are deliberately absent: an Indian D2C brand on a .com is the norm, not a signal, and treating
// .com as USD is what makes a geo-localised scrape look correct.
const TLD_CURRENCY: Array<[RegExp, string]> = [
  [/\.in$|\.in\./, 'INR'],
  [/\.uk$|\.gb$|\.uk\./, 'GBP'],
  [/\.ca$/, 'CAD'],
  [/\.au$/, 'AUD'],
  [/\.eu$/, 'EUR'],
  [/\.sg$/, 'SGD'],
  [/\.ae$/, 'AED'],
];

/** The currency a country-specific TLD implies, or null when the domain says nothing. */
export function currencyFromTld(host: string): string | null {
  const h = host.toLowerCase();
  for (const [pattern, currency] of TLD_CURRENCY) {
    if (pattern.test(h)) return currency;
  }
  return null;
}

/**
 * The store currency as the page itself declares it. Tries, in order: the `Shopify.currency.active`
 * global, JSON-LD `priceCurrency`, SAP Hybris / Magento `currencyIso` / `currency_code`, then
 * og/product price currency meta tags. Returns a 3-letter ISO code, or null if none are present.
 *
 * Note this reads the page AS RENDERED — on a geo-switching storefront it reports the currency the
 * scraper was served, not the home-market one. That is deliberate: it keeps price and currency
 * consistent with each other, which a blind TLD override would not.
 */
export function extractCurrencyFromHtml(html: string): string | null {
  if (!html) return null;
  const patterns = [
    /Shopify\.currency\s*=\s*\{[^}]*?["']active["']\s*:\s*["']([A-Za-z]{3})["']/,
    /["']priceCurrency["']\s*:\s*["']([A-Za-z]{3})["']/,
    /["'](?:currencyIso|currency_code|currencyCode)["']\s*:\s*["']([A-Za-z]{3})["']/,
    /(?:property|name)=["'](?:og:price:currency|product:price:currency)["']\s+content=["']([A-Za-z]{3})["']/i,
  ];
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

export interface StructuredOffer {
  price: number;
  currency: string;
}

function coercePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Price AND currency read from the same JSON-LD Offer node.
 *
 * Taking them together is the point. Reading the currency from structured data while the amount
 * comes from a vision model is how a ₹2899 kurta became "INR 89": the page was rendered for a US
 * visitor so the model read "$89", while the server-side JSON-LD still declared INR. Either source
 * alone is self-consistent; mixing them is not. Returns null unless one node supplies both.
 */
export function extractOfferFromHtml(html: string): StructuredOffer | null {
  if (!html) return null;
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptRe)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse((match[1] ?? '').trim());
    } catch {
      continue;
    }

    const stack: unknown[] = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { stack.push(...node); continue; }

      const obj = node as Record<string, unknown>;
      const currency = obj['priceCurrency'];
      // AggregateOffer exposes a range rather than a single price; its low end is the sale price.
      const price = coercePrice(obj['price'] ?? obj['lowPrice']);
      if (typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) && price != null) {
        return { price, currency: currency.toUpperCase() };
      }

      for (const key of Object.keys(obj)) stack.push(obj[key]);
    }
  }
  return null;
}

/**
 * Picks the currency to record for a scraped product, preferring the page's own structured data
 * over the model's reading of it. Never rewrites a currency to match the domain — a currency that
 * disagrees with its own price amount is worse than one that disagrees with the TLD — but does
 * report the disagreement so the row can be reviewed before promotion.
 */
export function resolveCurrency(params: {
  html?: string;
  host: string;
  llmCurrency?: string | null;
  defaultCurrency?: string;
}): ResolvedCurrency {
  const { html, host, llmCurrency, defaultCurrency = 'INR' } = params;
  const expected = currencyFromTld(host);
  const flag = (currency: string) => expected != null && currency !== expected;

  const fromHtml = html ? extractCurrencyFromHtml(html) : null;
  if (fromHtml) return { currency: fromHtml, source: 'html', mismatch: flag(fromHtml) };

  const fromLlm = (llmCurrency ?? '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(fromLlm)) return { currency: fromLlm, source: 'llm', mismatch: flag(fromLlm) };

  if (expected) return { currency: expected, source: 'tld', mismatch: false };
  return { currency: defaultCurrency.toUpperCase(), source: 'default', mismatch: false };
}
