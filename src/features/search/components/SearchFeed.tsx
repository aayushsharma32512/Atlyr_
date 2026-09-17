import { useEffect, useRef } from "react"

import { SectionHeader } from "@/design-system/primitives"
import type { FeedSections } from "@/features/search/hooks/useSearchFeed"
import type { SearchBrowseCollection } from "@/services/search/searchService"
import { SearchRail, type FeedHandlers, type FeedList } from "@/features/search/components/SearchRail"
import { FeedGrid, FeedGridSkeleton } from "@/features/search/components/FeedGrid"
import { CurationBoards } from "@/features/search/components/CurationBoards"
import { PersonaliseBanner } from "@/features/search/components/PersonaliseBanner"

interface SearchFeedProps {
  sections: FeedSections
  heightCm: number
  onOpenList: (list: FeedList) => void
  /** A curation board from the rail opens its own looks. */
  onOpenBoard: (board: SearchBrowseCollection) => void
  /** The banner between the curations and For You → Import inspiration. */
  onPersonalise: () => void
  handlers: FeedHandlers
}

/** Hot Styles · Curations · For You, for the active scope. */
export function SearchFeed({ sections, heightCm, onOpenList, onOpenBoard, onPersonalise, handlers }: SearchFeedProps) {
  const { forYou } = sections
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = forYou

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const rails =
    sections.kind === "looks" ? (
      <>
        <SearchRail kind="looks" title="Hot styles" section={sections.hot} heightCm={heightCm} onOpenList={() => onOpenList("hot")} handlers={handlers} />
        {/* Curations are boards here, not loose looks. Tapping a board opens
            its looks; the per-curation deep-dive page is parked. */}
        <CurationBoards
          title="Curations"
          boards={sections.boards}
          isLoading={sections.boardsLoading}
          gender={sections.gender}
          heightCm={heightCm}
          onOpenList={() => onOpenList("curations")}
          onOpenBoard={onOpenBoard}
        />
      </>
    ) : (
      <>
        <SearchRail kind="pieces" title="Hot styles" section={sections.hot} heightCm={heightCm} onOpenList={() => onOpenList("hot")} handlers={handlers} />
        <SearchRail kind="pieces" title="Curations" section={sections.curations} heightCm={heightCm} onOpenList={() => onOpenList("curations")} handlers={handlers} />
      </>
    )

  return (
    <div className="flex flex-col gap-5">
      {rails}
      <PersonaliseBanner onClick={onPersonalise} />
      <section className="flex flex-col gap-2.5">
        {/* The banner above already draws the rule; a border here doubled it. */}
        <SectionHeader title="For You" className="pt-2" />
        {sections.kind === "looks" ? (
          <FeedGrid kind="looks" section={sections.forYou} heightCm={heightCm} handlers={handlers} skeletonCount={4} />
        ) : (
          <FeedGrid kind="pieces" section={sections.forYou} heightCm={heightCm} handlers={handlers} skeletonCount={4} />
        )}
        <div ref={sentinelRef} className="h-2" />
        {isFetchingNextPage ? <FeedGridSkeleton kind={sections.kind} count={2} /> : null}
      </section>
    </div>
  )
}
