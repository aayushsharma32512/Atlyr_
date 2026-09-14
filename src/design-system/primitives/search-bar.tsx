import { useRef, type ChangeEvent, type KeyboardEvent } from "react"

import { Icons } from "@/design-system/icons"
import { useViewportZoomLockController } from "@/hooks/useViewportZoomLock"
import { cn } from "@/lib/utils"

import { Chip } from "./chip"

export type SearchBarMode = "idle" | "results"
export type SearchBarChip = "products" | "outfits"

export interface SearchBarProps {
  mode: SearchBarMode
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  /** The ink × that replaces the search button once text or a photo is in.
   *  Clears everything — query, photo and any filters (design: search bar · states). */
  onClear?: () => void
  placeholder?: string
  /** Results only: the Products · Outfits segment under the field. */
  chip?: SearchBarChip
  onChipChange?: (chip: SearchBarChip) => void
  /** Reference photo riding inside the field as a chip. */
  thumbSrc?: string | null
  /** Accepted for compatibility; V2 puts no × on the thumbnail. */
  onClearThumb?: () => void
  onPickImage?: (file: File) => void
  isUploading?: boolean
  onFindItems?: () => void
  onFocus?: () => void
  onBlur?: () => void
  className?: string
}

const ICON_BTN = "flex h-8 w-8 shrink-0 items-center justify-center text-ink disabled:opacity-40"
const BAR_ICON = "h-[18px] w-[18px]"

/** The 40h search field. It is the header on Search. */
export function SearchBar({
  mode,
  value,
  onValueChange,
  onSubmit,
  onClear,
  placeholder = "search looks, tops, lowers, kicks",
  chip,
  onChipChange,
  thumbSrc,
  onPickImage,
  isUploading = false,
  onFindItems,
  onFocus,
  onBlur,
  className,
}: SearchBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { lock, unlock } = useViewportZoomLockController()
  const results = mode === "results"
  // Anything in the field flips the right-hand button from search to clear.
  const hasContent = value.length > 0 || Boolean(thumbSrc)

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onSubmit()
    }
  }
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onPickImage?.(file)
    event.target.value = ""
  }

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <div className="flex h-control-field w-full items-center gap-1.5 rounded-control border border-hairline bg-white px-1">
        {/* Left slot: the camera, or the reference photo once one is in. The
            photo carries no × of its own — the ink × on the right clears it
            along with everything else (design: search bar · states). */}
        {thumbSrc ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center">
            <img src={thumbSrc} alt="Reference photo" className="h-6 w-6 rounded-badge object-cover" />
          </span>
        ) : onPickImage ? (
          <button
            type="button"
            aria-label="Search with a photo"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className={ICON_BTN}
          >
            {isUploading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" aria-hidden="true" />
            ) : (
              <Icons.camera className={BAR_ICON} aria-hidden="true" />
            )}
          </button>
        ) : null}

        <input
          type="search"
          enterKeyHint="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            lock()
            onFocus?.()
          }}
          onBlur={() => {
            unlock()
            onBlur?.()
          }}
          aria-label="Search"
          className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-taupe [&::-webkit-search-cancel-button]:hidden"
        />

        {/* Post-results, the globe (web search → import rack) sits left of the ×. */}
        {results && onFindItems ? (
          <button type="button" aria-label="Find items" onClick={onFindItems} className={ICON_BTN}>
            <Icons.findItems className={BAR_ICON} aria-hidden="true" />
          </button>
        ) : null}

        {hasContent && onClear ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={onClear}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-ink text-white"
          >
            <Icons.close className={BAR_ICON} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Search"
            onClick={onSubmit}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-ink text-white"
          >
            <Icons.search className={BAR_ICON} aria-hidden="true" />
          </button>
        )}

        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFile} />
      </div>

      {results && chip && onChipChange ? (
        <div role="tablist" aria-label="Result type" className="flex gap-1.5">
          <Chip label="Products" active={chip === "products"} onClick={() => onChipChange("products")} />
          <Chip label="Outfits" active={chip === "outfits"} onClick={() => onChipChange("outfits")} />
        </div>
      ) : null}
    </div>
  )
}
