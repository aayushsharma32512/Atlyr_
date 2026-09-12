import { useRef, useState } from "react"

import { Icons } from "@/design-system/icons"
import { GarmentImage } from "./garment-image"
import { cn } from "@/lib/utils"

export type ProductSheetSlot = "top" | "bottom" | "shoes"
/** Single icon parked at the top-right of the sheet. */
export type ProductSheetCorner = "none" | "close" | "alternatives" | "search" | "similar"
export type ProductSheetActions = "icons" | "primary" | "save-search" | "save-try" | "none"

export interface ProductSheetProps {
  title: string
  images: string[]
  slot?: ProductSheetSlot | null
  /** Draw the slot tag ahead of the attribute chips. */
  showSlot?: boolean
  /** fit · feel · vibe · colour · material. No brand, no price. */
  attributes?: string[]
  /** Which side the square carousel sits on. */
  carousel?: "left" | "right"
  /** `panel` stacks media over details for a column; `sheet` is always horizontal. */
  layout?: "sheet" | "panel"
  /** Square carousel edge in px — sheet layout only. */
  mediaSize?: number
  corner?: ProductSheetCorner
  onCorner?: () => void
  /** Ring the corner control — the product tour points at it. */
  highlightCorner?: boolean
  actions?: ProductSheetActions
  saved?: boolean
  onSave?: () => void
  onLongPressSave?: () => void
  onTryOn?: () => void
  /** Override when the action opens Studio rather than starting a try-on. */
  tryOnLabel?: string
  onFindItems?: () => void
  /** Focus only — tapping the details opens the slot's alternatives. */
  onOpenAlternatives?: () => void
  /** Frame the garment, not the transparent placement canvas around it. */
  cropToContent?: boolean
  isLoading?: boolean
  className?: string
}

const SLOT_LABELS: Record<ProductSheetSlot, string> = { top: "Top", bottom: "Bottom", shoes: "Shoes" }
const SLOT_ICONS = { top: Icons.slotTop, bottom: Icons.slotBottom, shoes: Icons.slotShoes } as const

const CORNER_ICONS = {
  close: Icons.close,
  alternatives: Icons.alternatives,
  search: Icons.findItems,
  similar: Icons.similar,
} as const

const CORNER_LABELS = {
  close: "Close",
  alternatives: "Alternatives",
  search: "Find items",
  similar: "More like this piece",
} as const

const ACTION =
  "box-border flex h-control-secondary min-w-0 flex-1 items-center justify-center gap-2 rounded-control text-label font-semibold"

const CAROUSEL_TOGGLE =
  "absolute top-1/2 z-[1] flex h-7 w-7 -translate-y-1/2 items-center justify-center " +
  "rounded-full bg-ink/40 text-background backdrop-blur-[2px]"

/**
 * The piece sheet — brief §3.2. `sheet` is horizontal: a square carousel on one
 * side (dots inside the bottom edge, chevrons, no thumbnails), details on the
 * other — sized for a dock, so give it the artboard's 205px height. `panel`
 * stacks the square carousel over the details, which is what a full screen or a
 * narrow column wants; add your own ground and divider via className.
 *
 * Details carry name, slot tag and attribute chips only; brand, price and
 * reviews never appear here.
 */
