import * as React from "react"
import type { ComponentType } from "react"
import { ListFilter, ShoppingBag, Star, Users, X } from "lucide-react"

import { cn } from "@/lib/utils"

import { IconButton } from "./icon-button"
import { PriceDisplay } from "./price-display"
import { StatChip } from "./stat-chip"

type MaybeHandler = ((event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void) | undefined

const LONG_PRESS_DURATION = 500 // milliseconds

export interface ProductSummaryCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  rating: number | string
  reviewCount: number | string
  price: number | string
  discountPercent?: number | null
  showFilter?: boolean
  onFilter?: MaybeHandler
  showRemove?: boolean
  onRemove?: MaybeHandler
  onAddToBag?: MaybeHandler
  onAddToBagClickCapture?: MaybeHandler
  onDragStart?: () => void
  onDragEnd?: () => void
  onDragMove?: (clientY: number) => void
  filterIcon?: ComponentType<{ className?: string }>
  removeIcon?: ComponentType<{ className?: string }>
  addIcon?: ComponentType<{ className?: string }>
}

const DEFAULT_TITLE_CLASS = "text-xs font-medium leading-4 text-foreground w-[80%]"

function formatReviewCount(value: number | string) {
  if (typeof value === "string") return value
  if (value >= 1000) {
    const shortened = value / 1000
    return `${shortened.toFixed(shortened >= 10 ? 0 : 1)}k`
  }
  return value.toString()
}

