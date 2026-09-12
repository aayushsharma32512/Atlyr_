import { OutfitCard, ProductTile } from "@/design-system/primitives"
import type { FeedSection } from "@/features/search/hooks/useSearchFeed"
import type { FeedHandlers } from "@/features/search/components/SearchRail"
import type { FeedLook, FeedPiece } from "@/features/search/utils/feedShaping"

export const FEED_GRID = "grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4"

type FeedGridProps =
  | { kind: "looks"; section: FeedSection<FeedLook>; heightCm: number; handlers: FeedHandlers; skeletonCount: number }
  | { kind: "pieces"; section: FeedSection<FeedPiece>; heightCm: number; handlers: FeedHandlers; skeletonCount: number }

/** A row of shimmer cards sized for looks (250h) or pieces (215h). Shared by the initial load and paging loads. */
export function FeedGridSkeleton({ kind, count }: { kind: "looks" | "pieces"; count: number }) {
  return (
    <div className={FEED_GRID}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className={`skeleton-shimmer rounded-lg ${kind === "looks" ? "h-[250px]" : "h-[215px]"}`} />
      ))}
    </div>
  )
}

/** The looks/pieces vertical grid: skeleton while loading, empty copy, else cards. Used by For You and the list page. */
export function FeedGrid(props: FeedGridProps) {
  const { section, heightCm, handlers, skeletonCount } = props

  if (section.isLoading) return <FeedGridSkeleton kind={props.kind} count={skeletonCount} />
  if (section.items.length === 0) return <p className="text-xs text-taupe">Nothing here yet.</p>

  if (props.kind === "looks") {
    return (
      <div className={FEED_GRID}>
        {props.section.items.map((look, index) => {
          const saved = handlers.isLookSaved(look.outfit.id)
          return (
            <div key={look.id} className="h-[250px]">
              <OutfitCard
                title={look.title}
                outfitId={look.outfit.id}
                renderedItems={look.renderedItems}
                gender={look.gender}
                heightCm={heightCm}
                saved={saved}
                tiltIndex={index}
                onSelect={() => handlers.onOpenLook(look, "vertical_grid", index)}
                onToggleSave={() => handlers.onToggleLookSave(look.outfit.id, !saved)}
                onLongPressSave={() => handlers.onLongPressLookSave(look.outfit.id)}
              />
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={FEED_GRID}>
      {props.section.items.map((piece, index) => {
        const saved = handlers.isPieceSaved(piece.id)
        return (
          <ProductTile
            key={piece.id}
            title={piece.title}
            imageSrc={piece.imageSrc}
            saved={saved}
            cropToContent
            onSelect={() => handlers.onOpenPiece(piece, "vertical_grid", index)}
            onToggleSave={() => handlers.onTogglePieceSave(piece.id, !saved)}
            onLongPressSave={() => handlers.onLongPressPieceSave(piece.id)}
          />
        )
      })}
    </div>
  )
}
