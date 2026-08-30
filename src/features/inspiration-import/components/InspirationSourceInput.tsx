import { ImagePlus, Link2, Plus, ScanLine } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

type Props = {
  file: File | null
  isPending: boolean
  error: string | null
  onFile: (file: File) => void
  onSubmit: () => void
}

export function InspirationSourceInput({ file, isPending, error, onFile, onSubmit }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const nextUrl = URL.createObjectURL(file)
    setPreviewUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])

  const openFilePicker = () => inputRef.current?.click()

  return (
    <section className="mx-auto flex h-[calc(100dvh-4rem)] min-h-0 w-full max-w-2xl flex-col overflow-y-auto px-5 pb-4 pt-2 sm:px-8 sm:pb-7 sm:pt-3">
      <div className="text-center">
        <h1 className="font-display text-[30px] font-medium leading-none text-foreground sm:text-[38px]">
          Bring an inspiration
        </h1>
        <p className="mt-2 text-[12px] font-medium text-muted-foreground sm:text-sm">
          a screenshot, a saved pin, a photo — we find the pieces in it
        </p>
      </div>

      <button
        type="button"
        aria-label={file ? "Replace inspiration photo" : "Choose an inspiration photo"}
        aria-busy={isPending}
        className={`${file ? "bg-card" : "warp-weft bg-card"} group relative mt-5 flex h-[clamp(13rem,40dvh,26rem)] min-h-0 w-full shrink-0 items-center justify-center overflow-hidden rounded-[8px] border-2 border-dashed border-hairline-4 transition-colors hover:border-terracotta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta sm:mt-8`}
        onClick={openFilePicker}
        disabled={isPending}
      >
        {previewUrl ? (
          <img src={previewUrl} alt="Selected inspiration" className="size-full object-contain" />
        ) : (
          <span className="flex flex-col items-center px-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-full border border-hairline bg-background text-terracotta">
              <ImagePlus className="size-6" />
            </span>
            <span className="mt-5 font-display text-2xl text-foreground">Choose a photo</span>
            <span className="mt-2 text-xs leading-5 text-muted-foreground">JPEG, PNG or WebP · up to 10 MB</span>
          </span>
        )}
        {previewUrl ? (
          <span className="absolute bottom-3 right-3 rounded-frame bg-foreground/80 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            Replace photo
          </span>
        ) : null}
        {previewUrl && isPending ? (
          <span className="pointer-events-none absolute inset-0 bg-foreground/5">
            <span
              aria-hidden="true"
              className="inspiration-scan-line absolute inset-x-0 z-10 h-0.5 bg-gradient-to-r from-transparent via-terracotta to-transparent"
            />
            <span className="absolute inset-x-0 bottom-3 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-terracotta">
              Identifying pieces
            </span>
          </span>
        ) : null}
      </button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const nextFile = event.target.files?.[0]
          if (nextFile) onFile(nextFile)
          event.target.value = ""
        }}
      />

      {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}

      <div className="mt-3 flex items-center gap-4 sm:mt-5" aria-hidden="true">
        <span className="h-px flex-1 bg-hairline" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>

      <button
        type="button"
        disabled
        className="mt-3 flex min-h-12 w-full cursor-not-allowed items-center gap-3 rounded-[6px] border border-hairline bg-card px-4 text-left sm:mt-5 sm:min-h-14"
      >
        <Link2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">paste a link — pin, reel, article</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-terracotta/60">Add ›</span>
      </button>

      <div className="mt-auto pt-4 sm:pt-10">
        <Button
          className="h-14 w-full rounded-[4px] bg-terracotta text-base font-semibold text-white hover:bg-terracotta/90 sm:h-16"
          disabled={!file || isPending}
          onClick={onSubmit}
        >
          {isPending ? <ScanLine className="size-5 animate-pulse" /> : <Plus className="size-5" />}
          {isPending ? "Finding the pieces…" : "Find the pieces"}
        </Button>
      </div>
    </section>
  )
}
