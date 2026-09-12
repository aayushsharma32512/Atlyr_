import type { StudioProductImage } from "@/services/studio/productImagesService"

/**
 * Our virtual try-on renders — the piece put on the photoreal mannequin during
 * ingestion.
 *
 * Matched on the storage path, not `kind`: a VTON render is stored as `model`,
 * and so is a scraped retailer photo. Across all 9,643 rows they take two
 * shapes — a `tryon/` folder (828) and a `vton` filename (6), the latter sitting
 * under `manual/` and `jobs/` where the folder name says nothing.
 *
 * Segmented cutouts are excluded separately, by `isSegmentedAsset`.
 */
const TRYON_SEGMENTS = new Set(["tryon", "jobs"])

export function isTryOnRender(url: string): boolean {
  const path = (url.split("?")[0] ?? "").toLowerCase()
  const segments = path.split("/")
  if (segments.some((segment) => TRYON_SEGMENTS.has(segment))) {
    return true
  }
  const base = (segments[segments.length - 1] ?? "").replace(/\.[^.]+$/, "")
  return base === "vton" || base.startsWith("vton_") || base.startsWith("vton-")
}

/**
 * Segmented cutouts — our own ghost/segmentation output, authored on the
 * placement canvas. They are the render asset, not a photograph of the product,
 * so a piece card does not show them either.
 *
 * Rack tiles are unaffected: they draw `products.image_url`, which for a
 * manually-ingested item IS this asset and is all there is to show.
 */
const SEGMENTED_MARKERS = ["ghost_mannequins", "/segmentation/", "/segmented"]

export function isSegmentedAsset(url: string): boolean {
  const path = (url.split("?")[0] ?? "").toLowerCase()
  return SEGMENTED_MARKERS.some((marker) => path.includes(marker))
}

/**
 * The frames a piece card shows: scraped retailer photos only, in the order the
 * service returned them. Falls back to the product's own image when nothing
 * survives, so a card is never blank.
 */
export function toDisplayImages(
  images: StudioProductImage[] | undefined,
  fallback?: string | null,
): string[] {
  const urls = (images ?? [])
    .filter((image) => image.url && !isTryOnRender(image.url) && !isSegmentedAsset(image.url))
    .map((image) => image.url)

  if (urls.length > 0) {
    return urls
  }
  return fallback ? [fallback] : []
}
