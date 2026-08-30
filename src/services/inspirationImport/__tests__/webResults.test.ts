import { filterValidWebResults, hasValidWebResultUrls } from "../webResults"
import type { InspirationWebResult } from "../types"

const validResult: InspirationWebResult = {
  id: "result-1",
  candidateId: "candidate-1",
  title: "Blue trousers",
  merchantDomain: "shop.example",
  listingUrl: "https://shop.example/products/blue-trousers",
  imageUrl: "https://cdn.example/images/blue-trousers.jpg",
  rank: 1,
}

describe("web result URL validation", () => {
  it("keeps results with absolute public HTTP URLs", () => {
    expect(hasValidWebResultUrls(validResult)).toBe(true)
  })

  it.each([
    "",
    "/products/blue-trousers",
    "javascript:alert(1)",
    "https://",
    "http://localhost/product",
    "https://user:password@shop.example/product",
  ])("rejects an invalid listing URL: %s", (listingUrl) => {
    expect(hasValidWebResultUrls({ ...validResult, listingUrl })).toBe(false)
  })

  it("removes invalid results from a response", () => {
    const invalidResult = { ...validResult, id: "result-2", listingUrl: "not-a-url" }
    expect(filterValidWebResults([invalidResult, validResult])).toEqual([validResult])
  })
})
