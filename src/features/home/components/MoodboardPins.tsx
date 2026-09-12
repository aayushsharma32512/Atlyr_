import type { HTMLAttributes } from "react"

import { TabBar } from "@/design-system/primitives"
import { cn } from "@/lib/utils"

export interface MoodboardTab {
  id: string
  label: string
}

interface MoodboardPinsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  tabs: MoodboardTab[]
  activeTabId: string
  onTabSelect: (id: string) => void
}

/**
 * Board switcher on board detail. Same 36h underline tabs as the Collections
 * header — one nav treatment across the surface — sized to content and
 * horizontally scrollable, since a user can have any number of boards.
 *
 * The gold provenance edge that system boards carried as chips is gone with
 * the chip: an underline tab has no border to tint.
 */
export function MoodboardPins({ tabs, activeTabId, onTabSelect, className, ...rest }: MoodboardPinsProps) {
  return (
    <div className={cn("w-full bg-background", className)} {...rest}>
      <TabBar
        items={tabs}
        activeId={activeTabId}
        onChange={onTabSelect}
        fit="scroll"
        autoCenterActive
        aria-label="Moodboard tabs"
      />
    </div>
  )
}
