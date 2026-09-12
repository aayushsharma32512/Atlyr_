import { useEffect, useState, type KeyboardEvent } from "react"

import { Icons } from "@/design-system/icons"
import { useViewportZoomLockController } from "@/hooks/useViewportZoomLock"
import { cn } from "@/lib/utils"

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
        "absolute bottom-2 right-2 z-[4] flex h-control-field w-control-field items-center justify-center",
        "rounded-control border border-hairline bg-card/75 text-ink backdrop-blur-[6px]",
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
  onFilter?: () => void
  className?: string
}

/**
 * The open bar: full frame width, riding above the keyboard.
 *
 * iOS Safari does not move `position: fixed` elements with the keyboard, so the
 * offset comes from `visualViewport` rather than `bottom: 0` (brief §2.6).
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
  onFilter,
  className,
}: AlternatesSearchBarProps) {
  const [keyboardInset, setKeyboardInset] = useState(0)
  const { lock, unlock } = useViewportZoomLockController()

  useEffect(() => {
    if (typeof window === "undefined") return
    const viewport = window.visualViewport
    if (!viewport) return

    const sync = () => {
      // How much of the layout viewport the keyboard is covering.
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      setKeyboardInset(Math.max(0, Math.round(covered)))
    }
    sync()
    viewport.addEventListener("resize", sync)
    viewport.addEventListener("scroll", sync)
    return () => {
      viewport.removeEventListener("resize", sync)
      viewport.removeEventListener("scroll", sync)
    }
  }, [])

  const close = () => {
    unlock()
    onClose()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onSubmit()
      close()
    }
    if (event.key === "Escape") {
      close()
    }
  }

  return (
    <div className={cn("absolute inset-x-2 z-[7]", className)} style={{ bottom: keyboardInset + 8 }}>
      <div className="flex h-control-field w-full items-center gap-1.5 rounded-control border border-hairline bg-card px-1">
        {onFilter ? (
          <button
            type="button"
            aria-label="Filters"
            onClick={onFilter}
            className="flex h-8 w-8 shrink-0 items-center justify-center text-ink"
          >
            <Icons.filter className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        ) : null}

        {thumbSrc ? (
          <span className="inline-flex h-control-chip shrink-0 items-center gap-1.5 rounded-control border border-hairline bg-background pl-0.5 pr-1.5">
            <img src={thumbSrc} alt="Reference" className="h-5 w-5 rounded-badge object-cover" />
            <button
              type="button"
              aria-label="Remove photo"
              onClick={onClearThumb}
              className="flex h-4 w-4 items-center justify-center text-ink"
            >
              <Icons.close className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        ) : null}

        <input
          type="search"
          autoFocus
          enterKeyHint="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={lock}
          onBlur={unlock}
          aria-label="Search this slot"
          className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-taupe [&::-webkit-search-cancel-button]:hidden"
        />

        {/* Brief §7: "x at the right closes". Always present — with an empty
            field there was otherwise no way out, since the lens hides while the
            bar is open. Clearing a committed search is the query line's job. */}
        <button
          type="button"
          aria-label="Close search"
          onClick={() => {
            onClear?.()
            close()
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center text-ink"
        >
          <Icons.close className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label="Import an image"
          onClick={onOpenImagePicker}
          className="flex h-8 w-8 shrink-0 items-center justify-center text-ink"
        >
          <Icons.camera className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label="Search"
          onClick={() => {
            onSubmit()
            close()
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-ink text-background"
        >
          <Icons.search className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
