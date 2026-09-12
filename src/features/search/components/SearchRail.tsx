import type { ReactNode } from "react"

import { Icons } from "@/design-system/icons"
import { OutfitCard, ProductTile, SectionHeader } from "@/design-system/primitives"
import type { FeedSection } from "@/features/search/hooks/useSearchFeed"
import type { FeedLook, FeedPiece } from "@/features/search/utils/feedShaping"

export type FeedList = "hot" | "curations"
export type FeedLayout = "horizontal_rail" | "vertical_grid"

export interface FeedHandlers {
  onOpenLook: (look: FeedLook, layout: FeedLayout, position: number) => void
  onOpenPiece: (piece: FeedPiece, layout: FeedLayout, position: number) => void
  isLookSaved: (outfitId: string) => boolean
  onToggleLookSave: (outfitId: string, next: boolean) => void
  onLongPressLookSave: (outfitId: string) => void
  isPieceSaved: (productId: string) => boolean
  onTogglePieceSave: (productId: string, next: boolean) => void
  onLongPressPieceSave: (productId: string) => void
}

type SearchRailProps =
  | { kind: "looks"; section: FeedSection<FeedLook>; title: string; heightCm: number; onOpenList: () => void; handlers: FeedHandlers }
  | { kind: "pieces"; section: FeedSection<FeedPiece>; title: string; heightCm: number; onOpenList: () => void; handlers: FeedHandlers }

const RAIL_LIMIT = 12
// Looks show 3½ 96px cards, pieces show 2½ 136px (square) cards; the last is cut at the gutter, as the board asks.
const CARD = "w-[96px] shrink-0"
const PIECE_CARD = "w-[136px] shrink-0"
const TRACK = "h-[136px]"

export function SearchRail(props: SearchRailProps) {
  const { title, section, heightCm, onOpenList, handlers } = props

  let content: ReactNode
  if (section.isLoading) {
    const skeletonCard = props.kind === "pieces" ? PIECE_CARD : CARD
    content = Array.from({ length: 4 }).map((_, i) => (
      <span key={i} role="listitem" className={`skeleton-shimmer rounded-lg ${skeletonCard} ${TRACK}`} />
    ))
  } else if (props.kind === "looks") {
    const items = props.section.items.slice(0, RAIL_LIMIT)
    content = items.map((look, index) => {
      const saved = handlers.isLookSaved(look.outfit.id)
      return (
        <div key={look.id} className={`${CARD} ${TRACK}`} role="listitem">
          <OutfitCard
            title={look.title}
            footer={false}
            outfitId={look.outfit.id}
            renderedItems={look.renderedItems}
            gender={look.gender}
            heightCm={heightCm}
            saved={saved}
            onSelect={() => handlers.onOpenLook(look, "horizontal_rail", index)}
            onToggleSave={() => handlers.onToggleLookSave(look.outfit.id, !saved)}
            onLongPressSave={() => handlers.onLongPressLookSave(look.outfit.id)}
          />
        </div>
      )
    })
  } else {
    const items = props.section.items.slice(0, RAIL_LIMIT)
    content = items.map((piece, index) => {
      const saved = handlers.isPieceSaved(piece.id)
      return (
        <div key={piece.id} className={PIECE_CARD} role="listitem">
          <ProductTile
            size="small"
            title={piece.title}
            imageSrc={piece.imageSrc}
            saved={saved}
            cropToContent
            onSelect={() => handlers.onOpenPiece(piece, "horizontal_rail", index)}
            onToggleSave={() => handlers.onTogglePieceSave(piece.id, !saved)}
            onLongPressSave={() => handlers.onLongPressPieceSave(piece.id)}
          />
        </div>
      )
    })
  }

  const isEmpty = !section.isLoading && section.items.length === 0

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
        <div className={`flex gap-2 overflow-x-auto scrollbar-hide ${TRACK}`} role="list" aria-label={title}>
          {content}
        </div>
      )}
    </section>
  )
}