export function ProductSummaryCard({
  title,
  rating,
  reviewCount,
  price,
  discountPercent,
  showFilter = false,
  onFilter,
  showRemove = true,
  onRemove,
  onAddToBag,
  onAddToBagClickCapture,
  onDragStart,
  onDragEnd,
  onDragMove,
  filterIcon: FilterIcon = ListFilter,
  removeIcon: RemoveIcon = X,
  addIcon: AddIcon = ShoppingBag,
  className,
  onClick,
  ...props
}: ProductSummaryCardProps) {
  const shouldRenderFilter = showFilter && onFilter

  // Dragging state
  const cardRef = React.useRef<HTMLDivElement>(null)
  const longPressTimerRef = React.useRef<NodeJS.Timeout | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const [dragY, setDragY] = React.useState(0)
  const initialTouchYRef = React.useRef<number | null>(null)
  const initialCardTopRef = React.useRef<number | null>(null)
  const hasDraggedRef = React.useRef(false)

  // Long press to drag
  const startLongPress = React.useCallback((clientY: number) => {
    longPressTimerRef.current = setTimeout(() => {
      if (cardRef.current) {
        const rect = cardRef.current.getBoundingClientRect()
        initialTouchYRef.current = clientY
        initialCardTopRef.current = rect.top
        setIsDragging(true)
        onDragStart?.()
      }
    }, LONG_PRESS_DURATION)
  }, [onDragStart])

  // Cancel long press
  const cancelLongPress = React.useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  // Handle filter touch start
  const handleFilterTouchStart = React.useCallback(
    (e: React.TouchEvent<HTMLButtonElement>) => {
      const touch = e.touches[0]
      startLongPress(touch.clientY)
    },
    [startLongPress]
  )

  // Handle filter mouse down
  const handleFilterMouseDown = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      startLongPress(e.clientY)
    },
    [startLongPress]
  )

  const handleFilterTouchEnd = React.useCallback(() => {
    cancelLongPress()
  }, [cancelLongPress])

  const handleFilterMouseUp = React.useCallback(() => {
    cancelLongPress()
  }, [cancelLongPress])

  // Handle touch move
  React.useEffect(() => {
    if (!isDragging) return

    const handleMove = (clientY: number) => {
      if (initialTouchYRef.current !== null && initialCardTopRef.current !== null) {
        const offsetY = clientY - initialTouchYRef.current
        setDragY(offsetY)
        if (Math.abs(offsetY) > 5) {
          hasDraggedRef.current = true
        }
        onDragMove?.(clientY)
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (e.cancelable) {
        e.preventDefault()
      }
      const touch = e.touches[0]
      handleMove(touch.clientY)
    }

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientY)
    }

    const handleEnd = () => {
      setIsDragging(false)
      setDragY(0)
      initialTouchYRef.current = null
      initialCardTopRef.current = null
      onDragEnd?.()
      // Reset drag flag after a short delay to prevent click
      setTimeout(() => {
        hasDraggedRef.current = false
      }, 100)
    }

    document.addEventListener("touchmove", handleTouchMove, { passive: false })
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("touchend", handleEnd)
    document.addEventListener("mouseup", handleEnd)

    return () => {
      document.removeEventListener("touchmove", handleTouchMove)
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("touchend", handleEnd)
      document.removeEventListener("mouseup", handleEnd)
    }
  }, [isDragging, onDragMove])

  React.useEffect(() => {
    return () => {
      cancelLongPress()
    }
  }, [cancelLongPress])

  const handleCardClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (hasDraggedRef.current) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      onClick?.(e)
    },
    [onClick]
  )

  return (
    <div
      ref={cardRef}
      className={cn(
        "flex items-center gap-1 text-sm",
        isDragging && "relative z-50",
        className
      )}
      style={
        isDragging
          ? {
              transform: `translateY(${dragY}px)`,
            }
          : undefined
      }
      onClick={handleCardClick}
      {...props}
    >
      {shouldRenderFilter ? (
        <IconButton
          tone="ghost"
          size="xs"
          aria-label="Filter similar items"
          onClick={onFilter}
          className="p-0 text-border max-w-4 w-6 min-w-[8%] h-6 flex  items-center justify-center"
          onTouchStart={handleFilterTouchStart}
          onTouchEnd={handleFilterTouchEnd}
          onMouseDown={handleFilterMouseDown}
          onMouseUp={handleFilterMouseUp}
          onMouseLeave={handleFilterMouseUp}
        >
          <FilterIcon className="h-4 w-4" />
        </IconButton>
      ) : null}

      <div className={`flex relative w-full items-center gap-1 rounded-xl border border-sidebar-border bg-card pl-0 pr-0 py-0.5 ${showRemove ? "max-w-[90%]" : "max-w-[100%] pl-3"}`}>
        {showRemove && onRemove ? (
          <IconButton
            tone="ghost"
            size="sm"
            aria-label="Remove item"
            onClick={(event) => {
              event.stopPropagation()
              onRemove(event)
            }}
            className="p-0 text-border"
          >
            <RemoveIcon className="h-4 w-4" />
          </IconButton>
        ) : null}

          <div className="flex flex-1 min-w-0 flex-shrink-0 flex-col gap-0">
            <p className={cn("truncate", DEFAULT_TITLE_CLASS ,)} title={title}>
            {title}
          </p>

          <div className="flex items-center gap-1">
            <StatChip
              tone="subtle"
              className="text-xs"
              icon={<Star className="h-4 w-4" />}
            >
              {rating}
            </StatChip>
            <StatChip
              tone="outline"
              className="text-xs"
              textClassName="text-muted-foreground"
              icon={<Users className="h-4 w-4" />}
            >
              {formatReviewCount(reviewCount)}
            </StatChip>
            <PriceDisplay
              price={price}
              discountPercent={discountPercent ?? undefined}
              className="ml-auto"
            />
          </div>
        </div>

        {onAddToBag ? (
          <div className="flex h-full items-center pl-1 pr-0 py-1">
            <IconButton
              tone="solid"
              size="sm"
              aria-label="Add to bag"
              onClick={onAddToBag}
              onClickCapture={onAddToBagClickCapture}
              className="rounded-l-md rounded-r-none bg-foreground px-2 py-1 text-card hover:opacity-90 [&>svg]:text-card"
            >
              <AddIcon className="h-4 w-4" />
            </IconButton>
          </div>
        ) : null}
      </div>
    </div>
  )
}
