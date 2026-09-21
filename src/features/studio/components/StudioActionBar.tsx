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
  className?: string
}

export function StudioActionBar({
  isReadOnly = false,
  saved = false,
  onSave,
  onTryOn,
  onFindItems,
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
          "rounded-control border border-hairline bg-white",
          saved ? "text-violet" : "text-ink",
          "disabled:cursor-not-allowed disabled:opacity-60",
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
          "bg-primary text-label font-semibold text-primary-foreground",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        <Icons.tryOn className="h-5 w-5" aria-hidden="true" />
        try on
      </button>

      <button
        type="button"
        disabled={isReadOnly}
        onClick={isReadOnly ? undefined : onFindItems}
        className={cn(
          "box-border flex h-control-primary flex-1 items-center justify-center gap-2 rounded-control",
          "border border-hairline bg-white text-label font-semibold text-ink",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        <Icons.findItems className="h-5 w-5" aria-hidden="true" />
        find items
      </button>
    </div>
  )
}
