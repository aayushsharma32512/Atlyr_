import { Icons } from "@/design-system/icons"
import { OutfitInspirationTile, SectionHeader } from "@/design-system/primitives"
import { CANONICAL_HERO_RENDER_BOX } from "@/features/studio/constants/renderBox"
import { cn } from "@/lib/utils"
import type { SearchBrowseCollection } from "@/services/search/searchService"

/** Studio's frame, fitted by height, keeps each figure head to toe in its cell. */
const FIGURE_FRAME_ASPECT = `${CANONICAL_HERO_RENDER_BOX.width} / ${CANONICAL_HERO_RENDER_BOX.height}`
/** Two frames side by side, so the portrait cover fits both figures exactly. */
const COVER_STYLE = { aspectRatio: `${CANONICAL_HERO_RENDER_BOX.width * 2} / ${CANONICAL_HERO_RENDER_BOX.height}` }
const CARD = "w-[112px] shrink-0"

type Gender = "male" | "female"

interface CurationBoardCardProps {
  board: SearchBrowseCollection
  gender: Gender
  heightCm: number
  onSelect: () => void
  className?: string
}

/**
 * A curation as a board: its first two looks side by side, then its name and
 * count — the same card the Boards tab draws for a moodboard, so a curation
 * reads as a board you could save to. An empty cell is the ground: no grey.
 */
function CurationBoardCard({ board, gender, heightCm, onSelect, className }: CurationBoardCardProps) {
  const looks = board.outfits.slice(0, 2)
  const fillers = Array.from({ length: Math.max(0, 2 - looks.length) })
  return (
    <button type="button" role="listitem" onClick={onSelect} className={cn("flex flex-col gap-1.5 text-left", className)}>
      <div className="relative w-full overflow-hidden rounded-lg border border-hairline bg-background" style={COVER_STYLE}>
        <div className="absolute inset-0 grid grid-cols-2 bg-background">
          {looks.map((entry) => (
            <div key={entry.id} className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-background">
              <div className="h-full" style={{ aspectRatio: FIGURE_FRAME_ASPECT }}>
                <OutfitInspirationTile
                  preset="moodboardPreview"
                  outfitId={entry.outfit.id}
                  avatarGender={entry.outfit.gender === "male" ? "male" : entry.outfit.gender === "female" ? "female" : gender}
                  avatarHeightCm={heightCm}
                  wrapperClassName="h-full w-full rounded-none bg-transparent p-0"
                />
              </div>
            </div>
          ))}
          {fillers.map((_, i) => (
            <div key={`fill-${i}`} className="bg-background" />
          ))}
        </div>
      </div>
      <div className="flex w-full items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-card font-medium text-ink">{board.title}</span>
        <span className="shrink-0 text-chip text-taupe">{board.outfits.length}</span>
      </div>
    </button>
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

/** The Search rail: 112px portrait cards, two tall looks per cover. */
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
                <span key={i} role="listitem" className={`skeleton-shimmer rounded-lg ${CARD}`} style={COVER_STYLE} />
              ))
            : boards.map((board) => (
                <CurationBoardCard
                  key={board.categoryId}
                  board={board}
                  gender={gender}
                  heightCm={heightCm}
                  onSelect={() => onOpenBoard(board)}
                  className={CARD}
                />
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
 * The rail, opened: 52h header row, then every curation as a board in two
 * columns — the Boards tab's grid, not a flat list of looks. The design's
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" role="list" aria-label="Curations">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <span key={i} role="listitem" className="skeleton-shimmer w-full rounded-lg" style={COVER_STYLE} />
            ))
          : boards.map((board) => (
              <CurationBoardCard
                key={board.categoryId}
                board={board}
                gender={gender}
                heightCm={heightCm}
                onSelect={() => onOpenBoard(board)}
                className="w-full"
              />
            ))}
      </div>
    </div>
  )
}
