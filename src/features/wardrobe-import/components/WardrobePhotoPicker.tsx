import { useRef, useState } from "react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"
import type { WardrobePhoto } from "@/features/wardrobe-import/types"

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_BYTES = 10 * 1024 * 1024

type Props = {
  photos: WardrobePhoto[]
  onAddFiles: (files: File[]) => void
  onRemove: (photoId: string) => void
}

/**
 * Add to wardrobe: one dashed zone that holds the invitation, the chosen photos
 * and the count. Tapping anywhere in it opens the picker again for more.
 */
export function WardrobePhotoPicker({ photos, onAddFiles, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const openPicker = () => inputRef.current?.click()

  const handleFiles = (files: File[]) => {
    const accepted = files.filter((file) => ACCEPTED_TYPES.has(file.type) && file.size <= MAX_BYTES)
    setError(accepted.length === files.length
      ? null
      : "Skipped some photos — use JPEG, PNG or WebP under 10 MB.")
    if (accepted.length) onAddFiles(accepted)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose photos"
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            openPicker()
          }
        }}
        className={cn(
          "flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto rounded-control p-4 text-center",
          "border border-dashed border-charcoal bg-background",
        )}
      >
        <div className="flex flex-none flex-col items-center gap-3 pt-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-control border border-hairline bg-white text-violet">
            <Icons.image className="h-[22px] w-[22px]" aria-hidden="true" />
          </span>
          <span className="font-display text-title font-medium text-ink">drop your fit checks here</span>
          <span className="text-body text-taupe">we’ll find the pieces for you</span>
        </div>

        {photos.length ? (
          <>
            <div className="grid w-full flex-none grid-cols-3 gap-3 pt-2">
              {photos.map((photo) => (
                <div key={photo.id} className="relative aspect-[3/4] overflow-hidden rounded-chip bg-editorial">
                  {photo.previewUrl ? (
                    <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemove(photo.id)
                    }}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-ink shadow-sm"
                  >
                    <Icons.close className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <span className="flex-none pb-2 text-chip text-taupe">
              {photos.length} photo{photos.length === 1 ? "" : "s"} selected
            </span>
          </>
        ) : null}
      </div>

      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          handleFiles([...(event.target.files ?? [])])
          event.target.value = ""
        }}
      />

      {error ? (
        <p className="flex-none text-chip text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
