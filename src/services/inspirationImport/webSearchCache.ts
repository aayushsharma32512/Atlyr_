import type { InspirationWebResult } from "./types"
import { hasValidWebResultUrls } from "./webResults"

const CACHE_PREFIX = "atlyr:inspiration-web-search:v1:"
const CACHE_TTL_MS = 60 * 60 * 1000

type CacheEntry = {
  expiresAt: number
  results: InspirationWebResult[]
}

function cacheKey(importId: string, candidateId: string): string {
  return `${CACHE_PREFIX}${importId}:${candidateId}`
}

function isWebResult(value: unknown): value is InspirationWebResult {
  if (!value || typeof value !== "object") return false
  const result = value as Record<string, unknown>
  return typeof result.id === "string"
    && typeof result.candidateId === "string"
    && typeof result.providerResultId === "string"
    && typeof result.title === "string"
    && typeof result.merchantDomain === "string"
    && typeof result.listingUrl === "string"
    && typeof result.imageUrl === "string"
    && typeof result.rank === "number"
    && (result.priceLabel === null || typeof result.priceLabel === "string")
    && typeof result.selectionToken === "string"
    && hasValidWebResultUrls(result as InspirationWebResult)
}

export function readWebSearchCache(
  importId: string,
  candidateId: string,
  now = Date.now(),
): InspirationWebResult[] | null {
  if (typeof window === "undefined") return null
  const key = cacheKey(importId, candidateId)
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const cached = JSON.parse(raw) as CacheEntry
    if (!Number.isFinite(cached.expiresAt) || cached.expiresAt <= now
      || !Array.isArray(cached.results) || !cached.results.every(isWebResult)) {
      window.sessionStorage.removeItem(key)
      return null
    }
    return cached.results
  } catch {
    window.sessionStorage.removeItem(key)
    return null
  }
}

export function writeWebSearchCache(
  importId: string,
  candidateId: string,
  results: InspirationWebResult[],
  now = Date.now(),
): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(cacheKey(importId, candidateId), JSON.stringify({
      expiresAt: now + CACHE_TTL_MS,
      results,
    } satisfies CacheEntry))
  } catch {
    // A full or disabled browser store should not make online search unusable.
  }
}
