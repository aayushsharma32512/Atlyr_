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
    <div className={cn("flex w-full items-center justify-between px-1", className)}>
      <div className="flex flex-col gap-0.5">
        {/* Section label. V2 casing rule: lowercase, normal tracking — it was
           tracked caps under Kalagriha. Normalised here rather than at the ten
           call sites, none of which pass a proper noun. */}
        <h2 className="text-chip font-medium lowercase tracking-normal text-taupe">
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


