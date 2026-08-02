import { Footprints, Layers, Plus, RotateCw, Shirt, X } from "lucide-react"

import { PriceDisplay } from "@/design-system/primitives"
import type { StudioProductTrayItem, StudioProductTraySlot } from "@/services/studio/studioService"
import { cn } from "@/lib/utils"

/**
 * Canvas 7a — the three worn pieces as stacked product rows under the model.
 *
 * Deliberately not `ProductTray`'s slot rows. Those render a full
 * `ProductSummaryCard` (image, specs, tags) and are shared with CreationsTab;
 * 7a wants a compact line — remove and layer glyphs *outside* the card on the
 * left, then an embossed slot glyph, name/brand, price and a terracotta ⟳ that
 * opens alternates for that slot. Overloading ProductTray with a variant flag
 * would have made one component serve two unrelated shapes.
 *
 * An emptied slot leaves a dashed "Add …" row that re-opens the rack, so
 * removing a piece is visibly undoable — `hiddenSlots` is URL state and part of
 * the history snapshot, so it also survives reload and travels in share links.
 */

const SLOT_LABELS: Record<StudioProductTraySlot, string> = {
  top: "Topwear",
  bottom: "Bottomwear",
  shoes: "Footwear",
}

/** Trousers outline — lucide has no bottoms glyph, and the one in
 *  category-filter-bar hardcodes a fill and a non-unique clipPath id. */
function BottomsGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 3h12l1 18h-5l-2-11-2 11H5L6 3Z" />
    </svg>
  )
}

const SLOT_GLYPHS: Record<
  StudioProductTraySlot,
  React.ComponentType<{ className?: string }>
> = {
  top: Shirt,
  bottom: BottomsGlyph,
  shoes: Footprints,
}

export interface StudioSlotRowsProps {
  slotOrder: StudioProductTraySlot[]
  items: StudioProductTrayItem[]
  hiddenSlots: Partial<Record<StudioProductTraySlot, boolean>>
  isReadOnly?: boolean
  /**
   * Card body — the worn piece's own details (7e drawer). The row already shows
   * name, brand and price, so tapping it reads as "tell me more about this one".
   */
  onOpenDetails: (slot: StudioProductTraySlot) => void
  /**
   * ⟳, and the empty row's "Add …" — other options for this slot. An empty slot
   * has no worn piece to detail, so it only has this destination.
   */
  onOpenAlternates: (slot: StudioProductTraySlot) => void
  onRemoveSlot: (slot: StudioProductTraySlot) => void
  /** Tour spotlight — must clear the z-[70] scrim to stay clickable. */
  highlight?: boolean
  className?: string
}

export function StudioSlotRows({
  slotOrder,
  items,
  hiddenSlots,
  isReadOnly = false,
  onOpenDetails,
  onOpenAlternates,
  onRemoveSlot,
  highlight = false,
  className,
}: StudioSlotRowsProps) {
  const itemBySlot = new Map(items.map((item) => [item.slot, item]))

  return (
    <div className={cn("flex flex-col gap-1.5 px-3.5", highlight && "isolate z-[75]", className)}>
      {slotOrder.map((slot) => {
        const item = itemBySlot.get(slot)
        const isHidden = Boolean(hiddenSlots[slot])
        const label = SLOT_LABELS[slot]
        const Glyph = SLOT_GLYPHS[slot]

        if (!item || isHidden) {
          return (
            <div key={`${slot}-empty`} className="flex items-center gap-1.5">
              <span className="w-[18px] shrink-0" aria-hidden="true" />
              <button
                type="button"
                disabled={isReadOnly}
                onClick={isReadOnly ? undefined : () => onOpenAlternates(slot)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2.5 rounded-[5px] border-[1.5px] border-dashed",
                  "border-hairline-4 bg-card/40 px-[11px] py-1.5 text-left",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-hairline-4 text-terracotta">
                  <Plus className="size-3" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[9.5px] font-semibold text-terracotta">
                    {`Add ${label}`}
                  </span>
                  <span className="block text-[7.5px] text-muted-foreground">slot empty</span>
                </span>
                <span className="shrink-0 text-[7.5px] font-semibold tracking-[0.1em] text-muted-foreground">
                  BROWSE
                </span>
              </button>
            </div>
          )
        }

        return (
          <div key={slot} className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={`Remove ${label}`}
              title="remove from the look"
              disabled={isReadOnly}
              onClick={isReadOnly ? undefined : () => onRemoveSlot(slot)}
              className="flex size-[18px] shrink-0 items-center justify-center text-muted-foreground disabled:opacity-40"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>

            {/* Layer order is presentational for now: slotOrder is local
                component state, not URL or history, so a reorder would not
                survive a reload. Shown, not wired, until it is persisted. */}
            <span
              className="flex size-[18px] shrink-0 items-center justify-center text-muted-foreground"
              title="layer order"
              aria-hidden="true"
            >
              <Layers className="size-3.5" />
            </span>

            {/* The card is a div, not a button: it holds TWO targets — the body
                (details) and ⟳ (alternates). A button inside a button is invalid
                HTML and browsers drop the inner one, which is why ⟳ used to be a
                decorative span with no click of its own. */}
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2.5 rounded-[5px] border-[1.5px] border-hairline",
                "bg-card pl-[11px] pr-1.5 transition-colors",
                isReadOnly ? "opacity-60" : "hover:border-hairline-4",
              )}
            >
              <button
                type="button"
                disabled={isReadOnly}
                onClick={isReadOnly ? undefined : () => onOpenDetails(slot)}
                title={`${item.title} — details`}
                className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left disabled:cursor-not-allowed"
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-ink-body"
                  style={{ boxShadow: "inset 0 1px 2px hsl(var(--ink) / 0.18)" }}
                >
                  <Glyph className="size-3" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[9.5px] font-semibold text-foreground">
                    {item.title}
                  </span>
                  <span className="block truncate text-[7.5px] text-muted-foreground">
                    {item.brand ?? ""}
                  </span>
                </span>

                <PriceDisplay
                  price={item.price}
                  className="shrink-0 text-[9.5px] font-bold text-foreground"
                />
              </button>

              <button
                type="button"
                disabled={isReadOnly}
                onClick={isReadOnly ? undefined : () => onOpenAlternates(slot)}
                aria-label={`Other ${label.toLowerCase()} options`}
                title={`Other ${label.toLowerCase()} options`}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-[3px] text-terracotta",
                  "transition-colors disabled:cursor-not-allowed",
                  !isReadOnly && "hover:bg-terracotta/10",
                )}
              >
                <RotateCw className="size-3" aria-hidden="true" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
