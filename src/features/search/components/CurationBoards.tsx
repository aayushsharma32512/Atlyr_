import { Icons } from "@/design-system/icons"
import { OutfitCard, SectionHeader } from "@/design-system/primitives"
import { FEED_GRID } from "@/features/search/components/FeedGrid"
import { cn } from "@/lib/utils"
import type { SearchBrowseCollection } from "@/services/search/searchService"

// The rail matches the hot styles rail (96w × 136h figure); the page matches its 250h look card.
const RAIL_CARD = "w-[96px] shrink-0"
const RAIL_FRAME = "h-[136px]"
const PAGE_CARD = "h-[250px]"

type Gender = "male" | "female"

interface CurationBoardCardProps {
  board: SearchBrowseCollection
  gender: Gender
  heightCm: number
  onSelect: () => void
}

const coverOf = (board: SearchBrowseCollection, gender: Gender) => {
  const cover = board.outfits[0]
  return {
    outfitId: cover?.outfit.id,
    renderedItems: cover?.studioOutfit?.renderedItems,
    layerOrder: cover?.studioOutfit?.layerOrder ?? null,
    gender: cover?.outfit.gender === "male" ? "male" : cover?.outfit.gender === "female" ? "female" : gender,
  } as const
}

/** A curation on the rail: its first look in the hot styles tile, the curation's name below. */
function CurationRailCard({ board, gender, heightCm, onSelect }: CurationBoardCardProps) {
  const cover = coverOf(board, gender)
  return (
    <button type="button" role="listitem" onClick={onSelect} className={cn("flex flex-col gap-1.5 text-left", RAIL_CARD)}>
      <div className={cn("w-full", RAIL_FRAME)}>
        <OutfitCard title={board.title} footer={false} outfitId={cover.outfitId} renderedItems={cover.renderedItems} slotOrder={cover.layerOrder} gender={cover.gender} heightCm={heightCm} />
      </div>
      <span className="w-full truncate px-0.5 text-card font-medium text-ink">{board.title}</span>
    </button>
  )
}

/** A curation on the page: the grid's look card, named after the curation instead of the look. */
function CurationPageCard({ board, gender, heightCm, onSelect }: CurationBoardCardProps) {
  const cover = coverOf(board, gender)
  return (
    <div role="listitem" className={PAGE_CARD}>
      <OutfitCard title={board.title} outfitId={cover.outfitId} renderedItems={cover.renderedItems} slotOrder={cover.layerOrder} gender={cover.gender} heightCm={heightCm} onSelect={onSelect} />
    </div>
  )
}

interface CurationBoardsProps {
  title: string
  boards: SearchBrowseCollection[]
  isLoading: boolean
  gender: Gender
  heightCm: number
  onOpenList: () => void
  onOpenBoard: (board: SearchBrowseCollection) => void
}

/** The Search rail: hot styles tiles, one look per curation. */
export function CurationBoards({ title, boards, isLoading, gender, heightCm, onOpenList, onOpenBoard }: CurationBoardsProps) {
  const isEmpty = !isLoading && boards.length === 0

  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader
        title={title}
        className="border-t border-hairline pt-2"
        actionSlot={
          <button type="button" aria-label={`Open ${title}`} onClick={onOpenList} className="-mr-2 flex h-8 w-8 items-center justify-center text-ink">
            <Icons.openList className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      />
      {isEmpty ? (
        <p className="self-center text-xs text-taupe">Nothing here yet.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto py-0.5 scrollbar-hide" role="list" aria-label={title}>
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <span key={i} role="listitem" className={cn("skeleton-shimmer rounded-lg", RAIL_CARD, RAIL_FRAME)} />
              ))
            : boards.map((board) => (
                <CurationRailCard key={board.categoryId} board={board} gender={gender} heightCm={heightCm} onSelect={() => onOpenBoard(board)} />
              ))}
        </div>
      )}
    </section>
  )
}

interface CurationBoardsPageProps {
  boards: SearchBrowseCollection[]
  isLoading: boolean
  gender: Gender
  heightCm: number
  onBack: () => void
  onOpenBoard: (board: SearchBrowseCollection) => void
}

/**
 * The rail, opened: 52h header row, then every curation as one look card in
 * the feed grid — the same grid the opened hot styles list draws. The design's
 * this-week hero above the grid is deliberately not built.
 */
export function CurationBoardsPage({ boards, isLoading, gender, heightCm, onBack, onOpenBoard }: CurationBoardsPageProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <header className="-mx-4 flex h-control-header-title items-center gap-1 border-b border-hairline px-2">
        <button type="button" aria-label="Back" onClick={onBack} className="flex h-10 w-10 items-center justify-center text-ink">
          <Icons.carouselPrev className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="min-w-0 flex-1 truncate font-display text-title font-medium text-ink">Curations</h1>
        <span className="pr-2 text-chip text-taupe">this week</span>
      </header>
      <SectionHeader
        title="Curations"
        className="pt-2"
        actionSlot={<span className="text-chip tabular-nums text-taupe">{isLoading ? "" : boards.length}</span>}
      />
      <div className={FEED_GRID} role="list" aria-label="Curations">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <span key={i} role="listitem" className={cn("skeleton-shimmer w-full rounded-lg", PAGE_CARD)} />
            ))
          : boards.map((board) => (
              <CurationPageCard key={board.categoryId} board={board} gender={gender} heightCm={heightCm} onSelect={() => onOpenBoard(board)} />
            ))}
      </div>
    </div>
  )
}
