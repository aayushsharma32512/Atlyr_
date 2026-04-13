import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const statChipVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-0 py-0 text-xs font-medium leading-4 text-foreground",
  {
    variants: {
      tone: {
        subtle: "bg-transparent text-foreground",
        outline: "bg-transparent text-muted-foreground",
        solid: "bg-foreground text-background",
      },
    },
    defaultVariants: {
      tone: "subtle",
    },
  }
)

export interface StatChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statChipVariants> {
  icon?: React.ReactNode
  iconWrapperClassName?: string
  textClassName?: string
  iconSize?: number
}

export const StatChip = React.forwardRef<HTMLSpanElement, StatChipProps>(
  (
      { icon, tone, className, textClassName, iconWrapperClassName, children, iconSize, ...props },
      ref
  ) => {
    return (
      <span
        ref={ref}
        className={cn(statChipVariants({ tone }), className)}
        {...props}
      >
        {icon ? (
          <span
            className={cn(
              "flex size-3 items-center justify-center text-current",
              iconWrapperClassName,
              iconSize && `size-${iconSize}`
            )}
          >
            {icon}
          </span>
        ) : null}
        <span className={cn("whitespace-nowrap", textClassName)}>{children}</span>
      </span>
    )
  }
)

StatChip.displayName = "StatChip"

export { statChipVariants }

