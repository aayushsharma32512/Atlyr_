import type { SegmentDimensions } from "@/features/studio/types"

/**
 * Hair SVG loading, sanitizing and recolouring for the legacy DOM renderer.
 *
 * These helpers used to live privately inside AvatarRenderer.tsx; they are a plain extraction, so
 * that file reads as layout rather than as asset plumbing. The Pixi placement renderer does NOT use
 * them — it draws pre-baked PNG cutouts from public/hair-baked/ instead.
 */

// Kept in sync with AvatarRenderer's segment cache version so a bump clears both together.
const SVG_CACHE_VERSION = 5
const HAIR_SVG_CACHE_KEY = `landing-mannequin-hair-svg-cache-v${SVG_CACHE_VERSION}`
const HAIR_SVG_CACHE_PREVIOUS_KEY = `landing-mannequin-hair-svg-cache-v${SVG_CACHE_VERSION - 1}`

type HairAssetEntry = { markup: string; dimensions: SegmentDimensions }

const hairAssetCache = new Map<string, HairAssetEntry>()

try {
  localStorage.removeItem(HAIR_SVG_CACHE_PREVIOUS_KEY)
} catch {
  // Ignore localStorage errors (private browsing, etc.)
}

try {
  const stored = localStorage.getItem(HAIR_SVG_CACHE_KEY)
  if (stored) {
    const parsed = JSON.parse(stored) as Record<string, HairAssetEntry>
    Object.entries(parsed).forEach(([key, value]) => {
      hairAssetCache.set(key, value)
    })
  }
} catch {
  // Ignore localStorage errors (private browsing, etc.)
}

function saveHairCacheToStorage() {
  try {
    const obj: Record<string, HairAssetEntry> = {}
    hairAssetCache.forEach((value, key) => {
      obj[key] = value
    })
    localStorage.setItem(HAIR_SVG_CACHE_KEY, JSON.stringify(obj))
  } catch {
    // Ignore localStorage errors
  }
}

function sanitizeHairSvgMarkup(raw: string): string {
  let result = raw
  result = result.replace(/<rect[^>]*fill="#ffffff"[^>]*>/gi, "")
  result = result.replace(/width="[^"]*"/i, 'width="100%"')
  result = result.replace(/height="[^"]*"/i, 'height="100%"')
  if (!/preserveAspectRatio/i.test(result)) {
    result = result.replace(/<svg/i, '<svg preserveAspectRatio="xMidYMid meet"')
  }
  return result
}

export function extractSvgDimensions(markup: string): SegmentDimensions {
  const viewBoxMatch = markup.match(/viewBox="([^"]+)"/i)
  if (viewBoxMatch) {
    const [, values] = viewBoxMatch
    const parts = values.split(/\s+/).map(Number)
    if (parts.length === 4) {
      const width = parts[2]
      const height = parts[3]
      if (Number.isFinite(width) && Number.isFinite(height)) {
        return { width, height }
      }
    }
  }
  const widthMatch = markup.match(/width="([^"]+)"/i)
  const heightMatch = markup.match(/height="([^"]+)"/i)
  const width = widthMatch ? Number(widthMatch[1].replace(/[^0-9.]/g, "")) : 100
  const height = heightMatch ? Number(heightMatch[1].replace(/[^0-9.]/g, "")) : 100
  return {
    width: Number.isFinite(width) && width > 0 ? width : 100,
    height: Number.isFinite(height) && height > 0 ? height : 100,
  }
}

export function normalizeHex(value: string | null | undefined) {
  if (!value) {
    return null
  }
  let hex = value.trim().toLowerCase()
  if (!hex) {
    return null
  }
  if (!hex.startsWith("#")) {
    hex = `#${hex}`
  }
  if (hex.length === 4) {
    const [r, g, b] = hex.slice(1).split("")
    hex = `#${r}${r}${g}${g}${b}${b}`
  }
  if (!/^#[0-9a-f]{6}$/.test(hex)) {
    return null
  }
  return hex
}

function normalizeHairFill(value: string) {
  const raw = value.trim().toLowerCase()
  if (raw === "none" || raw === "transparent" || raw === "currentcolor" || raw.startsWith("url(")) {
    return null
  }
  if (raw === "black") {
    return "#000000"
  }
  const normalized = normalizeHex(raw)
  if (normalized === "#000000") {
    return normalized
  }
  return null
}

/** Recolour the black fills of a hair silhouette. Non-black fills are left alone. */
export function applyHairColorToSvg(svgMarkup: string, hairColorHex: string) {
  const normalized = normalizeHex(hairColorHex)
  if (!normalized) {
    return svgMarkup
  }

  let updated = svgMarkup

  updated = updated.replace(/fill="([^"]+)"/gi, (match, value) => {
    const normalizedValue = normalizeHairFill(value)
    if (!normalizedValue) {
      return match
    }
    return `fill="${normalized}"`
  })

  updated = updated.replace(/fill:\s*([^;"]+)/gi, (match, value) => {
    const normalizedValue = normalizeHairFill(value)
    if (!normalizedValue) {
      return match
    }
    return `fill:${normalized}`
  })

  return updated
}

/**
 * Fetch + sanitize a hair SVG, memoised in memory and in localStorage.
 *
 * Both renderers go through here so there is one cache rather than two. Rejects are swallowed into
 * an empty-markup entry by the caller, matching the legacy renderer's behaviour of degrading to a
 * bald head rather than failing the whole avatar.
 */
export function peekHairSvg(url: string): HairAssetEntry | undefined {
  return hairAssetCache.get(url)
}

export async function fetchHairSvg(url: string): Promise<HairAssetEntry> {
  const cached = hairAssetCache.get(url)
  if (cached) {
    return cached
  }
  const response = await fetch(url)
  const raw = await response.text()
  const entry: HairAssetEntry = {
    markup: sanitizeHairSvgMarkup(raw),
    dimensions: extractSvgDimensions(raw),
  }
  hairAssetCache.set(url, entry)
  saveHairCacheToStorage()
  return entry
}
