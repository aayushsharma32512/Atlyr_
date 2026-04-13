import { IconButton } from "@/design-system/primitives/icon-button"
import { cn } from "@/lib/utils"

export interface SpecRowItem {
  icon: React.ReactNode
  label?: React.ReactNode
  ariaLabel?: string
  onClick?: () => void
}

export interface SpecRowProps {
  items: SpecRowItem[]
  trailingTone?: "ghost" | "outline"
  fallbackAction?: () => void
  className?: string
  variant?: "pill" | "bare"
}

export function SpecRow({
  items,
  trailingTone = "ghost",
  fallbackAction,
  className,
  variant = "pill",
}: SpecRowProps) {
  if (!items || items.length === 0) {
    return null
  }

  const leadingItems = items.slice(0, Math.max(items.length - 1, 0))
  const trailingItem = items[items.length - 1]

  return (
    <div
      className={cn(
        "flex w-full items-center px-0 py-0 text-xs2",
        variant === "pill" && "rounded-lg bg-card/80",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {leadingItems.map((item, index) => (
          <div
            key={index}
            className="flex min-w-0 items-center gap-1 whitespace-nowrap"
          >
            <span className="flex h-3 w-3 shrink-0 items-center justify-center [&>*]:h-3 [&>*]:w-3">
              {item.icon}
            </span>
            {item.label ? (
              <span className="truncate">{item.label}</span>
            ) : null}
            {/* {index < leadingItems.length - 1 ? (
              <div className="h-5 bg-border/60" aria-hidden="true" />
            ) : null} */}
          </div>
        ))}
      </div>

      {trailingItem ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-1",
            variant === "pill" ? "ml-1.5" : "ml-1",
          )}
        >
          {/* {leadingItems.length > 0 ? (
            <div className="mr-2 h-5 bg-border/60" aria-hidden="true" />
          ) : null} */}
          {trailingItem.label ? (
            <span className="flex items-center gap-1 whitespace-nowrap">
              <span className="flex h-3 w-3 shrink-0 items-center justify-center [&>*]:h-3 [&>*]:w-3">
                {trailingItem.icon}
              </span>
              <span>{trailingItem.label}</span>
            </span>
          ) : (
            <IconButton
              tone={trailingTone}
              size="xxs"
              aria-label={trailingItem.ariaLabel}
              onClick={(e) => {
                e.stopPropagation()
                const handler = trailingItem.onClick ?? fallbackAction
                handler?.()
              }}
              className={cn(
                variant === "bare" && "bg-transparent",
                trailingTone === "outline" && "border border-border",
                trailingTone === "ghost" && "bg-transparent",
              )}
            >
              <span className="flex h-3 w-3 items-center justify-center [&>*]:h-3 [&>*]:w-3">
                {trailingItem.icon}
              </span>
            </IconButton>
          )}
        </div>
      ) : null}
    </div>
  )
}
