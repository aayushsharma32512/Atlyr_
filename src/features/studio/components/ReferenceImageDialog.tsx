import { useEffect, useRef, useState } from "react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"

export interface ReferenceImageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The worn piece's thumbnail — the "keep current piece" option. */
  wornImageUrl?: string | null
  /** A photo already attached, so re-opening shows it selected. */
  attachedImageUrl?: string | null
  isUploading?: boolean
  onPickFile: (file: File) => void
  onApply: (imageUrl: string | null) => void
}

/** Keep the current piece, or replace it with a photo. Apply commits. */
export function ReferenceImageDialog({
  open,
  onOpenChange,
  wornImageUrl,
  attachedImageUrl,
  isUploading = false,
  onPickFile,
  onApply,
}: ReferenceImageDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [choice, setChoice] = useState<"worn" | "photo">(attachedImageUrl ? "photo" : "worn")

  useEffect(() => {
    if (open) {
      setChoice(attachedImageUrl ? "photo" : "worn")
    }
  }, [attachedImageUrl, open])

  // A freshly uploaded photo becomes the selection.
  useEffect(() => {
    if (attachedImageUrl) {
      setChoice("photo")
    }
  }, [attachedImageUrl])

  if (!open) {
    return null
  }

  const tile = "box-border flex flex-1 flex-col overflow-hidden rounded-lg"
  const selected = "border-2 border-ink"

  return (
    <div className="absolute inset-0 z-40">
      <button
        type="button"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-ink/50"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reference image"
        className={cn(
          "absolute left-8 right-8 top-1/2 z-50 flex -translate-y-1/2 flex-col gap-2",
          "rounded-frame border border-hairline bg-background p-3 shadow-lg",
        )}
      >
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Use the piece you're wearing"
            aria-pressed={choice === "worn"}
            onClick={() => setChoice("worn")}
            className={cn(tile, "bg-card", choice === "worn" ? selected : "border border-hairline")}
          >
            <span className="relative block aspect-square w-full overflow-hidden bg-muted">
              {wornImageUrl ? (
                <img src={wornImageUrl} alt="" className="h-full w-full object-contain p-2" />
              ) : null}
            </span>
          </button>

          <button
            type="button"
            aria-label="Add a photo"
            aria-pressed={choice === "photo"}
            disabled={isUploading}
            onClick={() => {
              if (attachedImageUrl) {
                setChoice("photo")
                return
              }
              fileInputRef.current?.click()
            }}
            className={cn(
              tile,
              "items-center justify-center bg-card/45",
              choice === "photo" && attachedImageUrl ? selected : "border border-dashed border-hairline-dashed",
            )}
          >
            {attachedImageUrl ? (
              <span className="relative block aspect-square w-full overflow-hidden bg-muted">
                <img src={attachedImageUrl} alt="" className="h-full w-full object-contain p-2" />
              </span>
            ) : (
              <span className="flex aspect-square w-full items-center justify-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-control border border-hairline bg-card text-ink">
                  {isUploading ? (
                    <span
                      className="h-5 w-5 animate-spin rounded-full border-2 border-ink border-t-transparent"
                      aria-hidden="true"
                    />
                  ) : (
                    <Icons.camera className="h-5 w-5" aria-hidden="true" />
                  )}
                </span>
              </span>
            )}
          </button>
        </div>

        <button
          type="button"
          disabled={isUploading || (choice === "photo" && !attachedImageUrl)}
          onClick={() => {
            onApply(choice === "photo" ? attachedImageUrl ?? null : wornImageUrl ?? null)
            onOpenChange(false)
          }}
          className={cn(
            "box-border flex h-control-primary w-full items-center justify-center rounded-control",
            "bg-terracotta text-label font-semibold text-background",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          Apply
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onPickFile(file)
            event.target.value = ""
          }}
        />
      </div>
    </div>
  )
}
