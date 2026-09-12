import type { CSSProperties, ReactNode } from "react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"
import { CanvasControlCluster, type CanvasControlItem } from "./CanvasControlCluster"
import type { StudioCanvasSlot } from "@/features/studio/constants/layering"

/**
 * Where each zone sits down the figure, as a fraction of its height (0 = crown,
 * 1 = feet), and which edge the window holds when it is taller than the zone.
 * Static: the renderer's placement maths is internal to AvatarRenderer, and
 * this only has to frame the zone, not measure it.
 */
type FocusBand = {
  start: number
  end: number
  anchor: "start" | "end" | "centre"
  /** Per-zone cap. A window wider than its band spills past the anchored edge. */
  maxZoom?: number
}

const FOCUS_BANDS: Record<StudioCanvasSlot, FocusBand> = {
  // Head stays in frame; the window grows downward.
  top: { start: 0.08, end: 0.52, anchor: "start" },
  // Sits low: the window's slack lands on the anchored edge, so anchoring at
  // the ankle put every spare pixel on the top's hem. Ends just past the ankle
  // and carries its own cap — the shared 2.2 made the window far taller than
  // the band. Kept near 2.7 because wide-leg trousers clip sideways above that.
  bottom: { start: 0.53, end: 0.9, anchor: "end", maxZoom: 2.7 },
  // Sits in the middle of the frame, with ground beneath — the zone is too
  // short to fill the window, and pinning it to the feet left it in the
  // bottom third.
  shoes: { start: 0.84, end: 1, anchor: "centre" },
  layer: { start: 0.08, end: 0.52, anchor: "start" },
}

/** 2.4 cropped tight against the edges; 1.6 was too shallow to feel focused. */
const MAX_ZOOM = 2.2

/**
 * Zoom by LAYOUT, never by transform. OutfitInspirationCard sizes itself from
 * `parentElement.getBoundingClientRect()` inside a ResizeObserver — that rect
 * includes ancestor transforms, while the observer only fires on layout. A
 * scaled ancestor therefore made the figure scale twice and never shrink back.
 * Growing the box instead keeps the measurement honest in both directions.
 */
function focusBox(slot: StudioCanvasSlot | null): CSSProperties {
  if (!slot) {
    return { inset: 0 }
  }
  const { start, end, anchor, maxZoom } = FOCUS_BANDS[slot]
  const zoom = Math.min(maxZoom ?? MAX_ZOOM, 1 / Math.max(end - start, 0.01))
  // The window shows `window` of the figure's height. When that is more than the
  // zone, hold the anchored edge rather than centring and spilling past it.
  const window = 1 / zoom
  const wanted =
    anchor === "start" ? start : anchor === "end" ? end - window : (start + end) / 2 - window / 2
  // Never above the crown. `centre` may run past the feet — that is ground,
  // and it is what keeps a short zone in the middle of the frame.
  const top = anchor === "centre" ? Math.max(0, wanted) : Math.max(0, Math.min(1 - window, wanted))
  return {
    width: `${(zoom * 100).toFixed(2)}%`,
    height: `${(zoom * 100).toFixed(2)}%`,
    left: `${(-((zoom - 1) / 2) * 100).toFixed(2)}%`,
    top: `${(-top * zoom * 100).toFixed(2)}%`,
  }
}

export interface StudioCanvasProps {
  /** The figure — StudioScreen owns its wiring. */
  figure: ReactNode
  focus: StudioCanvasSlot | null
  historyControls?: CanvasControlItem[]
  lookControls?: CanvasControlItem[]
  /** Focus only — step to the previous/next zone. +1 is down the figure. */
  onStepFocus?: (delta: number) => void
  highlight?: boolean
  /** Alternates packs the control stacks tighter against a half-width figure. */
  compact?: boolean
  className?: string
}

const FOCUS_TOGGLE =
  "absolute top-1/2 z-[2] flex h-9 w-9 -translate-y-1/2 items-center justify-center " +
  "rounded-full border border-hairline bg-card/90 text-ink backdrop-blur-[2px]"

/** The mannequin container: the figure, plus the two control stacks. */
export function StudioCanvas({
  figure,
  focus,
  historyControls,
  lookControls,
  onStepFocus,
  highlight = false,
  compact = false,
  className,
}: StudioCanvasProps) {
  return (
    <div
      className={cn(
        "relative min-h-0 w-full flex-1 overflow-hidden bg-muted/40",
        highlight ? "z-[75]" : "z-0",
        className,
      )}
    >
      <div className="bg-warp-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      {/* The figure owns the whole container. The category icons moved to the
          header so they stop costing it width. */}
      <div className="absolute" style={focusBox(focus)}>
        {figure}
      </div>

      {/* Zoomed in, the edges step through the zones: top -> bottom -> shoes. */}
      {focus && onStepFocus ? (
        <>
          <button
            type="button"
            aria-label="Previous piece"
            onClick={() => onStepFocus(-1)}
            className={FOCUS_TOGGLE + " left-2"}
          >
            <Icons.carouselPrev className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next piece"
            onClick={() => onStepFocus(1)}
            className={FOCUS_TOGGLE + " right-2"}
          >
            <Icons.carouselNext className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
          </button>
        </>
      ) : null}

      {/* Focus hands the container to the piece sheet — the controls hide. */}
      {focus ? null : (
        <>
          {historyControls?.length ? (
            <CanvasControlCluster
              items={historyControls}
              className={cn("absolute bottom-3", compact ? "left-1.5" : "left-3")}
            />
          ) : null}
          {lookControls?.length ? (
            <CanvasControlCluster
              items={lookControls}
              className={cn("absolute bottom-3", compact ? "right-1.5" : "right-3")}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
