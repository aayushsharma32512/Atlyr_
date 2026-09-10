import { useRef } from "react"

import { cn } from "@/lib/utils"
import { Icons } from "@/design-system/icons"

export interface ProductTileProps {
  title: string
  imageSrc: string | null
  /** `small` drops the footer and the pin. */
  size?: "default" | "small"
  saved?: boolean
  /** Already worn — 2px ink border and a check; does not respond to taps. */
  worn?: boolean
  /** Show the pin. Default true. */
  mark?: boolean
  onSelect?: () => void
  onToggleSave?: () => void
  onLongPressSave?: () => void
  onImageError?: () => void
  /** Optional — the design carries none; kept for surfaces that still show them. */
  price?: string
  brand?: string
  className?: string
}

/** The piece tile: square image to the hairline, pin top-right, 40h footer with the name. */
export function ProductTile({
  title,
  imageSrc,
  size = "default",
  saved = false,
  worn = false,
  mark = true,
  onSelect,
  onToggleSave,
  onLongPressSave,
  onImageError,
  price,
  brand,
  className,
}: ProductTileProps) {
  const small = size === "small"
  const interactive = Boolean(onSelect) && !worn
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  const startLongPress = () => {
    if (!onLongPressSave) return
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      onLongPressSave()
    }, 500)
  }
  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }
  const handlePin = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    onToggleSave?.()
  }

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onSelect?.()
              }
            }
          : undefined
      }
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg bg-card text-left",
        worn ? "border border-ink shadow-[inset_0_0_0_1px_hsl(var(--ink))]" : "border border-hairline",
        interactive && "cursor-pointer",
        className,
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={title}
            loading="lazy"
            onError={onImageError}
            className="h-full w-full object-contain p-2"
          />
        ) : null}
        {!small && mark && !worn ? (
          <button
            type="button"
            aria-label={saved ? "Unsave" : "Save"}
            aria-pressed={saved}
            onClick={handlePin}
            onMouseDown={startLongPress}
            onMouseUp={cancelLongPress}
            onMouseLeave={cancelLongPress}
            onTouchStart={startLongPress}
            onTouchEnd={cancelLongPress}
            onTouchCancel={cancelLongPress}
            style={{ WebkitTouchCallout: "none", userSelect: "none" }}
            className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center text-ink"
          >
            <Icons.save className="h-4 w-4" fill={saved ? "currentColor" : "none"} aria-hidden="true" />
          </button>
        ) : null}
        {worn ? (
          <span className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-control bg-ink text-background">
            <Icons.check className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
          </span>
        ) : null}
      </div>
      {!small ? (
        <div className="flex h-10 items-center gap-2 border-t border-hairline px-2">
          <p className="min-w-0 flex-1 truncate text-card font-semibold text-ink">{title}</p>
          {price ? <span className="shrink-0 text-chip text-taupe">{price}</span> : null}
          {!price && brand ? <span className="shrink-0 truncate text-chip text-taupe">{brand}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
