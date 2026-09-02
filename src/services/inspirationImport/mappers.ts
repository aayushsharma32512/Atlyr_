import type { MannequinSegmentName, StudioRenderedItem } from "@/features/studio/types"
import { toPlacementTransform } from "@/features/studio/mappers/renderedItemMapper"
import type { InspirationCatalogueResult, InspirationCategory } from "./types"

export function mapImportResultToStudioItem(
  result: InspirationCatalogueResult,
  category: InspirationCategory,
): StudioRenderedItem | null {
  if (!result.renderImageSrc) return null
  return {
    id: result.id,
    zone: category,
    imageUrl: result.renderImageSrc,
    thumbnailUrl: result.thumbnailSrc,
    placementX: result.placementX ?? 0,
    placementY: result.placementY ?? 0,
    imageLengthCm: result.imageLength ?? 0,
    placement: toPlacementTransform({ placement: result.placement, gender: result.gender }),
    brand: result.brand,
    productName: result.title,
    price: result.price,
    currency: result.currency,
    size: result.size,
    color: result.color,
    gender: result.gender === "male" || result.gender === "female" || result.gender === "unisex"
      ? result.gender
      : null,
    productUrl: result.productUrl,
    bodyPartsVisible: result.bodyPartsVisible as MannequinSegmentName[] | null,
  }
}
