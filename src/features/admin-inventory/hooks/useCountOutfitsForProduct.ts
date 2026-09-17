import { useQuery } from "@tanstack/react-query"

import { countOutfitsForProduct } from "@/services/admin-inventory/productRemovalService"
import { adminInventoryQueryKeys } from "../queryKeys"

/** Outfit count for the delete-confirmation sheet. Disabled until a product is open. */
export function useCountOutfitsForProduct(productId: string | null) {
    return useQuery({
        queryKey: adminInventoryQueryKeys.outfitCount(productId ?? "none"),
        queryFn: () => countOutfitsForProduct(productId as string),
        enabled: Boolean(productId),
        staleTime: 30_000,
    })
}
