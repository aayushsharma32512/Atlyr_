import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/contexts/AuthContext"
import { collectionsKeys } from "@/features/collections/queryKeys"
import { fetchCollectionsWithPreviews, fetchCreations } from "@/services/collections/collectionsService"

const CREATIONS_PREFETCH_SIZE = 6

export function CollectionsPrefetcher() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const lastPrefetchedUserId = useRef<string | null>(null)

  useEffect(() => {
    const userId = user?.id ?? null
    if (!userId) {
      lastPrefetchedUserId.current = null
      return
    }
    if (lastPrefetchedUserId.current === userId) {
      return
    }
    lastPrefetchedUserId.current = userId

    queryClient.prefetchQuery({
      queryKey: collectionsKeys.overview(),
      queryFn: () => fetchCollectionsWithPreviews(userId),
      staleTime: 30 * 60 * 1000,
    })

    queryClient.prefetchInfiniteQuery({
      queryKey: collectionsKeys.creations(CREATIONS_PREFETCH_SIZE),
      queryFn: ({ pageParam = 0 }) => fetchCreations({ userId, page: pageParam, size: CREATIONS_PREFETCH_SIZE }),
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length === CREATIONS_PREFETCH_SIZE ? allPages.length : undefined,
      staleTime: 5 * 60 * 1000,
    })
  }, [queryClient, user?.id])

  return null
}

