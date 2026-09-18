import { useEffect, useRef, useState } from "react"

import { Icons } from "@/design-system/icons"
import { SearchBar } from "@/design-system/primitives"
import { useKeyboardInset } from "@/design-system/utils/useKeyboardInset"
import { cn } from "@/lib/utils"

/** Both states hang this far off their container's bottom edge. */
const RESTING_GAP = 8

/**
 * Collapsed: a 40x40 lens in the rack's bottom-right corner.
 *
 * Open state lives on the screen, not here, because the two states belong to
 * different boxes — the button sits inside the rack column, the open bar spans
 * the whole frame (artboard: `left:8 right:8`, 8px above the keyboard).
 */
export function AlternatesSearchButton({
  onOpen,
  isReadOnly = false,
  className,
}: {
  onOpen: () => void
  isReadOnly?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label="Search this slot"
      aria-expanded={false}
      disabled={isReadOnly}
      onClick={onOpen}
      className={cn(
        // Floats over the tiles; the rack pads its bottom so the last row scrolls clear.
        "absolute bottom-2 right-2 flex h-control-field w-control-field items-center justify-center",
        "rounded-control border border-hairline bg-white text-ink",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      <Icons.search className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}

export interface AlternatesSearchBarProps {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  /** The trailing x, Escape, and a submit all dismiss the bar. */
  onClose: () => void
  onClear?: () => void
  placeholder?: string
  /** Reference photo riding in the field. */
  thumbSrc?: string | null
  onClearThumb?: () => void
  /** Opens the reference-image dialog. */
  onOpenImagePicker?: () => void
  className?: string
}

/**
 * The open bar: the shared `SearchBar`, full frame width, resting exactly
 * where the lens button was.
 *
 * It only moves when a keyboard would cover it, and then only by the overlap.
 *
 * Blur does not dismiss, though the brief lists it: the reference-image dialog
 * opens from this bar and takes focus, and the picked photo has to land back in
 * the field as a chip. Closing on blur would tear the bar away mid-flow.
 */
export function AlternatesSearchBar({
  value,
  onValueChange,
  onSubmit,
  onClose,
  onClear,
  placeholder = "",
  thumbSrc,
  onClearThumb,
  onOpenImagePicker,
  className,
}: AlternatesSearchBarProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const keyboardInset = useKeyboardInset()
  /** How far to lift off the resting spot so the keyboard does not cover it. */
  const [lift, setLift] = useState(0)

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setLift((prev) => {
      // Undo the lift already applied, so this measures the resting spot.
      const gapBelow = window.innerHeight - (rect.bottom + prev)
      return Math.max(0, Math.round(keyboardInset + RESTING_GAP - gapBelow))
    })
  }, [keyboardInset])

  return (
    <div
      ref={barRef}
      className={cn("absolute inset-x-2 z-[7]", className)}
      style={{ bottom: RESTING_GAP, transform: lift ? `translateY(${-lift}px)` : undefined }}
    >
      <SearchBar
        autoFocus
        value={value}
        placeholder={placeholder}
        onValueChange={onValueChange}
        onSubmit={() => {
          onSubmit()
          onClose()
        }}
        // Always closes, even with an empty field: the lens hides while the bar
        // is open, so this is the only way out. A committed search is cleared
        // from the query line instead.
        onClear={() => {
          onClear?.()
          onClose()
        }}
        onEscape={onClose}
        thumbSrc={thumbSrc}
        onClearThumb={onClearThumb}
        onOpenImagePicker={onOpenImagePicker}
      />
    </div>
  )
}
