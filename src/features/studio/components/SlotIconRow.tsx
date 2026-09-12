import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"
import { CANVAS_SLOT_NAMES, type StudioCanvasSlot } from "@/features/studio/constants/layering"

const SLOT_GLYPHS: Record<StudioCanvasSlot, React.ComponentType<{ className?: string }>> = {
  top: Icons.slotTop,
  bottom: Icons.slotBottom,
  shoes: Icons.slotShoes,
  layer: Icons.slotLayer,
}

export interface SlotIconRowProps {
  slots: StudioCanvasSlot[]
  active: StudioCanvasSlot
  onSelect: (slot: StudioCanvasSlot) => void
  isReadOnly?: boolean
  className?: string
}

/**
 * 36h category row at the top of the rack, under the source segment — the
 * artboard's own arrangement. Active is a 2px ink underline, never a fill.
 */
export function SlotIconRow({ slots, active, onSelect, isReadOnly = false, className }: SlotIconRowProps) {
  return (
    <div
      role="tablist"
      aria-label="Slot"
      className={cn(
        "box-border flex h-9 flex-none items-center gap-1.5 border-b border-hairline px-2",
        className,
      )}
    >
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
            onClick={isReadOnly ? undefined : () => onSelect(slot)}
            className={cn(
              "box-border flex h-control-chip min-w-0 flex-1 items-center justify-center text-ink",
              "disabled:cursor-not-allowed disabled:opacity-40",
              isActive ? "border-b-2 border-ink" : "rounded-control",
            )}
          >
            <Glyph className="h-4 w-4" />
          </button>
        )
      })}
    </div>
  )
}
