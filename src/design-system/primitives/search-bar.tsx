import { useRef, type ChangeEvent, type KeyboardEvent } from "react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"

export interface SearchBarProps {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  /** The trailing ×. Clears the field; a transient bar also closes on it. */
  onClear: () => void
  onEscape?: () => void
  placeholder?: string
  autoFocus?: boolean
  /** Reference photo. It takes the camera's place; its own tiny × removes it. */
  thumbSrc?: string | null
  onClearThumb?: () => void
  /** Camera tap. Without it, `onPickImage` makes the bar open a file picker itself. */
  onOpenImagePicker?: () => void
  onPickImage?: (file: File) => void
  isUploading?: boolean
  onFocus?: () => void
  onBlur?: () => void
  className?: string
}

/**
 * The one 40h search field: camera · field · × · lens. Search's header and
 * Studio's open alternates bar are the same component, so they look identical.
 */
export function SearchBar({
  value,
  onValueChange,
  onSubmit,
  onClear,
  onEscape,
  placeholder = "search looks, tops, lowers, kicks",
  autoFocus = false,
  thumbSrc,
  onClearThumb,
  onOpenImagePicker,
  onPickImage,
  isUploading = false,
  onFocus,
  onBlur,
  className,
}: SearchBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasCamera = Boolean(onOpenImagePicker || onPickImage)

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onSubmit()
    }
    if (event.key === "Escape") onEscape?.()
  }
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onPickImage?.(file)
    event.target.value = ""
  }

  return (
    // No right padding: the lens at the end is a full 40px square, so it lands
    // on the same pixels as Studio's collapsed lens button.
    <div
      className={cn(
        "flex h-control-field w-full items-center gap-2 rounded-control border border-hairline bg-white pl-2",
        className,
      )}
    >
      {thumbSrc ? (
        <span className="relative h-6 w-6 shrink-0">
          <img src={thumbSrc} alt="Reference photo" className="h-6 w-6 rounded-[4px] object-cover" />
          <button
            type="button"
            aria-label="Remove photo"
            onClick={onClearThumb}
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-hairline bg-white text-ink"
          >
            <Icons.close className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden="true" />
          </button>
        </span>
      ) : hasCamera ? (
        <button
          type="button"
          aria-label="Search with a photo"
          onClick={onOpenImagePicker ?? (() => fileInputRef.current?.click())}
          disabled={isUploading}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] bg-ink text-background"
        >
          {isUploading ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background border-t-transparent" aria-hidden="true" />
          ) : (
            <Icons.camera className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      ) : null}

      <input
        type="search"
        autoFocus={autoFocus}
        enterKeyHint="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        aria-label="Search"
        className="min-w-0 flex-1 bg-transparent text-body-large text-ink outline-none placeholder:text-taupe [&::-webkit-search-cancel-button]:hidden"
      />

      <button
        type="button"
        aria-label="Clear search"
        onClick={onClear}
        className="flex h-8 w-8 shrink-0 items-center justify-center text-ink"
      >
        <Icons.close className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>

      <button
        type="button"
        aria-label="Search"
        onClick={onSubmit}
        className="flex h-control-field w-control-field shrink-0 items-center justify-center text-ink"
      >
        <Icons.search className="h-5 w-5" aria-hidden="true" />
      </button>

      {onPickImage ? (
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFile} />
      ) : null}
    </div>
  )
}
