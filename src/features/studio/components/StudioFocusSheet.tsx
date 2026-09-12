import { useRef } from "react"

import { ProductSheet } from "@/design-system/primitives"
import { cn } from "@/lib/utils"
import { toTraySlot, type StudioCanvasSlot } from "@/features/studio/constants/layering"

/** Below this the gesture is a tap, not a swipe. iOS edge-swipe starts < 24px. */
const SWIPE_THRESHOLD = 48
const EDGE_GUARD = 24

export interface StudioFocusSheetProps {
  slot: StudioCanvasSlot
  title: string
  images: string[]
  attributes?: string[]
  saved?: boolean
  isLoading?: boolean
  isReadOnly?: boolean
  onSave?: () => void
  onLongPressSave?: () => void
  onTryOn?: () => void
  onFindItems?: () => void
  onOpenAlternatives?: () => void
  /** +1 = next worn piece, -1 = previous. */
  onStep?: (delta: number) => void
  className?: string
}

/**
 * The 225 dock under the focused figure. Arrows inside the image step through
 * this product's photos; a horizontal swipe on the sheet steps to the next worn
 * piece.
 */
export function StudioFocusSheet({
  slot,
  title,
  images,
  attributes = [],
  saved = false,
  isLoading = false,
  isReadOnly = false,
  onSave,
  onLongPressSave,
  onTryOn,
  onFindItems,
  onOpenAlternatives,
  onStep,
  className,
}: StudioFocusSheetProps) {
  const start = useRef<{ x: number; y: number } | null>(null)

  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0]
    if (!touch || touch.clientX < EDGE_GUARD) {
      start.current = null
      return
    }
    start.current = { x: touch.clientX, y: touch.clientY }
  }

  const handleTouchEnd = (event: React.TouchEvent) => {
    const from = start.current
    start.current = null
    if (!from || !onStep) return
    const touch = event.changedTouches[0]
    if (!touch) return
    const dx = touch.clientX - from.x
    const dy = touch.clientY - from.y
    // Horizontal intent lock — a vertical drag is a scroll, not a step.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return
    onStep(dx < 0 ? 1 : -1)
  }

  return (
    <div
      className={cn(
        "box-border flex h-[225px] flex-none flex-col px-4 py-2.5",
        "animate-in slide-in-from-bottom-4 duration-200",
        className,
      )}
      style={{ touchAction: "pan-y" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <ProductSheet
        title={title}
        images={images}
        slot={toTraySlot(slot)}
        attributes={attributes}
        carousel="left"
        mediaSize={176}
        cropToContent
        corner="alternatives"
        onCorner={onOpenAlternatives}
        actions={isReadOnly ? "none" : "icons"}
        saved={saved}
        onSave={onSave}
        onLongPressSave={onLongPressSave}
        onTryOn={onTryOn}
        onFindItems={onFindItems}
        onOpenAlternatives={onOpenAlternatives}
        isLoading={isLoading}
        className="h-[205px]"
      />
    </div>
  )
}
