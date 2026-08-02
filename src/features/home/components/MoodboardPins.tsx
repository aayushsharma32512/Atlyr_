import { useCallback, useEffect, useRef, type HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

export interface MoodboardTab {
  id: string
  label: string
}

/** Boards backed by the system (not user-curated) — they carry the gold edge. */
const SYSTEM_BOARD_IDS = new Set(["try-ons", "wardrobe"])

interface MoodboardPinsProps extends HTMLAttributes<HTMLDivElement> {
  tabs: MoodboardTab[]
  activeTabId: string
  onTabSelect: (id: string) => void
}

export function MoodboardPins({ tabs, activeTabId, onTabSelect, className, ...rest }: MoodboardPinsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const centerActiveTab = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const activeButton = buttonRefs.current.get(activeTabId)
      const container = containerRef.current
      if (!activeButton || !container) return

      const containerRect = container.getBoundingClientRect()
      const buttonRect = activeButton.getBoundingClientRect()
      const containerCenter = containerRect.left + containerRect.width / 2
      const buttonCenter = buttonRect.left + buttonRect.width / 2
      const scrollOffset = buttonCenter - containerCenter
      if (Math.abs(scrollOffset) < 1) return

      container.scrollBy({
        left: scrollOffset,
        behavior,
      })
    },
    [activeTabId],
  )

  useEffect(() => {
    centerActiveTab("smooth")
  }, [centerActiveTab])

  return (
    <div
      ref={containerRef}
      className={cn(
        // Chip row container (matches "Closet" style chips)
        "flex w-full items-center gap-2 overflow-x-auto scrollbar-hide px-2 py-1",
        "snap-x snap-mandatory scroll-smooth",
        className,
      )}
      role="tablist"
      aria-label="Moodboard tabs"
      {...rest}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId
        // System boards (Try-ons, and Wardrobe once it lands) carry the gold
        // provenance edge — the one place gold is allowed outside the Nama (P0-C20).
        const isSystem = SYSTEM_BOARD_IDS.has(tab.id)
        return (
          <button
            key={`${tab.id}-${index}`}
            ref={(el) => {
              if (el) {
                buttonRefs.current.set(tab.id, el)
              } else {
                buttonRefs.current.delete(tab.id)
              }
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabSelect(tab.id)}
            className={cn(
              // 3px rect chips (P0-C20). Active = filled charcoal + cream.
              "flex-shrink-0 whitespace-nowrap rounded-[3px] border px-3.5 py-1.5 text-[11px] font-medium leading-none",
              "transition-colors duration-200 active:scale-[0.98] snap-center snap-always",
              isActive
                ? "border-foreground bg-foreground text-background"
                : isSystem
                  ? "border-gold/60 bg-card text-gold-muted hover:border-gold"
                  : "border-hairline bg-card text-ink hover:border-hairline-3 hover:bg-editorial/40",
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
