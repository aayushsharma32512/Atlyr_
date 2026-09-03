const POPULAR_SHOPPING_DOMAINS = [
  "adidas.co.in",
  "adidas.com",
  "ajio.com",
  "amazon.ae",
  "amazon.ca",
  "amazon.co.jp",
  "amazon.co.uk",
  "amazon.com",
  "amazon.com.au",
  "amazon.de",
  "amazon.es",
  "amazon.fr",
  "amazon.in",
  "amazon.it",
  "aliexpress.com",
  "asos.com",
  "bewakoof.com",
  "ebay.com",
  "etsy.com",
  "farfetch.com",
  "flipkart.com",
  "hm.com",
  "lifestylestores.com",
  "maxfashion.in",
  "meesho.com",
  "macys.com",
  "myntra.com",
  "net-a-porter.com",
  "nike.com",
  "nordstrom.com",
  "nykaa.com",
  "nykaafashion.com",
  "puma.com",
  "shoppersstop.com",
  "snapdeal.com",
  "ssense.com",
  "tatacliq.com",
  "target.com",
  "temu.com",
  "thesouledstore.com",
  "uniqlo.com",
  "urbanic.com",
  "walmart.com",
  "westside.com",
  "zara.com",
  "zalando.com",
] as const

function hasValue(value: unknown): boolean {
  return (typeof value === "number" && Number.isFinite(value))
    || (typeof value === "string" && Boolean(value.trim()))
}

function formatPriceValue(value: unknown, currency: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const currencyLabel = typeof currency === "string" ? currency.trim() : ""
  return currencyLabel ? `${currencyLabel} ${value}` : String(value)
}

export function getLensPriceLabel(match: Record<string, unknown>): string | null {
  if (match.price && typeof match.price === "object" && !Array.isArray(match.price)) {
    const price = match.price as Record<string, unknown>
    const nestedPrice = formatPriceValue(price.value, price.currency)
      ?? formatPriceValue(price.extracted_value, price.currency)
    if (nestedPrice) return nestedPrice
  }
  return formatPriceValue(match.price, match.currency)
    ?? formatPriceValue(match.extracted_price, match.currency)
}

function hasPrice(match: Record<string, unknown>): boolean {
  return getLensPriceLabel(match) !== null
}

function hasRatingAndReviews(match: Record<string, unknown>): boolean {
  if (!hasValue(match.rating) || !hasValue(match.reviews)) return false
  const reviews = typeof match.reviews === "number"
    ? match.reviews
    : Number(String(match.reviews).replace(/[^\d.]/g, ""))
  return Number.isFinite(reviews) && reviews > 0
}

export function hasCommerceMetadata(match: Record<string, unknown>): boolean {
  return hasPrice(match)
    || typeof match.in_stock === "boolean"
    || hasRatingAndReviews(match)
}

export function isPopularShoppingUrl(value: unknown): boolean {
  if (typeof value !== "string") return false
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")
    return POPULAR_SHOPPING_DOMAINS.some((domain) => (
      hostname === domain || hostname.endsWith(`.${domain}`)
    ))
  } catch {
    return false
  }
}

export function isShoppingResult(match: Record<string, unknown>): boolean {
  return hasCommerceMetadata(match) || isPopularShoppingUrl(match.link)
}

export function filterShoppingResults(matches: Record<string, unknown>[]): Record<string, unknown>[] {
  return matches.filter(isShoppingResult)
}
