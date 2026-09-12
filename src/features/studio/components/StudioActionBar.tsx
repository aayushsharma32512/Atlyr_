import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"

/**
 * Canvas bottom bar — Save (pin, 40×40) · Try on (the screen's one terracotta
 * fill) · Find items (dashed outline). No price, no receipt stub: brief §6.7.
 */
export interface StudioActionBarProps {
  isReadOnly?: boolean
  saved?: boolean
  onSave?: () => void
  onTryOn?: () => void
  onFindItems?: () => void
  highlightSave?: boolean
  highlightTryOn?: boolean
  highlightFindItems?: boolean
  className?: string
}

const RING = "relative z-[75] ring-2 ring-primary ring-offset-2 ring-offset-background"

export function StudioActionBar({
  isReadOnly = false,
  saved = false,
  onSave,
  onTryOn,
  onFindItems,
  highlightSave = false,
  highlightTryOn = false,
  highlightFindItems = false,
  className,
}: StudioActionBarProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        aria-label="Save this look"
        aria-pressed={saved}
        disabled={isReadOnly}
        onClick={isReadOnly ? undefined : onSave}
        className={cn(
          "box-border flex h-control-secondary w-control-secondary flex-none items-center justify-center",
          "rounded-control border border-hairline bg-card text-ink",
          "disabled:cursor-not-allowed disabled:opacity-60",
          highlightSave && RING,
        )}
      >
        <Icons.save className="h-5 w-5" fill={saved ? "currentColor" : "none"} aria-hidden="true" />
      </button>

      <button
        type="button"
        disabled={isReadOnly}
        onClick={isReadOnly ? undefined : onTryOn}
        className={cn(
          "box-border flex h-control-primary flex-1 items-center justify-center gap-2 rounded-control",
          "bg-terracotta text-label font-semibold text-background",
          "disabled:cursor-not-allowed disabled:opacity-60",
          highlightTryOn && RING,
        )}
      >
        <Icons.tryOn className="h-5 w-5" aria-hidden="true" />
        Try on
      </button>

      <button
        type="button"
        disabled={isReadOnly}
        onClick={isReadOnly ? undefined : onFindItems}
        className={cn(
          "box-border flex h-control-primary flex-1 items-center justify-center gap-2 rounded-control",
          "border border-dashed border-hairline-dashed bg-card/50 text-label font-semibold text-ink",
          "disabled:cursor-not-allowed disabled:opacity-60",
          highlightFindItems && RING,
        )}
      >
        <Icons.findItems className="h-5 w-5" aria-hidden="true" />
        Find items
      </button>
    </div>
  )
}
