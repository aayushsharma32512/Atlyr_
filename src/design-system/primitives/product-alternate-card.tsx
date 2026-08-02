import { useCallback, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

import { Heart, Trash2 } from "lucide-react"

export interface ProductAlternateCardProps {
  imageSrc: string
  title: string
  brand: string
  price: string
  onClick?: () => void
  onRemove?: () => void
  onSave?: () => void
  onToggleSave?: () => void
  onLongPressSave?: () => void
  isSaved?: boolean
  className?: string
  layout?: "compact" | "fluid" | "masonry"
  /** Fires if the product image fails to load (e.g. missing/404 in storage) —
   *  lets a parent grid drop the card rather than show a broken image. */
  onImageError?: () => void
}

export function ProductAlternateCard({
  imageSrc,
  title,
  brand,
  price,
  onClick,
  onRemove,
  onSave,
  onToggleSave,
  onLongPressSave,
  isSaved,
  className,
  layout = "compact",
  onImageError,
}: ProductAlternateCardProps) {
  const isFluid = layout === "fluid"
  const isMasonry = layout === "masonry"
  const isWide = isFluid || isMasonry
  const isInteractive = Boolean(onClick)
  const { toast } = useToast()
  const imageMaxHeightClass = isMasonry || isFluid ? "max-h-56" : ""
  const [localSaved, setLocalSaved] = useState(false)
  const longPressTimeout = useRef<NodeJS.Timeout | null>(null)
  const longPressTriggered = useRef(false)
  const resolvedSaved = typeof isSaved === "boolean" ? isSaved : localSaved
  const startLongPress = () => {
    if (!onLongPressSave) return
    longPressTimeout.current = setTimeout(() => {
      longPressTriggered.current = true
      // If a drawer opens from this gesture, ensure focus doesn't remain on a soon-to-be aria-hidden element.
      const active = document.activeElement
      if (active && active instanceof HTMLElement) {
        active.blur()
      }
      onLongPressSave()
    }, 500)
  }
  const cancelLongPress = () => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current)
      longPressTimeout.current = null
    }
  }

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onRemove?.()
      toast({
        title: "Removed from alternatives",
      })
    },
    [onRemove, toast],
  )

  const handleSave = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (longPressTriggered.current) {
        longPressTriggered.current = false
        return
      }
      if (onToggleSave) {
        onToggleSave()
      } else {
        onSave?.()
      }
      if (typeof isSaved !== "boolean") {
        setLocalSaved((prev) => !prev)
      }
    },
    [isSaved, onSave, onToggleSave],
  )

  return (
    <div
      className={cn(
        "flex flex-col gap-0",
        !isMasonry && "min-h-[8rem]",
        isWide ? "w-full items-stretch" : "h-auto w-auto items-center", isFluid ? "px-0.5 rounded-md bg-card" : "",
        className,
      )}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isInteractive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
    >
      <div
        className={cn(
          // Uniform "clipboard" tile — the garment sits on the woven warp/weft ground
          // (kalagriha canvas product card). Product images are pre-framed to one
          // canvas, so every tile is the same square with a small margin around the piece.
          "warp-weft relative flex items-center justify-center overflow-hidden",
          isMasonry
            ? "rounded-lg w-full aspect-square"
            : isFluid
              ? "rounded-md w-full aspect-square"
              : "rounded-sm h-28 max-h-[9rem] min-w-10 w-20 max-w-[8rem] p-0 flex-grow",
          isInteractive && "cursor-pointer",
        )}
      >
        {isWide ? (
          <img
            src={imageSrc}
            alt={title}
            loading="lazy"
            onError={onImageError}
            className="h-full w-full object-contain p-3"
          />
        ) : (
          <div className={cn("object-contain p-2 h-full w-max", imageMaxHeightClass)}>
            <img
              src={imageSrc}
              alt={title}
              loading="lazy"
              onError={onImageError}
              className={cn("object-contain rounded-sm h-full w-full", imageMaxHeightClass)}
            />
          </div>
        )}
        <div className="absolute right-1 top-1 flex items-center">
          {/* <button
            type="button"
            onClick={handleRemove}
            aria-label="Remove alternative"
            className="flex h-5 w-5 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" strokeWidth={1.5} />
          </button> */}
          <button
            type="button"
            onClick={handleSave}
            onMouseDown={startLongPress}
            onMouseUp={cancelLongPress}
            onMouseLeave={cancelLongPress}
            onTouchStart={startLongPress}
            onTouchEnd={cancelLongPress}
            onTouchCancel={cancelLongPress}
            aria-label="Save alternative"
            style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
            className={cn(
              "flex size-6 items-center justify-center rounded-md bg-transparent text-muted-foreground/80 transition-colors hover:bg-muted/60 hover:text-primary select-none",
              resolvedSaved && "text-primary hover:text-primary" // saved = terracotta (was off-palette red-500)
            )}
          >
            <Heart
              className="h-4 w-4"
              aria-hidden="true"
              strokeWidth={1.5}
              fill={resolvedSaved ? "currentColor" : "none"}
            />
          </button>
        </div>
      </div>

      <div
        className={cn(
          "flex flex-1 flex-col gap-0.5 min-w-0",
          isFluid ? "w-full p-1 pb-2" : isMasonry ? "w-full" : "w-20",
        )}
      >
        {/* Card anatomy rule (Kalagriha Component_Specs §4): title first in ink,
            then brand (muted) left · price (ink 700, tabular) right on one baseline.
            Was brand-above-title with a muted price — both inverted (P1-C12/P0-C7). */}
        <p className="truncate text-xxs font-semibold leading-tight text-foreground">{title}</p>
        <div className="grid grid-cols-[1fr_auto] items-baseline gap-1 leading-tight">
          <span className="truncate text-xxs text-muted-foreground">{brand}</span>
          <span className="truncate text-right text-[13px] font-bold tabular-nums text-foreground">{price}</span>
        </div>
      </div>


    </div>
  )
}
