import type { CSSProperties, HTMLAttributes } from "react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"

export type SlotRowSlot = "top" | "bottom" | "shoes" | "layer"

const SLOT_NAME: Record<SlotRowSlot, string> = {
  top: "Top",
  bottom: "Bottom",
  shoes: "Shoes",
  layer: "Layer over top",
}

const SLOT_GLYPH: Record<SlotRowSlot, React.ComponentType<{ className?: string }>> = {
  top: Icons.slotTop,
  bottom: Icons.slotBottom,
  shoes: Icons.slotShoes,
  layer: Icons.slotLayer,
}

export interface SlotRowProps {
  slot: SlotRowSlot
  /** The worn piece's name. Falls back to the slot's own name. */
  label?: string | null
  /** No piece in this slot — dashed "＋ Top" row that invites one. */
  empty?: boolean
  /** Leading × that clears the slot. */
  removable?: boolean
  /** Trailing 4-square button that opens alternates for this slot. */
  alternatives?: boolean
  /** Spread onto the slot glyph — Studio makes it the drag handle for restacking. */
  glyphProps?: HTMLAttributes<HTMLSpanElement>
  style?: CSSProperties
  onSelect?: () => void
  onRemove?: () => void
  onOpenAlternatives?: () => void
  /** Layer rows only — flips which of the two tops sits on top. */
  onSwap?: () => void
  className?: string
}

/**
 * 32h piece row — slot glyph outside, then the piece in a hairline pill.
 *
 * Ported 1:1 from the bundle's `SlotRow.dc.html`. Both toggles default on, as
 * they do in the bundle; Creations turns them both off, so the row is the
 * glyph and the name and nothing else.
 */
export function SlotRow({
  slot,
  label,
  empty = false,
  removable = true,
  alternatives = true,
  glyphProps,
  style,
  onSelect,
  onRemove,
  onOpenAlternatives,
  onSwap,
  className,
}: SlotRowProps) {
  const Glyph = SLOT_GLYPH[slot]
  const slotName = SLOT_NAME[slot]

  if (empty) {
    return (
      <div className={cn("flex h-8 items-center gap-2", className)} style={style}>
        <span
          {...glyphProps}
          className={cn("flex h-6 w-6 flex-none items-center justify-center text-taupe", glyphProps?.className)}
        >
          <Glyph className="h-4 w-4" aria-hidden="true" />
        </span>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control border border-dashed",
            "border-hairline-dashed bg-card/45 px-2 text-left",
          )}
        >
          <span className="flex h-5 w-5 flex-none items-center justify-center text-ink">
            <Icons.add className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 text-card font-semibold text-ink">{slotName}</span>
        </button>
      </div>
    )
  }

  return (
    <div className={cn("flex h-8 items-center gap-2", className)} style={style}>
      <span
        {...glyphProps}
        className={cn("flex h-6 w-6 flex-none items-center justify-center text-ink", glyphProps?.className)}
      >
        <Glyph className="h-4 w-4" aria-hidden="true" />
      </span>

      {/* A div, not a button: the row can hold two targets (the name and the
          alternates button), and a button inside a button is invalid HTML. */}
      <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-control border border-hairline bg-card px-1">
        {removable ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${slotName.toLowerCase()}`}
            className="flex h-6 w-6 flex-none items-center justify-center text-taupe"
          >
            <Icons.close className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={onSelect}
          disabled={!onSelect}
          className="min-w-0 flex-1 truncate text-left text-card font-semibold text-ink disabled:cursor-default"
        >
          {label?.trim() || slotName}
        </button>

        {onSwap ? (
          <button
            type="button"
            onClick={onSwap}
            aria-label="Swap which piece is on top"
            className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-control text-taupe"
          >
            <Icons.swap className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}

        {alternatives ? (
          <button
            type="button"
            onClick={onOpenAlternatives}
            aria-label={`Other ${slotName.toLowerCase()} options`}
            className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-control border border-hairline bg-card text-ink"
          >
            <Icons.alternatives className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
