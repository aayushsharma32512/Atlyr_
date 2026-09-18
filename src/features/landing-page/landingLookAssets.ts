import type { StudioAlternativeProduct } from "@/services/studio/studioService"

// Optimised copies of the curated looks' garments, written by scripts/build-landing-looks.ts and keyed by product id.
const files = import.meta.glob("/src/assets/landing-looks/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>

const byProductId = new Map(
  Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -".webp".length), url]),
)

export function bundledGarmentUrl(productId: string): string | null {
  return byProductId.get(productId) ?? null
}

/** The bundled cut-out stands in for both thumbnail and full-res, so the renderer loads one small file. */
export function withBundledGarment(product: StudioAlternativeProduct | null): StudioAlternativeProduct | null {
  const url = product ? bundledGarmentUrl(product.id) : null
  return product && url ? { ...product, imageUrl: url, imageSrc: url } : product
}
