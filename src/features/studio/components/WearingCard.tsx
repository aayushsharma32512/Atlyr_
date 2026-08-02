import { Bookmark, SquareUserRound } from "lucide-react"

import { PriceDisplay } from "@/design-system/primitives"
import { cn } from "@/lib/utils"

/**
 * Canvas 7c — the worn-piece card under the mini-model.
 *
 * Replaces `ShortProductCard` on this screen. That card carried a rating and a
 * review count that are `"—"` for nearly every product we hold, and a Buy
 * button duplicating the product page's. The canvas asks a narrower question —
 * *this is what you have on, do you want to see yourself in it* — so the card
 * carries the piece, a compact terracotta Try on, and a gold-outline save.
 *
 * One filled terracotta per screen: Try on takes it here, which is why Save is
 * an outline. Tapping the body opens the 7e peek.
 */

export interface WearingCardProps {
  slotLabel: string
  title: string
  brand?: string | null
  price: number
  onOpenDetails?: () => void
  onTryOn?: () => void
  onSave?: () => void
  isReadOnly?: boolean
  className?: string
}

export function WearingCard({
  slotLabel,
  title,
  brand,
  price,
  onOpenDetails,
  onTryOn,
  onSave,
  isReadOnly = false,
  className,
}: WearingCardProps) {
  return (
    <div
      className={cn(
        "rounded-[5px] border border-hairline bg-card px-3 py-2.5 md:px-4 md:py-3.5",
        className,
      )}
    >
      <button
        type="button"
        onClick={onOpenDetails}
        disabled={!onOpenDetails}
        className="block w-full text-left disabled:cursor-default"
      >
        <span className="block text-[6.5px] font-bold uppercase tracking-[0.18em] text-terracotta md:text-[8px]">
          Wearing · {slotLabel}
        </span>
        <span className="mt-1 block truncate font-display text-[13px] font-medium text-foreground md:text-[17px]">
          {title}
        </span>
        <span className="mt-0.5 flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[8px] text-muted-foreground md:text-[10px]">
            {brand ?? ""}
          </span>
          <PriceDisplay
            price={price}
            className="shrink-0 text-[11px] font-bold text-foreground md:text-[14px]"
          />
        </span>
      </button>

      <div className="mt-2 flex items-center gap-1.5 md:mt-3 md:gap-2">
        <button
          type="button"
          disabled={isReadOnly || !onTryOn}
          onClick={onTryOn}
          className={cn(
            "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[3px] bg-primary py-2 md:py-2.5",
            "text-[10px] font-bold text-primary-foreground transition-shadow hover:shadow-md md:text-[12px]",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <SquareUserRound className="size-3 md:size-3.5" aria-hidden="true" />
          Try on
        </button>
        {onSave && (
          <button
            type="button"
            disabled={isReadOnly}
            onClick={onSave}
            aria-label="Save this look"
            className={cn(
              "flex size-[30px] shrink-0 items-center justify-center rounded-[3px] border border-gold md:size-[38px]",
              "text-gold-deep transition-colors hover:bg-gold/5 disabled:opacity-60",
            )}
          >
            <Bookmark className="size-3 md:size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
