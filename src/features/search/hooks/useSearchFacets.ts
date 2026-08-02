import { useQuery } from "@tanstack/react-query"

import { supabase } from "@/integrations/supabase/client"

/** One selectable facet card — a value + a representative garment/scene image. */
export interface FacetOption {
  value: string
  label: string
  imageUrl?: string | null
  count: number
}

export type FacetKey = "occasion" | "vibe" | "fit" | "feel"

export interface FacetGroup {
  key: FacetKey
  label: string
  hint: string
  options: FacetOption[]
}

// Occasion rows that are plumbing, not real occasions — kept out of the room.
const OCCASION_SKIP = new Set(["others", "default"])

// Facet values (lowercased) → how many representative garments to skip. A manual
// nudge to a later distinct product when the default pick isn't wanted.
const ROTATE_IMAGE = new Map<string, number>([
  ["breathable", 1],
  ["party", 1],
  ["casual outing", 2],
])

const titleCase = (value: string) =>
  value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")

const cleanTag = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || trimmed === "null" || trimmed === "nan") return null
  return trimmed
}

type ProductFacetRow = {
  fit: string | null
  feel: string | null
  vibes: string | null
  image_url: string | null
  thumbnail_url: string | null
}

/**
 * Builds the facet options for the search room (6g) straight from the catalog:
 *  · occasions from the `occasions` table (deduped, real ones only)
 *  · vibe / fit / feel from the products' own tags, ranked by frequency, each
 *    carrying a representative product image so the card shows a real garment.
 */
async function fetchSearchFacets(): Promise<FacetGroup[]> {
  const [
    { data: occasionRows, error: occErr },
    { data: productRows, error: prodErr },
    { data: outfitRows, error: outfitErr },
  ] = await Promise.all([
    supabase.from("occasions").select("name, slug, background_url"),
    supabase
      .from("products")
      .select("fit, feel, vibes, image_url, thumbnail_url")
      .not("image_url", "is", null)
      .limit(1200),
    // A garment image per occasion — the occasion's own `background_url` is just a
    // colour scene, so we borrow the top piece from an outfit tagged that occasion.
    supabase
      .from("outfits")
      .select("occasion:occasions!occasion(name), top:products!outfits_top_id_fkey(image_url)")
      .eq("visible_in_feed", true)
      .not("top_id", "is", null)
      .limit(800),
  ])

  if (occErr) throw new Error(occErr.message)
  if (prodErr) throw new Error(prodErr.message)
  if (outfitErr) throw new Error(outfitErr.message)

  // A garment image never appears on two cards anywhere in the room.
  const usedImages = new Set<string>()

  // One distinct garment image per occasion name.
  const occasionImageByName = new Map<string, string>()
  const occasionSkipCount = new Map<string, number>()
  for (const row of (outfitRows ?? []) as Array<{ occasion?: { name?: string } | null; top?: { image_url?: string } | null }>) {
    const name = row.occasion?.name?.trim().toLowerCase()
    const img = row.top?.image_url
    if (!name || !img || occasionImageByName.has(name) || usedImages.has(img)) continue
    // Skip N valid picks for rotated occasions, take the one after.
    const skipNeeded = ROTATE_IMAGE.get(name) ?? 0
    const skipped = occasionSkipCount.get(name) ?? 0
    if (skipped < skipNeeded) {
      occasionSkipCount.set(name, skipped + 1)
      continue
    }
    occasionImageByName.set(name, img)
    usedImages.add(img)
  }

  // --- Occasions: dedupe by lowercased name, drop plumbing rows ---
  const occasionByName = new Map<string, FacetOption>()
  for (const row of occasionRows ?? []) {
    const name = (row.name ?? "").trim()
    const norm = name.toLowerCase()
    if (!name || OCCASION_SKIP.has(norm) || occasionByName.has(norm)) continue
    occasionByName.set(norm, {
      value: row.slug ?? name,
      label: name,
      imageUrl: occasionImageByName.get(norm) ?? row.background_url,
      count: 0,
    })
  }

  // --- vibe / fit / feel: tally + one DISTINCT representative image per value ---
  const tally = (field: "fit" | "feel" | "vibes") => {
    const counts = new Map<string, number>()
    const candidates = new Map<string, string[]>() // tag → candidate images (in row order)
    for (const row of (productRows ?? []) as ProductFacetRow[]) {
      const raw = row[field]
      if (!raw) continue
      const seen = new Set<string>()
      for (const part of String(raw).split(",")) {
        const tag = cleanTag(part)
        if (!tag || seen.has(tag)) continue
        seen.add(tag)
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
        if (row.image_url) {
          const list = candidates.get(tag) ?? []
          list.push(row.image_url)
          candidates.set(tag, list)
        }
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map<FacetOption>(([value, count]) => {
        // First candidate not already shown elsewhere; rotated values skip N more.
        const fresh = (candidates.get(value) ?? []).filter((url) => !usedImages.has(url))
        const pick = fresh[ROTATE_IMAGE.get(value) ?? 0] ?? fresh[0]
        if (pick) usedImages.add(pick)
        return { value, label: titleCase(value), imageUrl: pick ?? null, count }
      })
  }

  return [
    { key: "occasion", label: "Occasion", hint: "search occasions", options: Array.from(occasionByName.values()) },
    { key: "vibe", label: "Vibe", hint: "search vibes", options: tally("vibes") },
    { key: "fit", label: "Fit", hint: "search fits", options: tally("fit") },
    { key: "feel", label: "Feel", hint: "search feels", options: tally("feel") },
  ]
}

export function useSearchFacets() {
  return useQuery({
    queryKey: ["search", "facets"],
    queryFn: fetchSearchFacets,
    staleTime: 10 * 60 * 1000,
  })
}
