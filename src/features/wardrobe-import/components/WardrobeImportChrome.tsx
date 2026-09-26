import { Icons } from "@/design-system/icons"

export const WARDROBE_PRIMARY =
  "flex h-11 flex-1 items-center justify-center gap-2 rounded-control bg-primary text-card font-medium text-primary-foreground disabled:opacity-40"
export const WARDROBE_SECONDARY =
  "flex h-11 flex-1 items-center justify-center gap-2 rounded-control border border-hairline bg-white text-card font-medium text-ink disabled:opacity-40"
export const WARDROBE_TOGGLE =
  "inline-flex h-7 flex-none items-center gap-1 rounded-control border border-hairline bg-white px-2.5 text-chip font-medium text-ink disabled:opacity-50"

/** The 52px header row every stage shares: back, the stage's name, a meta line on the right. */
export function WardrobeImportHeader({
  title,
  meta,
  onBack,
}: {
  title: string
  meta?: string
  onBack: () => void
}) {
  return (
    <header className="flex h-control-header-title flex-none items-center gap-1 border-b border-hairline pl-2 pr-4">
      <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        className="flex h-9 w-9 flex-none items-center justify-center text-ink"
      >
        <Icons.carouselPrev className="h-5 w-5" aria-hidden="true" />
      </button>
      <h1 className="min-w-0 flex-1 truncate font-display text-title font-medium text-ink">{title}</h1>
      {meta ? <span className="flex-none text-chip tabular-nums text-taupe">{meta}</span> : null}
    </header>
  )
}
