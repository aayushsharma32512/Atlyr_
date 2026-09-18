import { Icons } from "@/design-system/icons"
import { ProductTile } from "@/design-system/primitives"
import { cn } from "@/lib/utils"
import type { StudioAlternativeProduct } from "@/services/studio/studioService"

export interface AlternatesRackProps {
  products: StudioAlternativeProduct[]
  isLoading?: boolean
  /** Ink ring + check. Never reordered to the front. */
  wornProductId?: string | null
  /** One clearable line describing the active search or similarity. */
  queryLine?: string | null
  onClearQuery?: () => void
  onSelect?: (product: StudioAlternativeProduct) => void
  emptyLabel?: string
  /** A violet ＋ under the empty label. Only the wardrobe passes it: it is the one rack the user fills themselves. */
  onAddToWardrobe?: () => void
  /** Only the catalogue rack ends with it — see the note by the button. */
  showWebSearch?: boolean
  /** The row's action: Find items in web mode for this slot. */
  onWebSearch?: () => void
  className?: string
}

/**
 * The two-column rack. Order is exactly what the search returned — the worn
 * piece is marked in place, never pinned to the front.
 */
export function AlternatesRack({
  products,
  isLoading = false,
  wornProductId = null,
  queryLine = null,
  onClearQuery,
  onSelect,
  emptyLabel = "Nothing in this slot yet",
  onAddToWardrobe,
  showWebSearch = false,
  onWebSearch,
  className,
}: AlternatesRackProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {queryLine ? (
        <div className="box-border flex h-[34px] flex-none items-center gap-1.5 border-b border-hairline pl-2">
          <span className="min-w-0 flex-1 truncate text-chip font-medium tracking-[0.08em] text-ink">
            {queryLine}
          </span>
          <button
            type="button"
            aria-label="Clear search"
            onClick={onClearQuery}
            className="flex h-6 w-6 flex-none items-center justify-center text-ink"
          >
            <Icons.close className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* No right padding: with the scrollbar gone the tiles run to the edge.
          Bottom padding clears the floating search lens for the last row. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-14 pl-2 pt-2 scrollbar-hide">
        {isLoading ? (
          <div className="grid grid-cols-2 content-start gap-1.5">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="aspect-square w-full animate-pulse rounded-lg bg-skeleton" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-2 py-6">
            <p className="text-center text-body text-taupe">{emptyLabel}</p>
            {onAddToWardrobe ? (
              <button
                type="button"
                aria-label="Add to wardrobe"
                onClick={onAddToWardrobe}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-violet text-violet"
              >
                <Icons.add className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-2 content-start gap-1.5">
            {products.map((product) => (
              <ProductTile
                key={product.id}
                size="small"
                cropToContent
                title={product.title}
                imageSrc={product.imageSrc ?? product.imageUrl ?? null}
                worn={product.id === wornProductId}
                // The save card that opens on tap already covers saving; a second
                // heart per tile was redundant.
                mark={false}
                onSelect={onSelect ? () => onSelect(product) : undefined}
              />
            ))}
          </div>
        )}

        {/* "Not in the catalogue? Look on the web." That only means anything at
            the end of the catalogue rack — not under an empty wardrobe or saves. */}
        {showWebSearch && !isLoading ? (
          <button
            type="button"
            disabled={!onWebSearch}
            onClick={onWebSearch}
            aria-label="Web search"
            title="Search the web for this slot"
            className={cn(
              "mt-1.5 box-border flex h-11 w-full items-center justify-center gap-2 rounded-control",
              "border border-hairline bg-white text-label font-semibold text-ink",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Icons.findItems className="h-5 w-5" aria-hidden="true" />
            web search
          </button>
        ) : null}
      </div>
    </div>
  )
}
