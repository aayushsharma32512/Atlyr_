import * as React from "react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type TrayActionTone = "outline" | "plain"

interface TrayActionButtonProps extends Omit<ButtonProps, "variant" | "size"> {
  tone?: TrayActionTone
  iconStart?: React.ComponentType<{ className?: string }>
  iconEnd?: React.ComponentType<{ className?: string }>
  label: string
}

const toneClasses: Record<TrayActionTone, string> = {
  outline:
    "border border-input bg-card text-foreground hover:bg-muted/40 hover:text-foreground",
  plain:
    "border-0 bg-transparent text-foreground hover:bg-muted/30 hover:text-foreground",
}

export const TrayActionButton = React.forwardRef<HTMLButtonElement, TrayActionButtonProps>(
  (
    {
      tone = "outline",
      iconStart: IconStart,
      iconEnd: IconEnd,
      className,
      label,
      ...props
    },
    ref
  ) => {
    return (
      
      <Button
        ref={ref}
        variant="ghost"
        size="sm"
        className={cn(
          "h-full w-full gap-1 rounded-lg px-0.5 py-0.5 text-xs font-medium",
          "items-center justify-center",
          toneClasses[tone],
          className
        )}
        {...props}
      >
        {IconStart ? <IconStart className="size-4" /> : null}
        <span className="truncate">{label}</span>
        {IconEnd ? <IconEnd className="size-4" /> : null}
      </Button>
    )
  }
)

TrayActionButton.displayName = "TrayActionButton"


