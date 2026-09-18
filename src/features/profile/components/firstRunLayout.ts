import type { CSSProperties } from "react"

import { useIsMobile } from "@/hooks/use-mobile"

/** Tailwind's `lg`. Below this a first-run screen is one column with no side pane. */
const TWO_PANE_BREAKPOINT = 1024

export const FIRST_RUN_STEP_COUNT = 2

export function useIsFirstRunCompact(): boolean {
  return useIsMobile(TWO_PANE_BREAKPOINT)
}

/** Staggered entrance for first-run header lines and body sections; pair with `revealDelay(index)`. */
export const REVEAL_CLASS =
  "animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both duration-500 ease-out"

// An inline style, not an arbitrary Tailwind class: a class built from a variable is never generated.
export function revealDelay(index: number): CSSProperties {
  return { animationDelay: `${index * 70}ms` }
}
