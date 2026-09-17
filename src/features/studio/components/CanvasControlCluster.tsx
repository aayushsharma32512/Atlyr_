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
  icon: React.ComponentType<{ className?: string; fill?: string }>
  onClick?: () => void
  disabled?: boolean
  /** The one creative accent — shuffle. Everything else is ink. */
  tone?: "ink" | "terracotta"
  /** Checkpoint is a toggle; show it engaged. */
  active?: boolean
  /** Save is a state; a saved look shows a filled heart, same as the Studio action bar. */
  filled?: boolean
  highlight?: boolean
}

export interface CanvasControlClusterProps {
  items: CanvasControlItem[]
  className?: string
}

export function CanvasControlCluster({ items, className }: CanvasControlClusterProps) {
  return (
    <div className={cn("flex flex-col", className)}>
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
            // V2: bare charcoal glyphs on the figure, no disc. 40px targets;
            // disabled reads as the grey the design draws for redo.
            className={cn(
              "flex size-10 items-center justify-center rounded-control transition-colors",
              "disabled:cursor-not-allowed disabled:text-disabled",
              item.active ? "text-violet" : "text-ink",
              item.highlight && "relative z-[75] ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
          >
            <Icon className="size-4" fill={item.filled ? "currentColor" : "none"} />
          </button>
        )
      })}
    </div>
  )
}
