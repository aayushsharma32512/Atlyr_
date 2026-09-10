import type { ReactNode } from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"

export interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Read by screen readers only. */
  title: string
  children: ReactNode
  className?: string
}

/** One sheet surface: ink scrim, hairline frame, 6px top corners, a 56×4 handle. */
export function BottomSheet({ open, onOpenChange, title, children, className }: BottomSheetProps) {
  return (
    <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/50" />
        <DrawerPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-t-frame border border-hairline bg-background outline-none",
            className,
          )}
        >
          <DrawerPrimitive.Title className="sr-only">{title}</DrawerPrimitive.Title>
          <div className="flex shrink-0 justify-center pt-2">
            <span className="h-1 w-14 rounded-full bg-hairline" aria-hidden="true" />
          </div>
          {children}
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  )
}
