import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"
import type { StudioSource } from "@/features/studio/utils/studioUrlState"

const SOURCES: Array<{ id: StudioSource; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "wardrobe", label: "Wardrobe", icon: Icons.sourceWardrobe },
  { id: "saves", label: "Saves", icon: Icons.sourceSaves },
  { id: "explore", label: "Explore", icon: Icons.findItems },
]

export interface AlternatesHeaderProps {
  source: StudioSource
  onSourceChange: (source: StudioSource) => void
  onBack: () => void
  isReadOnly?: boolean
  className?: string
}

/** 52h: back on the left, the 195px source segment on the right. */
export function AlternatesHeader({
  source,
  onSourceChange,
  onBack,
  isReadOnly = false,
  className,
}: AlternatesHeaderProps) {
  return (
    <div className={cn("box-border flex h-[52px] flex-none items-stretch border-b border-hairline pl-4", className)}>
      <div className="flex flex-1 items-center">
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="-ml-1.5 flex h-8 w-6 flex-none items-center justify-center text-ink"
        >
          <Icons.carouselPrev className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Source"
        className="box-border flex h-[52px] w-[195px] flex-none items-end gap-1.5 px-2 pb-[5px]"
      >
        {SOURCES.map(({ id, label, icon: Icon }) => {
          const isActive = id === source
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={label}
              disabled={isReadOnly}
              onClick={isReadOnly ? undefined : () => onSourceChange(id)}
              className={cn(
                "box-border flex h-control-chip min-w-0 flex-1 items-center justify-center text-ink",
                "disabled:cursor-not-allowed disabled:opacity-40",
                isActive ? "border-b-2 border-ink" : "rounded-control",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
