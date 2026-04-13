import { useQuery } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { productImagesService, type StudioProductImage } from "@/services/studio/productImagesService"

/**
 * TanStack Query hook for fetching all product images from the product_images table.
 * Follows the architecture: service → hook → component.
 */
export function useStudioProductImages(productId: string | null | undefined) {
    return useQuery({
        queryKey: studioKeys.productImages(productId ?? null),
        enabled: Boolean(productId),
        queryFn: (): Promise<StudioProductImage[]> => {
            if (!productId) {
                return Promise.resolve([])
            }
            return productImagesService.getProductImages(productId)
        },
        staleTime: 60 * 1000, // 1 minute
    })
}
