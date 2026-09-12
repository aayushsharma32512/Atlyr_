import type { TrendingProduct } from "@/services/collections/collectionsService"
import type { HomeOutfitEntry } from "@/services/home/homeService"
import type { ProductSearchResult, SearchBrowseCollection } from "@/services/search/searchService"
import type { StudioProductTraySlot } from "@/services/studio/studioService"
import type { StudioRenderedItem } from "@/features/studio/types"
import type { Outfit } from "@/types"

type Gender = "male" | "female"

export interface FeedLook {
  id: string
  title: string
  outfit: Outfit
  renderedItems?: StudioRenderedItem[]
  gender: Gender
}

export interface FeedPiece {
  id: string
  title: string
  imageSrc: string | null
  slot: StudioProductTraySlot
}

export const FEED_SEED_KEY = "atlyr:search:feedSeed"

const resolveGender = (value: string | null | undefined, fallback: Gender): Gender =>
  value === "male" || value === "female" ? value : fallback

/** Curated collections as one rail: collection order kept, each outfit once. */
export function flattenBrowseLooks(collections: SearchBrowseCollection[] | undefined, fallback: Gender): FeedLook[] {
  const seen = new Set<string>()
  const looks: FeedLook[] = []
  for (const collection of collections ?? []) {
    for (const entry of collection.outfits) {
      if (seen.has(entry.outfit.id)) continue
      seen.add(entry.outfit.id)
      looks.push({
        id: entry.id,
        title: entry.title,
        outfit: entry.outfit,
        renderedItems: entry.studioOutfit?.renderedItems,
        gender: resolveGender(entry.outfit.gender, fallback),
      })
    }
  }
  return looks
}

/** The pieces worn in curated looks, for one slot. */
export function piecesFromBrowseLooks(collections: SearchBrowseCollection[] | undefined, slot: StudioProductTraySlot): FeedPiece[] {
  const seen = new Set<string>()
  const pieces: FeedPiece[] = []
  for (const collection of collections ?? []) {
    for (const entry of collection.outfits) {
      const item = entry.studioOutfit?.renderedItems?.find((rendered) => rendered.zone === slot)
      if (!item || seen.has(item.id)) continue
      seen.add(item.id)
      pieces.push({ id: item.id, title: item.productName ?? "", imageSrc: item.thumbnailUrl ?? item.imageUrl ?? null, slot })
    }
  }
  return pieces
}

export function looksFromHomeEntries(pages: HomeOutfitEntry[][] | undefined, fallback: Gender): FeedLook[] {
  return (pages ?? []).flat().map((entry) => ({
    id: entry.id,
    title: entry.title,
    outfit: entry.outfit,
    renderedItems: entry.renderedItems,
    gender: resolveGender(entry.outfit.gender, fallback),
  }))
}

export function piecesFromTrending(rows: TrendingProduct[] | undefined, slot: StudioProductTraySlot): FeedPiece[] {
  return (rows ?? []).map((row) => ({ id: row.id, title: row.productName ?? "", imageSrc: row.imageUrl, slot }))
}

export function piecesFromSearchResults(
  pages: { results: ProductSearchResult[] }[] | undefined,
  slot: StudioProductTraySlot,
): FeedPiece[] {
  return (pages ?? []).flatMap((page) => page.results).map((row) => ({ id: row.id, title: row.title, imageSrc: row.thumbnailSrc ?? row.imageSrc, slot }))
}

const mintSeed = () => Math.random().toString(36).slice(2, 10)

/** One seed per session so For You is stable across back-navigation. */
export function readFeedSeed(storage: Pick<Storage, "getItem" | "setItem">, mint: () => string = mintSeed): string {
  try {
    const existing = storage.getItem(FEED_SEED_KEY)
    if (existing) return existing
    const seed = mint()
    storage.setItem(FEED_SEED_KEY, seed)
    return seed
  } catch {
    return mint()
  }
}
