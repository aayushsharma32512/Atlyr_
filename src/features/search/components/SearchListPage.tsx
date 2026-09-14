import { useEffect, useRef } from "react"

import { Icons } from "@/design-system/icons"
import type { FeedSection } from "@/features/search/hooks/useSearchFeed"
import type { FeedHandlers } from "@/features/search/components/SearchRail"
import type { FeedLook, FeedPiece } from "@/features/search/utils/feedShaping"
import { FeedGrid } from "@/features/search/components/FeedGrid"

type SearchListPageProps =
  | { kind: "looks"; section: FeedSection<FeedLook>; title: string; heightCm: number; onBack: () => void; handlers: FeedHandlers }
  | { kind: "pieces"; section: FeedSection<FeedPiece>; title: string; heightCm: number; onBack: () => void; handlers: FeedHandlers }

/** A rail, opened: 52h header row then the whole list in two columns. */
export function SearchListPage(props: SearchListPageProps) {
  const { title, section, heightCm, onBack, handlers } = props
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = section

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  return (
    <div className="flex flex-col gap-2.5">
      {/* The 52px header row, as every screen names itself: bare back chevron, then the title. */}
      <header className="-mx-4 flex h-control-header-title items-center gap-1 border-b border-hairline px-2">
        <button type="button" aria-label="Back" onClick={onBack} className="flex h-10 w-10 items-center justify-center text-ink">
          <Icons.carouselPrev className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="min-w-0 flex-1 truncate font-display text-title font-medium text-ink">{title}</h1>
      </header>
      {props.kind === "looks" ? (
        <FeedGrid kind="looks" section={props.section} heightCm={heightCm} handlers={handlers} skeletonCount={6} />
      ) : (
        <FeedGrid kind="pieces" section={props.section} heightCm={heightCm} handlers={handlers} skeletonCount={6} />
      )}
      <div ref={sentinelRef} className="h-2" />
    </div>
  )
}
