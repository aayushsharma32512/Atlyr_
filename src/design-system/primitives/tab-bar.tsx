import { useCallback, useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

export interface TabBarItem {
  id: string
  label: string
}

export interface TabBarProps {
  items: TabBarItem[]
  activeId?: string
  onChange?: (id: string) => void
  /** "equal" splits the width evenly; "scroll" sizes to content and scrolls. */
  fit?: "equal" | "scroll"
  /** Scroll mode only — keep the active tab centred as the selection moves. */
  autoCenterActive?: boolean
  "aria-label"?: string
  className?: string
}

/** 36h underline tabs. Active is a 2px ink rule — no fill, no pill. */
export function TabBar({
  items,
  activeId,
  onChange,
  fit = "equal",
  autoCenterActive = false,
  "aria-label": ariaLabel,
  className,
}: TabBarProps) {
  const scroll = fit === "scroll"
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const centerActive = useCallback(() => {
    if (!scroll || !autoCenterActive || !activeId) return
    const container = containerRef.current
    const button = buttonRefs.current.get(activeId)
    if (!container || !button) return

    const containerRect = container.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    const offset =
      buttonRect.left + buttonRect.width / 2 - (containerRect.left + containerRect.width / 2)
    if (Math.abs(offset) < 1) return

    container.scrollBy({ left: offset, behavior: "smooth" })
  }, [activeId, autoCenterActive, scroll])

  useEffect(() => {
    centerActive()
  }, [centerActive])

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex h-9 items-stretch px-4",
        scroll && "gap-4 overflow-x-auto scroll-smooth scrollbar-hide",
        className,
      )}
    >
      {items.map((item, i) => {
        const isActive = item.id === activeId

        return (
          <div key={item.id} className={cn("flex", scroll ? "flex-none" : "min-w-0 flex-1")}>
            {/* Hairline divider between equal-width tabs, as in the artboard. */}
            {!scroll && i > 0 ? (
              <span aria-hidden className="h-4 w-px flex-none self-center bg-hairline" />
            ) : null}
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              ref={(el) => {
                if (el) buttonRefs.current.set(item.id, el)
                else buttonRefs.current.delete(item.id)
              }}
              onClick={onChange ? () => onChange(item.id) : undefined}
              className={cn(
                "flex h-9 min-w-0 items-center justify-center whitespace-nowrap border-b-2 text-chip font-medium tracking-[0.08em] text-ink",
                scroll ? "px-0" : "flex-1",
                isActive ? "border-ink" : "border-transparent",
              )}
            >
              {item.label}
            </button>
          </div>
        )
      })}
    </div>
  )
}
