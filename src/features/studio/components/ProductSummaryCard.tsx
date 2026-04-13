import { forwardRef, useRef } from "react"
import { ChevronsRight, Heart, Ruler, ShoppingBag, Star, Users } from "lucide-react"

import { IconButton } from "@/design-system/primitives/icon-button"
import { PriceDisplay } from "@/design-system/primitives/price-display"
import { StatChip } from "@/design-system/primitives/stat-chip"
import { cn } from "@/lib/utils"

import { SpecRow, type SpecRowItem } from "./SpecRow"

export interface ProductSummaryCardProps {
  imageSrc: string
  brand: string
  title: string
  price: number | string
  compareAtPrice?: number | string | null
  discountLabel?: string | null
  rating?: number | string | null
  reviewCount?: number | string | null
  primarySpecs?: SpecRowItem[]
  deliverySpecs?: SpecRowItem[]
  tags?: string[]
  onAddToBag?: () => void
  onToggleSave?: () => void
  onSizeGuide?: () => void
  onLongPressSave?: () => void
  isSaved?: boolean
  onClick?: () => void
  onScrollRight?: () => void
  className?: string
  recommendedOutfit?: boolean
  onScrollLeft?: () => void
  scrollLeft?: boolean
}

export const ProductSummaryCard = forwardRef<HTMLElement, ProductSummaryCardProps>(function ProductSummaryCard(
  {
    imageSrc,
    brand,
    title,
    price,
    compareAtPrice,
    discountLabel,
    rating,
    reviewCount,
    primarySpecs,
    deliverySpecs,
    tags = ["Tailored Fit", "Cotton", "Relaxed", "Breathable", "White"],
    onAddToBag,
    onToggleSave,
    onSizeGuide,
    onLongPressSave,
    isSaved,
    onClick,
    onScrollRight,
    className,
    recommendedOutfit = false,
    scrollLeft = false,
    onScrollLeft,
  },
  ref,
) {
  const longPressTimeout = useRef<NodeJS.Timeout | null>(null)
  const longPressTriggered = useRef(false)

  return (
    <article
      ref={ref}
      className={cn("relative flex gap-1.5 rounded-xl bg-card px-1 py-0.5 shadow-sm", className)}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onClick) {
          return
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onClick()
        }
      }}
    >
      <div className="relative flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
        <img
          src={imageSrc}
          alt={title}
          className="h-full w-full object-contain"
        />

      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="pr-1">
          <p className="text-xs font-semibold text-foreground">{brand}</p>
          <p className="line-clamp-2 text-xs2 leading-tight text-foreground truncate max-w-[140px]">{title}</p>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-foreground">
            <PriceDisplay price={price} className="text-xs font-semibold text-foreground" />
            {compareAtPrice ? (
              <span className="text-xs text-muted-foreground line-through">{compareAtPrice}</span>
            ) : null}
            {discountLabel ? (
              <span className="text-xs italic text-muted-foreground">{discountLabel}</span>
            ) : null}
          </div>
        </div>

        <div className="mt-0.5 flex items-center gap-3">
          {rating ? (
            <StatChip
              icon={<Star className="h-3 w-3" aria-hidden="true" />}
              className="rounded-md bg-card/80 px-0 py-0 text-xs"
            >
              {rating}
            </StatChip>
          ) : null}
          {reviewCount ? (
            <StatChip
              icon={<Users className="h-3 w-3" aria-hidden="true" />}
              className="rounded-md bg-card/80 px-0 py-0 text-xs"
            >
              {reviewCount}
            </StatChip>
          ) : null}
          {reviewCount ? (
            <StatChip
              icon={<Ruler className="h-4 w-4" aria-hidden="true" />}
              className="ml-auto rounded-md bg-card/80 h-5 w-5 px-0 py-0 text-sm"
              iconSize={4}
            >
            </StatChip>
          ) : null}
        </div>

        {primarySpecs?.length || deliverySpecs?.length ? (
          <div className="mt-1 flex w-full flex-col gap-0 rounded-lg bg-card/80 px-0 py-0.2">
            {primarySpecs?.length ? (
              <SpecRow
                items={primarySpecs}
                trailingTone="ghost"
                fallbackAction={onSizeGuide}
                variant="bare"
              />
            ) : null}
            {deliverySpecs?.length ? (
              <div className="flex w-full items-center px-0 py-0 text-xs2">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                  {deliverySpecs.slice(0, Math.max(deliverySpecs.length - 1, 0)).map((item, index) => (
                    <div key={index} className="flex min-w-0 items-center gap-1 whitespace-nowrap">
                      <span className="flex h-3 w-3 shrink-0 items-center justify-center [&>*]:h-3 [&>*]:w-3">
                        {item.icon}
                      </span>
                      {item.label ? <span className="truncate">{item.label}</span> : null}
                    </div>
                  ))}
                </div>

                {deliverySpecs.length > 0 && (
                  <div className="ml-1 flex shrink-0 items-center gap-1">
                    {onToggleSave ? (
                      <button
                        type="button"
                        className={cn(
                          "inline-flex h-5 w-5 items-center justify-center rounded-md border-none bg-transparent transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 select-none",
                          typeof isSaved === "boolean" && isSaved
                            ? "text-red-500 hover:text-red-600"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (longPressTriggered.current) {
                            longPressTriggered.current = false
                            return
                          }
                          onToggleSave()
                        }}
                        onContextMenu={(event) => event.preventDefault()}
                        onMouseDown={() => {
                          if (onLongPressSave) {
                            longPressTimeout.current = setTimeout(() => {
                              longPressTriggered.current = true
                              onLongPressSave()
                            }, 500)
                          }
                        }}
                        onMouseUp={() => {
                          if (longPressTimeout.current) {
                            clearTimeout(longPressTimeout.current)
                            longPressTimeout.current = null
                          }
                        }}
                        onMouseLeave={() => {
                          if (longPressTimeout.current) {
                            clearTimeout(longPressTimeout.current)
                            longPressTimeout.current = null
                          }
                        }}
                        onTouchStart={() => {
                          if (onLongPressSave) {
                            longPressTimeout.current = setTimeout(() => {
                              longPressTriggered.current = true
                              onLongPressSave()
                            }, 500)
                          }
                        }}
                        onTouchEnd={() => {
                          if (longPressTimeout.current) {
                            clearTimeout(longPressTimeout.current)
                            longPressTimeout.current = null
                          }
                        }}
                        onTouchCancel={() => {
                          if (longPressTimeout.current) {
                            clearTimeout(longPressTimeout.current)
                            longPressTimeout.current = null
                          }
                        }}
                        style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
                      >
                        <Heart
                          className="h-4 w-4"
                          aria-hidden="true"
                          fill={typeof isSaved === "boolean" && isSaved ? "currentColor" : "none"}
                        />
                      </button>
                    ) : (
                      // Fallback to SpecRow behavior if no save handler (though we prioritized save handler for this slot)
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className="flex h-3 w-3 shrink-0 items-center justify-center [&>*]:h-3 [&>*]:w-3">
                          {deliverySpecs[deliverySpecs.length - 1].icon}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}


        <div className="mt-auto flex flex-row gap-1 justify-between">

          {tags.length > 0 ? (
            <div className="mt-1 flex w-full min-w-0 max-w-full items-center gap-1 overflow-x-auto scrollbar-hide">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-xl border border-border bg-background px-0.5 py-0 text-[8px] font-medium text-xxs whitespace-nowrap"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          <IconButton
            tone="solid"
            size="sm"
            aria-label="Scroll left"
            onClick={(event) => {
              event.stopPropagation()
              onScrollLeft?.()
            }}
            className="rounded-l-md rounded-r-none border-none border-border bg-transparent w-6 h-8 hover:bg-transparent ml-5"
          >
            <ChevronsRight className="h-4 w-4 text-foreground" aria-hidden="true" />
          </IconButton>

        </div>

      </div>

      <IconButton
        tone="solid"
        size="sm"
        aria-label="Add to bag"
        onClick={(event) => {
          event.stopPropagation()
          onAddToBag?.()
        }}
        className="absolute right-0 top-1 rounded-l-md rounded-r-none border border-border bg-foreground"
      >
        <ShoppingBag className="h-4 w-4" aria-hidden="true" />
      </IconButton>
      {/* {recommendedOutfit ? (
        <IconButton
        tone="solid"
        size="sm"
        aria-label="Scroll to recommended outfits"
        onClick={(event) => {
          event.stopPropagation()
          onScrollRight?.()
        }}
        className="absolute right-0 top-10 rounded-l-md rounded-r-none border border-border bg-muted hover:bg-muted/80"
      >
        <ChevronsRight className="h-5 w-5 stroke-2 text-foreground " aria-hidden="true" />
      </IconButton>
      ) : null} */}
    </article>
  )
})
