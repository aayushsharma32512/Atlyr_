import type { ReactNode } from "react"
import { ChevronLeft } from "lucide-react"

import { FirstRunPane } from "@/features/profile/components/FirstRunPreview"
import {
  FIRST_RUN_STEP_COUNT,
  REVEAL_CLASS,
  revealDelay,
  useIsFirstRunCompact,
} from "@/features/profile/components/firstRunLayout"
import { cn } from "@/lib/utils"

export interface FirstRunShellProps {
  step: 1 | 2
  eyebrow: string
  title?: ReactNode
  lede?: string
  onBack?: () => void
  backLabel?: string
  /** Scrolling body; a flex column that fills the space between header and footer. */
  children: ReactNode
  footer: ReactNode
  /** Desktop only: the right-hand pane. Never mounted on a phone. */
  pane: ReactNode
}

/**
 * The two first-run screens share one frame: a 720px measure hung off a single
 * left axis, a plain block scroller, a pinned footer, and a live pane beside it
 * on desktop. Only the words and the body differ between steps.
 */
export function FirstRunShell({
  step,
  eyebrow,
  title,
  lede,
  onBack,
  backLabel = "Back",
  children,
  footer,
  pane,
}: FirstRunShellProps) {
  const isCompact = useIsFirstRunCompact()

  return (
    <div className="flex h-[100dvh] flex-row bg-white pl-[clamp(0px,(100vw_-_720px)*0.25,160px)]">
      <div className="relative flex min-h-0 w-full max-w-[720px] flex-1 flex-col overflow-hidden bg-white">
        <header className="shrink-0 px-[26px] pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <div className={cn("flex h-10 items-center justify-between", REVEAL_CLASS)} style={revealDelay(0)}>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="-ml-2 flex h-10 items-center gap-0.5 rounded-control pl-1 pr-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                {backLabel}
              </button>
            )}
            <p className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              <span className="flex gap-[3px]" aria-hidden="true">
                {Array.from({ length: FIRST_RUN_STEP_COUNT }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-0.5 w-5 rounded-full transition-colors duration-500",
                      i < step ? "bg-primary" : "bg-hairline-4",
                    )}
                  />
                ))}
              </span>
              <span>
                <span className="sr-only">Step {step} of {FIRST_RUN_STEP_COUNT}: </span>
                {eyebrow}
              </span>
            </p>
          </div>
          {title && (
            <h1
              className={cn("mt-3 font-display text-fluid-h1 font-medium leading-[1.08] text-foreground", REVEAL_CLASS)}
              style={revealDelay(1)}
            >
              {title}
            </h1>
          )}
          {lede && (
            <p className={cn("mt-3 font-voice text-xl font-medium italic leading-[1.4] text-foreground", REVEAL_CLASS)} style={revealDelay(2)}>
              {lede}
            </p>
          )}
        </header>

        {/* Plain block scroller, not Radix ScrollArea: its table-sized viewport lets a wide rail widen the page. */}
        <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
          <div className="flex h-full flex-col pb-4 pt-2">{children}</div>
        </div>

        <footer className="shrink-0 border-t border-hairline bg-white px-[26px] pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3.5">
          {footer}
        </footer>
      </div>

      {!isCompact && <FirstRunPane className="bg-white">{pane}</FirstRunPane>}
    </div>
  )
}
