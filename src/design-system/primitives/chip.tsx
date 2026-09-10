import type { ReactNode } from "react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"

export interface ChipProps {
  label: string
  active?: boolean
  /** Gold ✦ before the label. Provenance only (Handloom). */
  mark?: boolean
  icon?: ReactNode
  onClick?: () => void
  /** Shows a trailing X; tapping anywhere on the chip removes it. */
  onRemove?: () => void
  className?: string
}

const BASE =
  "inline-flex h-control-chip shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border px-2.5 text-chip font-medium tracking-[0.08em]"

/** 26h chip. Outline at rest, ink fill when active. */
export function Chip({ label, active = false, mark, icon, onClick, onRemove, className }: ChipProps) {
  const classes = cn(
    BASE,
    active ? "border-ink bg-ink text-background" : "border-hairline bg-card text-ink",
    onRemove && "pr-1.5",
    className,
  )
  const body = (
    <>
      {mark ? (
        <span className="text-gold" aria-hidden="true">
          ✦
        </span>
      ) : null}
      {icon}
      {label}
      {onRemove ? <Icons.close className="h-3 w-3" strokeWidth={2} aria-hidden="true" /> : null}
    </>
  )
  const handler = onRemove ?? onClick
  if (!handler) return <span className={classes}>{body}</span>
  return (
    <button
      type="button"
      onClick={handler}
      aria-pressed={onRemove ? undefined : active}
      aria-label={onRemove ? `Remove ${label}` : undefined}
      className={classes}
    >
      {body}
    </button>
  )
}
