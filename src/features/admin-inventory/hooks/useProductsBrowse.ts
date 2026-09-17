import { useInfiniteQuery } from "@tanstack/react-query"

import { fetchProductsPage, type ProductGenderFilter, type ProductTypeFilter } from "@/services/admin-inventory/productRemovalService"
import { adminInventoryQueryKeys } from "../queryKeys"

const PAGE_SIZE = 24

export interface UseProductsBrowseParams {
    q: string
    /** "all" clears the filter. */
    gender: ProductGenderFilter | "all"
    /** "all" clears the filter. */
    type: ProductTypeFilter | "all"
}

/** Paginated products browse, filtered by free-text search, gender and type. Newest first. */
export function useProductsBrowse({ q, gender, type }: UseProductsBrowseParams) {
    return useInfiniteQuery({
        queryKey: adminInventoryQueryKeys.productsBrowse({ q, gender, type }),
        queryFn: ({ pageParam }) =>
            fetchProductsPage({
                q,
                gender: gender === "all" ? null : gender,
                type: type === "all" ? null : type,
                cursor: pageParam,
                pageSize: PAGE_SIZE,
            }),
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        staleTime: 10 * 60_000,
    })
}
