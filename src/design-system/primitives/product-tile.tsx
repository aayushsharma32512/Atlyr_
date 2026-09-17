import { useRef, type ReactNode } from "react"

import { cn } from "@/lib/utils"
import { Icons } from "@/design-system/icons"
import { GarmentImage } from "./garment-image"

export interface ProductTileProps {
  title: string
  imageSrc: string | null
  /** `small` drops the footer. The pin follows `mark` either way. */
  size?: "default" | "small"
  saved?: boolean
  /** Already worn — 2px ink outline. A tap still fires `onSelect` so the caller can take it off. */
  worn?: boolean
  /** Show the pin. Default true. */
  mark?: boolean
  onSelect?: () => void
  onToggleSave?: () => void
  onLongPressSave?: () => void
  onImageError?: () => void
  /**
   * Frame the garment, not the transparent placement canvas around it. On by
   * default: every surface wants it, and it is a no-op on real photographs —
   * GarmentImage only crops an image that is genuinely mostly transparent.
   * Opting out was the wrong default; it left segmented cutouts rendering as a
   * small garment adrift in an empty card.
   */
  cropToContent?: boolean
  /** Optional — the design carries none; kept for surfaces that still show them. */
  price?: string
  brand?: string
  className?: string
  /**
   * Rendered bottom-left inside the image box, mirroring the pin's top-right
   * corner slot. Anchoring it here — not on a wrapper around the whole tile —
   * keeps it pinned to the image regardless of the footer's height, since the
   * footer (name, price/brand) sits below the image as a separate row.
   */
  bottomLeftOverlay?: ReactNode
}

/** Cropped garments stop short of the corner overlays. */
const CROP_FILL = 0.7

/** The piece tile: square image to the hairline, pin top-right, 40h footer with the name.
 *  The Alternates rack uses `small` — photo-only tiles that keep the pin. */
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
  cropToContent = true,
  price,
  brand,
  className,
  bottomLeftOverlay,
}: ProductTileProps) {
  const small = size === "small"
  const interactive = Boolean(onSelect)
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
      className={cn("flex w-full flex-col gap-1.5 text-left", interactive && "cursor-pointer", className)}
    >
      {/* V2: the hairline frames the image only; the name sits below it on the
          ground, not inside a card. The worn tile takes the violet border. */}
      <div
        className={cn(
          "relative aspect-square w-full overflow-hidden rounded-lg bg-background",
          worn ? "border-[1.5px] border-violet" : "border border-hairline",
        )}
      >
        {imageSrc ? (
          <GarmentImage
            src={imageSrc}
            alt={title}
            cropToContent={cropToContent}
            // The pin sits over the top-right corner, so a cropped garment needs
            // margin to clear it.
            fill={CROP_FILL}
            onError={onImageError}
          />
        ) : null}
        {mark && !worn ? (
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
            className={cn(
              "absolute right-0 top-0 flex h-8 w-8 items-center justify-center",
              // "Selected hearts are violet everywhere" — fill and stroke both,
              // so the saved state reads at tile size. Unsaved stays ink.
              saved ? "text-violet" : "text-ink",
            )}
          >
            <Icons.save className="h-4 w-4" fill={saved ? "currentColor" : "none"} aria-hidden="true" />
          </button>
        ) : null}
        {bottomLeftOverlay}
      </div>
      {!small ? (
        <div className="flex items-center gap-2 px-0.5">
          <p className="min-w-0 flex-1 truncate text-card font-medium text-ink">{title}</p>
          {price ? <span className="shrink-0 text-chip text-taupe">{price}</span> : null}
          {!price && brand ? <span className="shrink-0 truncate text-chip text-taupe">{brand}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
