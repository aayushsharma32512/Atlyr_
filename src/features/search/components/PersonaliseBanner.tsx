import { Icons } from "@/design-system/icons"

interface PersonaliseBannerProps {
  onClick: () => void
}

/**
 * "personalise any inspiration" → Import inspiration. The chosen exploration
 * (1e in the V2 frames): no card, hairlines above and below, a violet icon
 * well, the title in the voice face. Sits after the curations, above For You.
 */
export function PersonaliseBanner({ onClick }: PersonaliseBannerProps) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 border-y border-hairline py-3 text-left">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-violet text-white">
        <Icons.studio className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-voice text-body italic text-charcoal">personalise any inspiration</span>
        <span className="text-chip text-ink-body">found something interesting? make it your own</span>
      </span>
      <Icons.carouselNext className="h-4 w-4 shrink-0 text-ink" aria-hidden="true" />
    </button>
  )
}
