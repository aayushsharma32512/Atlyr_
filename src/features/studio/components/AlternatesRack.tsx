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
  isProductSaved?: (productId: string) => boolean
  onToggleSave?: (productId: string, nextSaved: boolean) => void
  onLongPressSave?: (productId: string) => void
  emptyLabel?: string
  /** Only the catalogue rack ends with it — see the note by the button. */
  showWebSearch?: boolean
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
  isProductSaved,
  onToggleSave,
  onLongPressSave,
  emptyLabel = "Nothing in this slot yet",
  showWebSearch = false,
  className,
}: AlternatesRackProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {queryLine ? (
        <div className="box-border flex h-[34px] flex-none items-center gap-1.5 border-b border-hairline px-2">
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {isLoading ? (
          <div className="grid grid-cols-2 content-start gap-1.5">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="aspect-square w-full animate-pulse rounded-lg bg-skeleton" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="px-2 py-6 text-center text-body text-taupe">{emptyLabel}</p>
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
                saved={isProductSaved?.(product.id) ?? false}
                onSelect={onSelect ? () => onSelect(product) : undefined}
                onToggleSave={
                  onToggleSave
                    ? () => onToggleSave(product.id, !(isProductSaved?.(product.id) ?? false))
                    : undefined
                }
                onLongPressSave={onLongPressSave ? () => onLongPressSave(product.id) : undefined}
              />
            ))}
          </div>
        )}

        {/* "Not in the catalogue? Look on the web." That only means anything at
            the end of the catalogue rack — not under an empty wardrobe or saves. */}
        {showWebSearch && !isLoading ? (
          <button
            type="button"
            disabled
            aria-label="Web search"
            title="Web search is not available yet"
            className={cn(
              "mt-1.5 box-border flex h-11 w-full items-center justify-center gap-2 rounded-control",
              "border border-dashed border-hairline-dashed bg-card/45 text-label font-semibold text-ink",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Icons.findItems className="h-5 w-5" aria-hidden="true" />
            Web Search
          </button>
        ) : null}
      </div>
    </div>
  )
}
