import type { InspirationWebResult } from "./types"

export function hasValidWebResultUrls(result: InspirationWebResult): boolean {
  try {
    const listingUrl = new URL(result.listingUrl)
    const imageUrl = new URL(result.imageUrl)
    const urls = [listingUrl, imageUrl]
    return urls.every((url) => {
      const hostname = url.hostname.toLowerCase()
      return (url.protocol === "https:" || url.protocol === "http:")
        && Boolean(hostname)
        && hostname !== "localhost"
        && !hostname.endsWith(".localhost")
        && !url.username
        && !url.password
    })
  } catch {
    return false
  }
}

export function filterValidWebResults(results: InspirationWebResult[]): InspirationWebResult[] {
  return results.filter(hasValidWebResultUrls)
}
