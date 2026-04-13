import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { collectionsKeys } from "@/features/collections/queryKeys"
import { fetchMoodboardItems } from "@/services/collections/collectionsService"

type PrefetchMoodboardItemsOptions = {
  userId: string | null | undefined
  slugs: string[]
  pageSize: number
  maxSlugs?: number
}

export function usePrefetchMoodboardItems({
  userId,
  slugs,
  pageSize,
  maxSlugs = 5,
}: PrefetchMoodboardItemsOptions) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!userId || slugs.length === 0) {
      return
    }

    const slugsToPrefetch = slugs.slice(0, maxSlugs)
    slugsToPrefetch.forEach((slug) => {
      queryClient.prefetchInfiniteQuery({
        queryKey: collectionsKeys.moodboardItems(slug, pageSize),
        queryFn: ({ pageParam = 0 }) =>
          fetchMoodboardItems({ userId, slug, page: pageParam, size: pageSize }),
        initialPageParam: 0,
        getNextPageParam: (lastPage, allPages) => (lastPage.length === pageSize ? allPages.length : undefined),
      })
    })
  }, [maxSlugs, pageSize, queryClient, slugs, userId])
}
