import { useQuery } from "@tanstack/react-query"

import { fetchOutfitCategories } from "@/services/admin-inventory/outfitReviewService"
import { adminInventoryQueryKeys } from "../queryKeys"

/** Categories for the review queue's filter chip row. */
export function useOutfitCategories() {
    return useQuery({
        queryKey: adminInventoryQueryKeys.categories(),
        queryFn: () => fetchOutfitCategories(),
        staleTime: 5 * 60_000,
    })
}
