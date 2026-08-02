import { cn } from "@/lib/utils"

/**
 * Canvas 7a — the controls sit on the model's own edges, not on rails beside
 * it: history (undo · redo · reset) down the left, creative (shuffle · share)
 * down the right. 28px circles on a translucent white disc so they read as
 * floating over the weave rather than as a separate panel.
 *
 * Highlighted controls use z-[75] because StudioTour's scrim is z-[70] — the
 * old rails highlighted at z-[60] and were therefore unclickable *behind* the
 * dimmer whenever the tour pointed at them.
 */
export interface CanvasControlItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick?: () => void
  disabled?: boolean
  /** The one creative accent — shuffle. Everything else is ink. */
  tone?: "ink" | "terracotta"
  /** Checkpoint is a toggle; show it engaged. */
  active?: boolean
  highlight?: boolean
}

export interface CanvasControlClusterProps {
  items: CanvasControlItem[]
  className?: string
}

export function CanvasControlCluster({ items, className }: CanvasControlClusterProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            title={item.label}
            aria-pressed={item.active}
            disabled={item.disabled}
            onClick={item.onClick}
            className={cn(
              "flex size-7 items-center justify-center rounded-full border border-hairline",
              "bg-card/90 backdrop-blur-[2px] transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-40",
              item.tone === "terracotta" ? "text-terracotta" : "text-foreground",
              item.active && "border-foreground bg-foreground text-background",
              item.highlight && "relative z-[75] ring-2 ring-primary ring-offset-2 ring-offset-card",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        )
      })}
    </div>
  )
}
