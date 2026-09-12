import { useEffect, useRef } from "react"

import { SectionHeader } from "@/design-system/primitives"
import type { FeedSections } from "@/features/search/hooks/useSearchFeed"
import { SearchRail, type FeedHandlers, type FeedList } from "@/features/search/components/SearchRail"
import { FeedGrid, FeedGridSkeleton } from "@/features/search/components/FeedGrid"

interface SearchFeedProps {
  sections: FeedSections
  heightCm: number
  onOpenList: (list: FeedList) => void
  handlers: FeedHandlers
}

/** Hot Styles · Atlyr Curations · For You, for the active scope. */
export function SearchFeed({ sections, heightCm, onOpenList, handlers }: SearchFeedProps) {
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
        <SearchRail kind="looks" title="Hot Styles" section={sections.hot} heightCm={heightCm} onOpenList={() => onOpenList("hot")} handlers={handlers} />
        <SearchRail kind="looks" title="Atlyr Curations" section={sections.curations} heightCm={heightCm} onOpenList={() => onOpenList("curations")} handlers={handlers} />
      </>
    ) : (
      <>
        <SearchRail kind="pieces" title="Hot Styles" section={sections.hot} heightCm={heightCm} onOpenList={() => onOpenList("hot")} handlers={handlers} />
        <SearchRail kind="pieces" title="Atlyr Curations" section={sections.curations} heightCm={heightCm} onOpenList={() => onOpenList("curations")} handlers={handlers} />
      </>
    )

  return (
    <div className="flex flex-col gap-5">
      {rails}
      <section className="flex flex-col gap-2.5">
        <SectionHeader title="For You" className="border-t border-hairline pt-2" />
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
