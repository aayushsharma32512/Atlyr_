import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { mapTrayItemToStudioRenderedItem } from "@/features/studio/mappers/renderedItemMapper"
import { studioService } from "@/services/studio/studioService"

/** Product drawn on the canvas in place of a removed top/bottom. Missing entry = bare mannequin. */
const PLACEHOLDER_PRODUCT_IDS: Record<"male" | "female", { top?: string; bottom?: string }> = {
  // TODO: Aayush — swap in the grey placeholder product IDs (female top/bottom, male top/bottom)
  female: { bottom: "bb1064983005bebc85a2258ca8a264890b07a87d" },
  male: {},
}

function usePlaceholderProduct(productId: string | undefined) {
  // Own cache key: studioKeys.product holds StudioProductDetail, a different shape.
  return useQuery({
    queryKey: [...studioKeys.all, "placeholder-product", productId ?? "none"],
    queryFn: () => studioService.getProductById(productId as string),
    enabled: Boolean(productId),
    // Same for every user: fetch once per page load, never evict.
    staleTime: Infinity,
    gcTime: Infinity,
    select: (product) => {
      const item = mapTrayItemToStudioRenderedItem(product)
      // Thumbnail only: a stand-in isn't worth the full-res texture load.
      return item && { ...item, imageUrl: item.thumbnailUrl ?? item.imageUrl, thumbnailUrl: null }
    },
  }).data ?? null
}

/**
 * Canvas-only stand-ins for a hidden top/bottom, so the mannequin isn't bare.
 * Never put these in the tray, outfitItems, history or search.
 */
export function usePlaceholderItems(gender: "male" | "female") {
  return {
    top: usePlaceholderProduct(PLACEHOLDER_PRODUCT_IDS[gender]?.top),
    bottom: usePlaceholderProduct(PLACEHOLDER_PRODUCT_IDS[gender]?.bottom),
  }
}
