import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const iconButtonVariants = cva(
  "inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 [&>svg]:pointer-events-none",
  {
    variants: {
      tone: {
        subtle:
          "border border-border bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
        ghost:
          "border-none bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        outline:
          "border border-border bg-card text-muted-foreground hover:bg-muted/40",
        solid:
          "border border-transparent bg-foreground text-background hover:bg-foreground/90",
        inverse:
          "border border-transparent bg-background text-foreground shadow-sm hover:bg-background/90",
      },
      size: {
        xxs: "h-5 w-5 rounded-md [&>svg]:h-3 [&>svg]:w-3",
        xs: "h-7 w-7 rounded-md [&>svg]:h-3 [&>svg]:w-3",
        sm: "h-8 w-8 rounded-md [&>svg]:h-4 [&>svg]:w-4",
        md: "h-9 w-9 rounded-lg [&>svg]:h-4 [&>svg]:w-4",
        lg: "h-10 w-10 rounded-lg [&>svg]:h-5 [&>svg]:w-5",
      },
    },
    defaultVariants: {
      tone: "subtle",
      size: "sm",
    },
  }
)

export interface IconButtonProps
  extends Omit<ButtonProps, "variant" | "size">,
    VariantProps<typeof iconButtonVariants> {}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ tone, size, className, children, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="icon"
        className={cn(iconButtonVariants({ tone, size }), className)}
        {...props}
      >
        {children}
      </Button>
    )
  }
)

IconButton.displayName = "IconButton"

export { iconButtonVariants }
