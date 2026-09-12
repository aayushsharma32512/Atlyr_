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
        {/* Section label: 10.5px caps, tracked, taupe (docs/redesign/design.md). */}
        <h2 className="text-section font-semibold uppercase tracking-[0.14em] text-taupe">
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


