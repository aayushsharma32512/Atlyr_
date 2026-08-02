import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface SectionHeaderProps {
  title: string
  subtitle?: string
  className?: string
  actionLabel?: string
  actionSlot?: ReactNode
  onActionClick?: () => void
}

export function SectionHeader({
  title,
  subtitle,
  className,
  actionLabel,
  actionSlot,
  onActionClick,
}: SectionHeaderProps) {
  return (
    <div className={cn("flex w-full items-start justify-between px-1", className)}>
      <div className="flex flex-col gap-0.5">
        {/* Section-label role (Kalagriha §2.2): 10–11px sans caps, tracked, taupe.
            Previously the title was font-thin and the subtitle font-semibold — the
            hierarchy was inverted (P0-C8). */}
        <h2 className="text-[10.5px] font-semibold uppercase leading-none tracking-[0.15em] text-muted-foreground">
          {title}
        </h2>
        {subtitle ? <p className="text-xs font-normal text-taupe">{subtitle}</p> : null}
      </div>
      {actionSlot ? (
        actionSlot
      ) : actionLabel ? (
        <button
          type="button"
          onClick={onActionClick}
          className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}