export function ProductSheet({
  title,
  images,
  slot = null,
  showSlot = false,
  attributes = [],
  carousel = "left",
  layout = "sheet",
  mediaSize = 176,
  corner = "none",
  onCorner,
  highlightCorner = false,
  actions = "icons",
  saved = false,
  onSave,
  onLongPressSave,
  onTryOn,
  tryOnLabel = "Try on",
  onFindItems,
  onOpenAlternatives,
  cropToContent = false,
  isLoading = false,
  className,
}: ProductSheetProps) {
  const [index, setIndex] = useState(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  const panel = layout === "panel"
  const frames = images.length > 0 ? images : [null]
  const active = Math.min(index, frames.length - 1)
  const step = (delta: number) => setIndex((i) => (i + delta + frames.length) % frames.length)

  const startLongPress = () => {
    if (!onLongPressSave) return
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      onLongPressSave()
    }, 500)
  }
  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }
  const handleSave = () => {
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    onSave?.()
  }

  const cornerControl =
    corner === "none" ? null : { Icon: CORNER_ICONS[corner], label: CORNER_LABELS[corner] }
  const SlotIcon = slot ? SLOT_ICONS[slot] : null

  const saveButton = (withLabel: boolean, outlined: boolean) => (
    <button
      type="button"
      aria-label={saved ? "Unsave" : "Save"}
      aria-pressed={saved}
      onClick={handleSave}
      onMouseDown={startLongPress}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
      onTouchStart={startLongPress}
      onTouchEnd={cancelLongPress}
      onTouchCancel={cancelLongPress}
      style={{ WebkitTouchCallout: "none", userSelect: "none" }}
      className={cn(
        ACTION,
        outlined ? "border border-ink bg-transparent text-ink" : "border border-hairline bg-card text-ink",
      )}
    >
      <Icons.save className="h-5 w-5" fill={saved ? "currentColor" : "none"} aria-hidden="true" />
      {withLabel ? "Save" : null}
    </button>
  )

  const tryOnButton = (withLabel: boolean, tall: boolean, filled: boolean) => (
    <button
      type="button"
      aria-label={tryOnLabel}
      onClick={onTryOn}
      className={cn(
        ACTION,
        tall && "h-control-primary",
        filled ? "bg-terracotta text-background" : "border border-hairline bg-card text-ink",
      )}
    >
      <Icons.tryOn className="h-5 w-5" aria-hidden="true" />
      {withLabel ? tryOnLabel : null}
    </button>
  )

  const findItemsButton = (withLabel: boolean, filled: boolean) => (
    <button
      type="button"
      aria-label="Find items"
      onClick={onFindItems}
      className={cn(
        ACTION,
        filled ? "border border-terracotta bg-terracotta text-background" : "border border-hairline bg-card text-ink",
      )}
    >
      <Icons.findItems className="h-5 w-5" aria-hidden="true" />
      {withLabel ? "Find items" : null}
    </button>
  )

  return (
    <div
      className={cn(
        "relative box-border flex h-full w-full",
        panel ? "flex-col gap-3" : "items-stretch gap-3",
        className,
      )}
    >
      {cornerControl ? (
        <button
          type="button"
          aria-label={cornerControl.label}
          onClick={onCorner}
          className={cn(
            "absolute z-[2] flex h-8 w-8 items-center justify-center rounded-control text-ink",
            // Stacked, the corner lands on the image itself — back it so it stays
            // legible over a photo. Docked, it sits on the sheet's own ground.
            panel ? "right-1 top-1 bg-card/80 backdrop-blur-[2px]" : "right-0 top-0",
            highlightCorner && "z-[60] ring-2 ring-primary ring-offset-2 ring-offset-card",
          )}
        >
          <cornerControl.Icon className="h-5 w-5" strokeWidth={corner === "close" ? 2 : 1.8} aria-hidden="true" />
        </button>
      ) : null}

      <div
        className={cn("flex flex-col", panel ? "w-full flex-none" : "flex-none", carousel === "right" && "order-2")}
        style={panel ? undefined : { width: mediaSize }}
      >
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-lg border border-hairline bg-muted",
            panel ? "aspect-square" : "min-h-0 flex-1",
          )}
        >
          {isLoading ? (
            <div className="h-full w-full animate-pulse bg-skeleton" />
          ) : frames[active] ? (
            <GarmentImage
              src={frames[active] as string}
              alt={title}
              cropToContent={cropToContent}
              loading="eager"
            />
          ) : null}

          {/* Toggles on the edges, no dots. Bigger targets than a chevron inside
              a pill, and they leave the garment unobstructed. */}
          {frames.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="Previous image"
                onClick={() => step(-1)}
                className={CAROUSEL_TOGGLE + " left-1"}
              >
                <Icons.carouselPrev className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next image"
                onClick={() => step(1)}
                className={CAROUSEL_TOGGLE + " right-1"}
              >
                <Icons.carouselNext className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-2",
          !panel && "min-h-0",
          onOpenAlternatives && "cursor-pointer",
        )}
        onClick={onOpenAlternatives}
      >
        <p
          className={cn(
            "m-0 line-clamp-2 min-h-[39px] flex-none text-label font-semibold leading-[1.3] text-ink",
            !panel && corner !== "none" && "pr-7",
          )}
        >
          {title}
        </p>

        <div className="flex min-h-0 flex-[0_1_auto] flex-wrap content-start gap-1.5 overflow-hidden">
          {showSlot && slot && SlotIcon ? (
            <span className="box-border inline-flex h-control-chip items-center gap-[5px] whitespace-nowrap rounded-control border border-hairline bg-muted px-2.5 text-chip font-medium tracking-[0.08em] text-ink">
              <SlotIcon className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
              {SLOT_LABELS[slot]}
            </span>
          ) : null}
          {attributes.map((label) => (
            <span
              key={label}
              className="box-border inline-flex h-control-chip items-center whitespace-nowrap rounded-control border border-hairline bg-card px-2.5 text-chip font-medium tracking-[0.08em] text-ink"
            >
              {label}
            </span>
          ))}
        </div>

        {actions !== "none" ? (
          <div className="mt-auto flex flex-none items-center gap-2">
            {actions === "icons" ? (
              <>
                {saveButton(false, false)}
                {tryOnButton(false, false, false)}
                {findItemsButton(false, true)}
              </>
            ) : null}
            {actions === "save-search" ? (
              <>
                {saveButton(true, true)}
                {findItemsButton(true, false)}
              </>
            ) : null}
            {actions === "save-try" ? (
              <>
                {saveButton(true, true)}
                {tryOnButton(true, true, true)}
              </>
            ) : null}
            {actions === "primary" ? (
              <>
                <button
                  type="button"
                  aria-label={saved ? "Unsave" : "Save"}
                  aria-pressed={saved}
                  onClick={handleSave}
                  onMouseDown={startLongPress}
                  onMouseUp={cancelLongPress}
                  onMouseLeave={cancelLongPress}
                  onTouchStart={startLongPress}
                  onTouchEnd={cancelLongPress}
                  onTouchCancel={cancelLongPress}
                  style={{ WebkitTouchCallout: "none", userSelect: "none" }}
                  className="inline-flex h-control-secondary w-10 flex-none items-center justify-center rounded-control border border-hairline bg-card text-ink"
                >
                  <Icons.save className="h-5 w-5" fill={saved ? "currentColor" : "none"} aria-hidden="true" />
                </button>
                {tryOnButton(true, true, true)}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
