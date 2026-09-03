import {
  filterShoppingResults,
  getLensPriceLabel,
  hasCommerceMetadata,
  isPopularShoppingUrl,
  isShoppingResult,
} from "../../../../supabase/functions/_shared/inspiration-lens"

describe("Lens shopping-result classification", () => {
  it.each([
    { price: { value: "₹2,450", extracted_value: 2450, currency: "INR" } },
    { extracted_price: 2450 },
    { in_stock: true },
    { in_stock: false },
    { rating: 4.8, reviews: 18 },
  ])("accepts commerce metadata: %o", (match) => {
    expect(hasCommerceMetadata(match)).toBe(true)
  })

  it("does not treat a rating without reviews as commerce metadata", () => {
    expect(hasCommerceMetadata({ rating: 4.8 })).toBe(false)
  })

  it.each([
    [{ price: { value: "₹2,450", extracted_value: 2450, currency: "INR" } }, "₹2,450"],
    [{ price: { extracted_value: 2450, currency: "INR" } }, "INR 2450"],
    [{ extracted_price: 79.95, currency: "USD" }, "USD 79.95"],
    [{ price: {}, extracted_price: 42, currency: "EUR" }, "EUR 42"],
    [{ in_stock: true }, null],
  ])("normalizes the display price from %o", (match, expected) => {
    expect(getLensPriceLabel(match)).toBe(expected)
  })

  it.each([
    "https://www.amazon.in/dp/example",
    "https://fashion.myntra.com/product/example",
    "https://www.flipkart.com/example/p/123",
    "https://www.zara.com/in/en/example.html",
  ])("accepts a popular shopping domain: %s", (url) => {
    expect(isPopularShoppingUrl(url)).toBe(true)
  })

  it.each([
    "https://amazon.in.attacker.example/product",
    "https://notamazon.in/product",
    "ftp://amazon.in/product",
    "not-a-url",
  ])("rejects a domain lookalike or invalid URL: %s", (url) => {
    expect(isPopularShoppingUrl(url)).toBe(false)
  })

  it("rejects an unknown site without commerce metadata", () => {
    expect(isShoppingResult({ link: "https://example.com/article" })).toBe(false)
  })

  it("does not cap qualifying matches", () => {
    const matches = Array.from({ length: 35 }, (_, index) => ({
      link: `https://www.amazon.in/dp/product-${index}`,
    }))
    expect(filterShoppingResults(matches)).toHaveLength(35)
  })
})
