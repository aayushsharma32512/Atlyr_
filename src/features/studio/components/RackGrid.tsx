import { Heart } from "lucide-react"

import { PriceDisplay } from "@/design-system/primitives"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * Canvas 7c — the rack itself: square cards, two tight columns, tap to wear.
 *
 * Not `AlternativesGrid`. That grid is auto-fit on a 4.5rem minimum, so on a
 * desktop half-panel it silently becomes five or six columns and the cards stop
 * resembling the design at all; it also delegates to `ProductAlternateCard`,
 * which is shared with screens that want a remove affordance this one doesn't
 * have. Two explicit columns, and the anatomy the canvas draws: ♡ on the photo,
 * name, brand left / price right, WEARING when it's already on the model.
 */

export interface RackGridProduct {
  id: string
  title: string
  brand: string | null
  price: number
  imageSrc: string
}

export interface RackGridProps {
  products: RackGridProduct[]
  /** Tap the card — wears the piece. */
  onSelect?: (product: RackGridProduct) => void
  /** The piece currently on the model in this slot. */
  wornProductId?: string | null
  isProductSaved?: (productId: string) => boolean
  onToggleSave?: (productId: string, nextSaved: boolean) => void
  onLongPressSave?: (productId: string) => void
  isLoading?: boolean
  emptyState?: React.ReactNode
  /**
   * Minimum card width in px. Columns are auto-filled from it rather than
   * fixed, so a wider rack (a laptop, or the expanded panel) gets *more* cards
   * at a readable size instead of the same two stretched or squeezed.
   */
  minCardPx?: number
  className?: string
}

const gridStyle = (minCardPx: number): React.CSSProperties => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(${minCardPx}px, 1fr))`,
})

export function RackGrid({
  products,
  onSelect,
  wornProductId,
  isProductSaved,
  onToggleSave,
  onLongPressSave,
  isLoading = false,
  emptyState,
  minCardPx = 108,
  className,
}: RackGridProps) {
  if (isLoading) {
    return (
      <div
        className={cn("grid content-start gap-2 overflow-y-auto p-2.5", className)}
        style={gridStyle(minCardPx)}
      >
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-1">
            <Skeleton className="aspect-square w-full rounded-[4px]" />
            <Skeleton className="h-2 w-3/4" />
            <Skeleton className="h-2 w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  if (products.length === 0) {
    return <div className={cn("flex flex-1 items-center justify-center p-4", className)}>{emptyState}</div>
  }

  return (
    <div
      className={cn("grid content-start gap-2 overflow-y-auto p-2.5", className)}
      style={gridStyle(minCardPx)}
    >
      {products.map((product) => {
        const isWorn = product.id === wornProductId
        const saved = isProductSaved?.(product.id) ?? false

        return (
          <div key={product.id} className="flex min-w-0 flex-col">
            <button
              type="button"
              disabled={!onSelect || isWorn}
              onClick={onSelect && !isWorn ? () => onSelect(product) : undefined}
              title={isWorn ? "Already on the model" : `Wear ${product.title}`}
              className={cn(
                "bg-warp-grid group relative flex aspect-square w-full items-center justify-center",
                "overflow-hidden rounded-[4px] border bg-card transition-colors disabled:cursor-default",
                isWorn ? "border-terracotta" : "border-hairline hover:border-hairline-4",
              )}
            >
              {product.imageSrc ? (
                <img
                  src={product.imageSrc}
                  alt=""
                  loading="lazy"
                  className="relative max-h-[85%] max-w-[85%] object-contain"
                />
              ) : (
                <span className="relative text-[7px] font-semibold tracking-[0.1em] text-taupe">
                  NO IMAGE
                </span>
              )}

              {isWorn && (
                <span className="absolute inset-x-0 bottom-0 bg-terracotta py-[3px] text-center text-[7px] font-bold tracking-[0.12em] text-on-ink-1">
                  WEARING
                </span>
              )}
            </button>

            {/* Outside the wear button — a ♡ nested in a button is invalid HTML
                and the tap would swap the garment instead of saving it. */}
            {onToggleSave && (
              <button
                type="button"
                aria-label={saved ? "Remove from saves" : "Save this piece"}
                onClick={() => onToggleSave(product.id, !saved)}
                onContextMenu={
                  onLongPressSave
                    ? (event) => {
                        event.preventDefault()
                        onLongPressSave(product.id)
                      }
                    : undefined
                }
                className="-mt-7 mb-1 mr-1 self-end rounded-full bg-card/85 p-1 text-ink-body backdrop-blur-[1px]"
              >
                <Heart
                  className={cn("size-3.5", saved && "fill-terracotta text-terracotta")}
                  aria-hidden="true"
                />
              </button>
            )}

            <p className="truncate text-[9.5px] font-semibold leading-tight text-foreground">
              {product.title}
            </p>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[8.5px] text-muted-foreground">
                {product.brand ?? ""}
              </span>
              <PriceDisplay
                price={product.price}
                className="shrink-0 text-[9px] font-bold text-foreground"
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
