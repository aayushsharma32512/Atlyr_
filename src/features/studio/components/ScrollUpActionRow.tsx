import { ArrowDownRight, Heart, SquareUserRound } from "lucide-react"

import { cn } from "@/lib/utils"

import { TrayActionButton } from "@/design-system/primitives/tray-action-button"

export interface ScrollUpActionRowProps {
  className?: string
  onSave?: () => void
  onTryOn?: () => void
  onSimilar?: () => void
  disabled?: boolean
}

export function ScrollUpActionRow({
  className,
  onSave,
  onTryOn,
  onSimilar,
  disabled = false,
}: ScrollUpActionRowProps) {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      <TrayActionButton
        tone="plain"
        iconStart={Heart}
        label="Save"
        onClick={onSave}
        disabled={disabled}
        className="h-9 min-w-[7.5rem] max-w-[10rem] gap-2 rounded-xl px-4 text-xs"
      />
      <Separator />
      <TrayActionButton
        tone="plain"
        iconStart={SquareUserRound}
        label="Try-on"
        onClick={onTryOn}
        disabled={disabled}
        className="h-9 min-w-[7.5rem] max-w-[10rem] gap-2 rounded-xl px-4 text-xs"
      />
      <Separator />
      <TrayActionButton
        tone="plain"
        iconEnd={ArrowDownRight}
        label="Similar"
        onClick={onSimilar}
        disabled={disabled}
        className="h-9 min-w-[7.5rem] max-w-[10rem] gap-2 rounded-xl px-4 text-xs"
      />
    </div>
  )
}

function Separator() {
  return <div className="h-6 w-px bg-border/60" aria-hidden="true" />
}
