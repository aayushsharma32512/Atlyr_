import { useInfiniteQuery } from "@tanstack/react-query"

import { fetchReviewQueue } from "@/services/admin-inventory/outfitReviewService"
import { adminInventoryQueryKeys } from "../queryKeys"

const PAGE_SIZE = 20

/** Outfits still awaiting a keep/hide decision, optionally narrowed to one category. */
export function useReviewQueue(categoryId: string | null) {
    return useInfiniteQuery({
        queryKey: adminInventoryQueryKeys.reviewQueue(categoryId),
        queryFn: ({ pageParam }) => fetchReviewQueue(categoryId, { cursor: pageParam, pageSize: PAGE_SIZE }),
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        staleTime: 10 * 60_000,
    })
}
