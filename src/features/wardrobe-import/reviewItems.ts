import type { WardrobePhoto, WardrobePieceSelection } from "./types"

export type WardrobeReviewItem = {
  /** What makes a pick unique across the batch: the product, or the listing. */
  key: string
  importId: string | null
  selection: WardrobePieceSelection
}

export type WardrobeReviewItems = {
  inventory: WardrobeReviewItem[]
  web: WardrobeReviewItem[]
  total: number
}

/**
 * Every pick in the batch, once. The same product or the same listing chosen on
 * two photos is one item: the wardrobe holds a garment, not a photo of it.
 */
export function reviewItems(photos: WardrobePhoto[]): WardrobeReviewItems {
  const inventory: WardrobeReviewItem[] = []
  const web: WardrobeReviewItem[] = []
  const seen = new Set<string>()

  for (const photo of photos) {
    for (const selection of Object.values(photo.selections)) {
      if (!selection) continue
      const key = selection.source === "inventory"
        ? `inventory:${selection.productId ?? selection.candidateId}`
        : `web:${selection.listingUrl ?? selection.candidateId}`
      if (seen.has(key)) continue
      seen.add(key)
      const item: WardrobeReviewItem = { key, importId: photo.importId, selection }
      if (selection.source === "inventory") inventory.push(item)
      else web.push(item)
    }
  }

  return { inventory, web, total: inventory.length + web.length }
}
