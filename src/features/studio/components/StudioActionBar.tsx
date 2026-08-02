import { Bookmark, SquareUserRound } from "lucide-react"

import { PriceDisplay } from "@/design-system/primitives"
import { cn } from "@/lib/utils"

/**
 * Canvas 7a bottom bar — three-up: Save, Try on, and the priced details
 * callout.
 *
 * The callout is deliberately *not* a button: dashed border, translucent, no
 * fill. It reads as a receipt stub you swipe up, which is what it does
 * (`openScrollUp`). Save is gold because saving is ownership, not action;
 * Try on is the screen's single filled terracotta, per the colour law.
 */
export interface StudioActionBarProps {
  total: number
  pieceCount: number
  isReadOnly?: boolean
  onSave?: () => void
  onTryOn?: () => void
  onDetails?: () => void
  highlightSave?: boolean
  highlightTryOn?: boolean
  highlightDetails?: boolean
  className?: string
}

export function StudioActionBar({
  total,
  pieceCount,
  isReadOnly = false,
  onSave,
  onTryOn,
  onDetails,
  highlightSave = false,
  highlightTryOn = false,
  highlightDetails = false,
  className,
}: StudioActionBarProps) {
  return (
    <div
      className={cn(
        "flex items-stretch gap-2.5 bg-gradient-to-t from-background from-[34%] to-transparent px-5 pb-5 pt-2.5",
        className,
      )}
    >
      <button
        type="button"
        disabled={isReadOnly}
        onClick={isReadOnly ? undefined : onSave}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 rounded-[3px] border border-gold",
          "bg-card py-3 text-[11px] font-bold text-gold-deep transition-colors",
          "hover:bg-gold/5 disabled:cursor-not-allowed disabled:opacity-60",
          highlightSave && "relative z-[75] ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      >
        <Bookmark className="size-3.5" aria-hidden="true" />
        Save
      </button>

      <button
        type="button"
        disabled={isReadOnly}
        onClick={isReadOnly ? undefined : onTryOn}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 rounded-[3px] bg-primary py-3",
          "text-[11px] font-bold text-primary-foreground shadow-sm transition-shadow",
          "hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60",
          highlightTryOn && "relative z-[75] ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      >
        <SquareUserRound className="size-3.5" aria-hidden="true" />
        Try on
      </button>

      <button
        type="button"
        onClick={onDetails}
        aria-label="Shop the look"
        className={cn(
          "flex flex-[1.15] flex-col justify-center gap-px rounded-[5px] border border-dashed",
          "border-hairline-4 bg-card/50 px-[11px] py-1.5 text-left transition-colors hover:bg-card/80",
          highlightDetails && "relative z-[75] ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      >
        <span className="flex items-baseline gap-1.5">
          <PriceDisplay
            price={total}
            className="text-[12.5px] font-bold tabular-nums text-foreground"
          />
          <span className="text-[7.5px] font-medium text-muted-foreground">
            {pieceCount === 1 ? "1 piece" : `${pieceCount} pieces`}
          </span>
        </span>
        <span className="text-[8px] font-semibold tracking-[0.1em] text-terracotta">
          ⌃ SWIPE FOR DETAILS
        </span>
      </button>
    </div>
  )
}
