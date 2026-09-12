import { useMemo } from "react"

import { useTrendingProducts } from "@/features/collections/hooks/useMoodboards"
import { useHomeAllOutfits } from "@/features/home/hooks/useHomeAllOutfits"
import { useHomeCuratedOutfits } from "@/features/home/hooks/useHomeCuratedOutfits"
import { useProfileContext } from "@/features/profile/providers/ProfileProvider"
import { useSearchBrowseCollections } from "@/features/search/hooks/useSearchBrowseCollections"
import { useSearchBrowseProducts } from "@/features/search/hooks/useSearchBrowseProducts"
import {
  flattenBrowseLooks,
  looksFromHomeEntries,
  piecesFromBrowseLooks,
  piecesFromSearchResults,
  piecesFromTrending,
  readFeedSeed,
  type FeedLook,
  type FeedPiece,
} from "@/features/search/utils/feedShaping"
import { scopeToSlot, type SearchScope } from "@/features/search/utils/scope"
import type { StudioProductTraySlot } from "@/services/studio/studioService"

export interface FeedSection<T> {
  items: T[]
  isLoading: boolean
  isError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
}

export type FeedSections =
  | { kind: "looks"; hot: FeedSection<FeedLook>; curations: FeedSection<FeedLook>; forYou: FeedSection<FeedLook> }
  | { kind: "pieces"; slot: StudioProductTraySlot; hot: FeedSection<FeedPiece>; curations: FeedSection<FeedPiece>; forYou: FeedSection<FeedPiece> }

const HOT_PAGE = 24
const FOR_YOU_PAGE = 24
const noop = () => {}

const finite = <T,>(items: T[], isLoading: boolean, isError: boolean): FeedSection<T> => ({
  items, isLoading, isError, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: noop,
})

/** The three feed sections for one scope. Only that scope's queries run. */
export function useSearchFeed(scope: SearchScope, enabled: boolean): FeedSections {
  const { gender } = useProfileContext()
  const fallbackGender: "male" | "female" = gender === "male" ? "male" : "female"
  const slot = scopeToSlot(scope)
  const looksOn = enabled && slot === null
  const piecesOn = enabled && slot !== null
  const seed = useMemo(() => readFeedSeed(window.sessionStorage), [])

  // Looks
  const hotLooks = useHomeAllOutfits("relevance", HOT_PAGE, looksOn)
  const browse = useSearchBrowseCollections({ enabled })
  const forYouLooks = useHomeCuratedOutfits(looksOn ? seed : "", FOR_YOU_PAGE)

  // Pieces
  const trending = useTrendingProducts(piecesOn)
  const forYouPieces = useSearchBrowseProducts({ slot, enabled: piecesOn })

  return useMemo<FeedSections>(() => {
    if (slot === null) {
      return {
        kind: "looks",
        hot: {
          items: looksFromHomeEntries(hotLooks.data?.pages, fallbackGender),
          isLoading: hotLooks.isLoading,
          isError: hotLooks.isError,
          hasNextPage: Boolean(hotLooks.hasNextPage),
          isFetchingNextPage: hotLooks.isFetchingNextPage,
          fetchNextPage: () => void hotLooks.fetchNextPage(),
        },
        curations: finite(flattenBrowseLooks(browse.data, fallbackGender), browse.isLoading, browse.isError),
        forYou: {
          items: looksFromHomeEntries(forYouLooks.data?.pages, fallbackGender),
          isLoading: forYouLooks.isLoading,
          isError: forYouLooks.isError,
          hasNextPage: Boolean(forYouLooks.hasNextPage),
          isFetchingNextPage: forYouLooks.isFetchingNextPage,
          fetchNextPage: () => void forYouLooks.fetchNextPage(),
        },
      }
    }
    return {
      kind: "pieces",
      slot,
      hot: finite(piecesFromTrending(trending.data?.[slot], slot), trending.isLoading, trending.isError),
      curations: finite(piecesFromBrowseLooks(browse.data, slot), browse.isLoading, browse.isError),
      forYou: {
        items: piecesFromSearchResults(forYouPieces.data?.pages, slot),
        isLoading: forYouPieces.isLoading,
        isError: forYouPieces.isError,
        hasNextPage: Boolean(forYouPieces.hasNextPage),
        isFetchingNextPage: forYouPieces.isFetchingNextPage,
        fetchNextPage: () => void forYouPieces.fetchNextPage(),
      },
    }
  }, [browse, fallbackGender, forYouLooks, forYouPieces, hotLooks, slot, trending])
}
