import { useCallback, useEffect, useRef, type HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

export interface MoodboardTab {
  id: string
  label: string
}

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
              // Base chip styling
              "flex-shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-xs font-medium leading-none",
              "transition-colors duration-200",
              "active:scale-[0.98]",
              "snap-center snap-always",
              isActive
                ? "bg-muted text-foreground"
                : "bg-muted/50 text-foreground hover:bg-muted/75",
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
