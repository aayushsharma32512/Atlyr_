import type { InspirationItem } from "@/features/studio/types"
import { cn } from "@/lib/utils"

interface FeedHeroBandProps {
  items: InspirationItem[]
  onSelect?: (item: InspirationItem) => void
  className?: string
}

// Eyebrow labels rotate through the canvas set (DROP 01 · TRENDING → THE EDIT → ↑ THIS WEEK).
const EYEBROWS = ["Drop 01 · Trending", "The edit", "↑ This week"]

/**
 * TRENDING NOW — a horizontal scroll rail of dark warp/weft editorial tiles
 * (canvas 6d): fixed 150×86 pins, a touch tilted, drawn from the top curated looks.
 * Dark surfaces are warm charcoal, never the dossier ink.
 */
export function FeedHeroBand({ items, onSelect, className }: FeedHeroBandProps) {
  const tiles = items.slice(0, 8)
  if (tiles.length < 2) return null

  return (
    <div className={cn("flex gap-2.5 overflow-x-auto scrollbar-hide", className)}>
      {tiles.map((item, index) => {
        const labelCount = item.chips?.length ?? 0
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect?.(item)}
            className={cn(
              "warp-weft-dark relative flex h-[86px] w-[150px] flex-none flex-col justify-end overflow-hidden rounded-frame border border-ink-line px-3 py-2.5 text-left transition-transform active:scale-[0.98]",
              index % 2 === 0 ? "pin-tilt-5" : "pin-tilt-2",
            )}
          >
            <span className="relative w-full truncate text-[7.5px] font-semibold uppercase tracking-[0.16em] text-terracotta-tint">
              {EYEBROWS[index % EYEBROWS.length]}
            </span>
            <h3 className="relative mt-1 w-full truncate font-display text-[15px] font-medium leading-tight text-background">
              {item.title || "Curated look"}
            </h3>
            <p className="relative mt-0.5 text-[8.5px] leading-none text-on-ink-1">
              {labelCount > 0 ? `${labelCount} ${labelCount === 1 ? "label" : "labels"}` : "curated"}
            </p>
          </button>
        )
      })}
    </div>
  )
}

export default FeedHeroBand
