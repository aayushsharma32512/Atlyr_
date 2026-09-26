import { useEffect, useRef, useState } from "react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"

export type InspirationIntent = "inspiration" | "wardrobe"

type Props = {
  file: File | null
  isPending: boolean
  error: string | null
  /** Which flow this is: the copy in the drop zone changes, nothing else. */
  intent?: InspirationIntent
  /** Lets one tap bring in a batch. The zone itself is unchanged. */
  multiple?: boolean
  onFile?: (file: File) => void
  /** Takes every chosen file; when set it is used in place of onFile. */
  onFiles?: (files: File[]) => void
}

const COPY: Record<InspirationIntent, { prompt: [string, string]; hint: string }> = {
  inspiration: {
    prompt: ["drop a look you liked", "and customise it for yourself"],
    hint: "screenshots · photos · saved posts",
  },
  wardrobe: {
    prompt: ["drop your favorite fit check photos", "and we will add those pieces"],
    hint: "",
  },
}

/**
 * V2 Import inspiration / Add to wardrobe: a full-height dashed drop zone.
 * A 48px white well with the image glyph, the prompt in the voice face, a
 * hint line. Once a photo is in, it fills the zone. The tray ("identify
 * items") belongs to the screen, so this is only the zone.
 */
export function InspirationSourceInput({
  file,
  isPending,
  error,
  intent = "inspiration",
  multiple = false,
  onFile,
  onFiles,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const copy = COPY[intent]

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const nextUrl = URL.createObjectURL(file)
    setPreviewUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
      <button
        type="button"
        aria-label={file ? "Replace photo" : "Choose a photo"}
        aria-busy={isPending}
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden rounded-control p-6 text-center",
          // 1px dashed ink, per the design — not the hairline colour, so the zone reads as an invitation.
          "border border-dashed border-charcoal bg-background",
          "disabled:cursor-wait",
        )}
      >
        {previewUrl ? (
          <img src={previewUrl} alt="Chosen photo" className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-control border border-hairline bg-white text-violet">
              <Icons.image className="h-[22px] w-[22px]" aria-hidden="true" />
            </span>
            <span className="font-voice text-body italic leading-snug text-charcoal">
              {copy.prompt[0]}
              <br />
              {copy.prompt[1]}
            </span>
            {copy.hint ? <span className="text-chip text-taupe">{copy.hint}</span> : null}
          </>
        )}
        {previewUrl && isPending ? (
          <span className="pointer-events-none absolute inset-0" aria-hidden="true">
            <span className="inspiration-scan-line absolute inset-x-0 z-10 h-0.5 bg-gradient-to-r from-transparent via-violet to-transparent" />
          </span>
        ) : null}
      </button>

      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        multiple={multiple}
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const nextFiles = [...(event.target.files ?? [])]
          if (nextFiles.length) {
            if (onFiles) onFiles(nextFiles)
            else onFile?.(nextFiles[0])
          }
          event.target.value = ""
        }}
      />

      {error ? (
        <p className="text-chip text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
