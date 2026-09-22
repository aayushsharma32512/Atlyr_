import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { mapTrayItemToStudioRenderedItem } from "@/features/studio/mappers/renderedItemMapper"
import { hidesBottomPlaceholder } from "@/features/studio/utils/layerOrder"
import { studioService, type StudioProductTrayItem } from "@/services/studio/studioService"

/**
 * Off only when explicitly disabled (VITE_STUDIO_BASE_ITEMS_ENABLED=false in .env/.env.local).
 * Unset means on, so an environment that never heard of this flag keeps today's behavior.
 */
export const STUDIO_BASE_ITEMS_ENABLED = import.meta.env.VITE_STUDIO_BASE_ITEMS_ENABLED !== "false"

/**
 * Product drawn on the canvas in place of a removed top/bottom. Missing entry = bare mannequin.
 * Male has no top entry by design: an uncovered male torso needs no stand-in.
 */
const PLACEHOLDER_PRODUCT_IDS: Record<"male" | "female", { top?: string; bottom?: string }> = STUDIO_BASE_ITEMS_ENABLED
  ? {
      female: {
        top: "7b58b1c8a88776b68c011751b2280aabddd0aa82",
        bottom: "4b24df4881f53fc54036fe4001de6fb0f0f16e08",
      },
      male: { bottom: "1e64b68071ae71cd8cde866f693839d8c1b85330" },
    }
  : { female: {}, male: {} }

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

/** A visible top that covers the hips (a dress, a bodysuit) needs no stand-in bottom. The kinds live in config/layerRules.ts. */
export function isDressTop(trayItems: StudioProductTrayItem[], topHidden: boolean) {
  const top = trayItems.find((item) => item.slot === "top")
  return !topHidden && hidesBottomPlaceholder({ typeCategory: top?.typeCategory, productName: top?.title })
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
