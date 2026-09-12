import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"
import {
  CANVAS_SLOT_NAMES,
  type StudioCanvasSlot,
} from "@/features/studio/constants/layering"

const SLOT_GLYPHS: Record<StudioCanvasSlot, React.ComponentType<{ className?: string }>> = {
  top: Icons.slotTop,
  bottom: Icons.slotBottom,
  shoes: Icons.slotShoes,
  layer: Icons.slotLayer,
}

export interface CategoryRailProps {
  slots: StudioCanvasSlot[]
  active?: StudioCanvasSlot | null
  /** Empty slots draw taupe; filled draw ink. */
  filled?: Partial<Record<StudioCanvasSlot, boolean>>
  onSelect?: (slot: StudioCanvasSlot) => void
  isReadOnly?: boolean
  className?: string
}

/**
 * The category icons. They live in the header's left half — on the canvas they
 * cost the figure a 44px gutter it cannot spare at a 390 frame.
 *
 * Styled as a segment to match the source segment sharing the row: 26h, active
 * marked by a 2px ink underline, never a fill.
 */
export function CategoryRail({
  slots,
  active = null,
  filled = {},
  onSelect,
  isReadOnly = false,
  className,
}: CategoryRailProps) {
  return (
    <div role="tablist" aria-label="Slot" className={cn("flex items-end gap-1.5", className)}>
      {slots.map((slot) => {
        const Glyph = SLOT_GLYPHS[slot]
        const isActive = slot === active
        return (
          <button
            key={slot}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={CANVAS_SLOT_NAMES[slot]}
            disabled={isReadOnly}
            onClick={isReadOnly ? undefined : () => onSelect?.(slot)}
            className={cn(
              "box-border flex h-control-chip w-9 items-center justify-center",
              "disabled:cursor-not-allowed disabled:opacity-40",
              isActive ? "border-b-2 border-ink text-ink" : "rounded-control",
              !isActive && (filled[slot] ? "text-ink" : "text-taupe"),
            )}
          >
            <Glyph className="h-4 w-4" />
          </button>
        )
      })}
    </div>
  )
}
