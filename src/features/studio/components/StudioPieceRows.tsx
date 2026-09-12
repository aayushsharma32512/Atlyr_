import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"

import { SlotRow } from "@/design-system/primitives"
import { cn } from "@/lib/utils"
import type { StudioProductTrayItem } from "@/services/studio/studioService"
import type { StudioCanvasSlot } from "@/features/studio/constants/layering"

export interface StudioPieceRowsProps {
  /** Row order IS the layer order — the first row renders on top of the figure. */
  slots: StudioCanvasSlot[]
  /** Worn pieces keyed by canvas slot — the layer entry is a second top. */
  itemBySlot: Partial<Record<StudioCanvasSlot, StudioProductTrayItem | null>>
  hiddenSlots?: Partial<Record<StudioCanvasSlot, boolean>>
  isReadOnly?: boolean
  /** Tapping a row opens Alternates for it. Focus comes from the figure. */
  onOpenAlternates: (slot: StudioCanvasSlot) => void
  onRemove: (slot: StudioCanvasSlot) => void
  /** Move a row `delta` places up (negative) or down the layer stack. */
  onReorder?: (slot: StudioCanvasSlot, delta: number) => void
  highlight?: boolean
  className?: string
}

/** Row height (32) plus the flex gap (2) — one place in the stack. */
const ROW_STEP = 34

type Drag = { slot: StudioCanvasSlot; from: number; startY: number; dy: number }

/**
 * The worn pieces under the canvas.
 *
 * Their order is the z-order: the first row renders on top of the figure, so
 * dragging a row by its slot glyph restacks the garments. The row lifts and
 * follows the pointer; the rows it passes slide out of its way; the order
 * commits on release.
 */
export function StudioPieceRows({
  slots,
  itemBySlot,
  hiddenSlots = {},
  isReadOnly = false,
  onOpenAlternates,
  onRemove,
  onReorder,
  highlight = false,
  className,
}: StudioPieceRowsProps) {
  const [drag, setDrag] = useState<Drag | null>(null)
  // Mirrors `drag` for the pointer handlers, which must not read stale state.
  const dragRef = useRef<Drag | null>(null)

  const canDrag = Boolean(onReorder) && !isReadOnly

  /** Where the lifted row would land if released now. */
  const targetIndex = (d: Drag) =>
    Math.max(0, Math.min(slots.length - 1, d.from + Math.round(d.dy / ROW_STEP)))

  const start = (slot: StudioCanvasSlot, index: number) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!canDrag) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const next = { slot, from: index, startY: event.clientY, dy: 0 }
    dragRef.current = next
    setDrag(next)
  }

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d) return
    const next = { ...d, dy: event.clientY - d.startY }
    dragRef.current = next
    setDrag(next)
  }

  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDrag(null)
    if (!d || !onReorder) return
    const delta = targetIndex(d) - d.from
    if (delta !== 0) onReorder(d.slot, delta)
  }

  /** The lifted row follows the pointer; rows between it and its target make room. */
  const rowStyle = (index: number): CSSProperties | undefined => {
    if (!drag) return undefined
    if (index === drag.from) {
      return { transform: `translateY(${drag.dy}px) scale(1.02)`, transition: "none" }
    }
    const to = targetIndex(drag)
    const shift =
      drag.from < index && index <= to ? -ROW_STEP : to <= index && index < drag.from ? ROW_STEP : 0
    return { transform: `translateY(${shift}px)`, transition: "transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1)" }
  }

  return (
    <div className={cn("flex flex-col gap-0.5", highlight && "isolate z-[75]", className)}>
      {slots.map((slot, index) => {
        const item = hiddenSlots[slot] ? null : itemBySlot[slot] ?? null
        const lifted = drag?.slot === slot

        return (
          <SlotRow
            key={slot}
            slot={slot}
            label={item?.title ?? null}
            empty={!item}
            removable={!isReadOnly && Boolean(item)}
            alternatives
            style={rowStyle(index)}
            className={cn(lifted && "relative z-10 drop-shadow-md")}
            glyphProps={
              canDrag
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": `Drag to restack ${item?.title ?? slot}`,
                    onPointerDown: start(slot, index),
                    onPointerMove: move,
                    onPointerUp: end,
                    onPointerCancel: end,
                    onKeyDown: (event) => {
                      if (event.key === "ArrowUp") {
                        event.preventDefault()
                        onReorder?.(slot, -1)
                      }
                      if (event.key === "ArrowDown") {
                        event.preventDefault()
                        onReorder?.(slot, 1)
                      }
                    },
                    // A drag must not scroll the page underneath it.
                    style: { touchAction: "none" },
                    className: cn("cursor-grab", lifted && "cursor-grabbing"),
                  }
                : undefined
            }
            onSelect={() => onOpenAlternates(slot)}
            onRemove={isReadOnly ? undefined : () => onRemove(slot)}
            onOpenAlternatives={isReadOnly ? undefined : () => onOpenAlternates(slot)}
          />
        )
      })}
    </div>
  )
}
