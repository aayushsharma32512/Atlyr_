import { Icons } from "@/design-system/icons"
import { OutfitInspirationTile, SectionHeader } from "@/design-system/primitives"
import { CANONICAL_HERO_RENDER_BOX } from "@/features/studio/constants/renderBox"
import type { SearchBrowseCollection } from "@/services/search/searchService"

/** Studio's frame, fitted by height, keeps each figure head to toe in its cell. */
const FIGURE_FRAME_ASPECT = `${CANONICAL_HERO_RENDER_BOX.width} / ${CANONICAL_HERO_RENDER_BOX.height}`
const CARD = "w-[112px] shrink-0"
const COVER_CELLS = 4
// Empty cells are the ground: no grey blocks, no gridlines.
const FILLER_TONE = ["bg-background", "bg-background", "bg-background", "bg-background"]

interface CurationBoardsProps {
  title: string
  boards: SearchBrowseCollection[]
  isLoading: boolean
  gender: "male" | "female"
  heightCm: number
  onOpenList: () => void
  onOpenBoard: (board: SearchBrowseCollection) => void
}

/**
 * Atlyr curations as boards: a 2x2 collage of the collection's first four
 * looks, then its name and count — the same card the Boards tab draws for a
 * moodboard, so a curation reads as a board you could save to.
 */
export function CurationBoards({ title, boards, isLoading, gender, heightCm, onOpenList, onOpenBoard }: CurationBoardsProps) {
  const isEmpty = !isLoading && boards.length === 0

  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader
        title={title}
        className="border-t border-hairline pt-2"
        actionSlot={
          <button type="button" aria-label={`Open ${title}`} onClick={onOpenList} className="flex h-8 w-8 items-center justify-center text-ink">
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
                <span key={i} role="listitem" className={`skeleton-shimmer aspect-square rounded-lg ${CARD}`} />
              ))
            : boards.map((board) => {
                const looks = board.outfits.slice(0, COVER_CELLS)
                const fillers = Array.from({ length: Math.max(0, COVER_CELLS - looks.length) })
                return (
                  <button
                    key={board.categoryId}
                    type="button"
                    role="listitem"
                    onClick={() => onOpenBoard(board)}
                    className={`flex flex-col gap-1.5 text-left ${CARD}`}
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-hairline bg-background">
                      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 bg-background">
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
                          <div key={`fill-${i}`} className={FILLER_TONE[i % FILLER_TONE.length]} />
                        ))}
                      </div>
                    </div>
                    <div className="flex w-full items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-card font-medium text-ink">{board.title}</span>
                      <span className="shrink-0 text-chip text-taupe">{board.outfits.length}</span>
                    </div>
                  </button>
                )
              })}
        </div>
      )}
    </section>
  )
}
