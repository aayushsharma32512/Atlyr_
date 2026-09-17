import { useInfiniteQuery } from "@tanstack/react-query"

import { fetchOutfitsPage } from "@/services/admin-inventory/outfitReviewService"
import { adminInventoryQueryKeys } from "../queryKeys"

const PAGE_SIZE = 20

export interface UseOutfitsBrowseParams {
    /** true = Active segment (visible_in_feed), false = Hidden segment. */
    visible: boolean
    q: string
    categoryId: string | null
}

/** Paginated Active/Hidden outfits grid, filtered by name search and category. Newest first. */
export function useOutfitsBrowse({ visible, q, categoryId }: UseOutfitsBrowseParams) {
    return useInfiniteQuery({
        queryKey: adminInventoryQueryKeys.outfitsBrowse({ visible, q, categoryId }),
        queryFn: ({ pageParam }) =>
            fetchOutfitsPage({ visible, q, categoryId, cursor: pageParam, pageSize: PAGE_SIZE }),
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        staleTime: 5 * 60_000,
    })
}
