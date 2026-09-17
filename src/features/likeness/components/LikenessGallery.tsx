import { Maximize2, Plus, Sparkles, X } from "lucide-react"

import type { LikenessPose } from "@/services/likeness/likenessService"
import { cn } from "@/lib/utils"
import { poseDate, poseLabel } from "./StepThreeForm"

/**
 * The gallery behind "all poses": every generated likeness in one place, one
 * of them sealed ACTIVE. A manager, not a picker — StepThreeForm answers
 * "which one for this try-on"; this answers "what do I have, and what is my
 * default", with delete and the daily generation meter.
 */

export interface LikenessGalleryProps {
  poses: LikenessPose[]
  onSetActive: (poseId: string) => void
  onDelete?: (poseId: string) => void
  onGenerateNew: () => void
  /** From checkLikenessLimit — rendered inline under "Generate new pose". */
  remainingToday?: number | null
  isBusy?: boolean
  className?: string
}

function PoseImage({ url, className }: { url: string | null; className?: string }) {
  return (
    <span className={cn("flex items-center justify-center overflow-hidden bg-muted/30", className)}>
      {url ? (
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">render</span>
      )}
    </span>
  )
}

function ActiveSeal() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-tint px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-violet">
      <Sparkles className="size-3" aria-hidden="true" />
      Active
    </span>
  )
}

function FullViewLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open full view"
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 hover:text-foreground"
    >
      <Maximize2 className="size-4" aria-hidden="true" />
    </a>
  )
}

export function LikenessGallery({
  poses,
  onSetActive,
  onDelete,
  onGenerateNew,
  remainingToday = null,
  isBusy = false,
  className,
}: LikenessGalleryProps) {
  const active = poses.find((pose) => pose.isActive) ?? null
  const others = poses.filter((pose) => pose.id !== active?.id)
  const canGenerate = remainingToday === null || remainingToday > 0
  const meter = remainingToday !== null ? `${remainingToday} left today` : null

  // With a single pose the two-column grid holds one dashed tile and looks
  // broken, so the lone active pose becomes a tall portrait with generate as a
  // full-width row under it.
  const isSolo = Boolean(active) && others.length === 0

  return (
    <div className={cn("flex flex-col", className)}>
      {active && isSolo ? (
        <section className="overflow-hidden rounded-lg border border-hairline bg-white shadow-xs">
          <div className="relative">
            <PoseImage url={active.imageUrl} className="aspect-[3/4] w-full" />
            <span className="absolute left-3 top-3">
              <ActiveSeal />
            </span>
            {active.imageUrl ? (
              <span className="absolute right-2 top-2 rounded-full bg-white/90 shadow-xs">
                <FullViewLink url={active.imageUrl} />
              </span>
            ) : null}
          </div>
          <div className="flex items-baseline gap-3 border-t border-hairline px-4 py-3">
            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
              {poseLabel(active)}
            </p>
            <p className="shrink-0 text-sm text-muted-foreground">made {poseDate(active.createdAt)}</p>
          </div>
        </section>
      ) : active ? (
        <section className="flex items-center gap-4 rounded-lg border border-hairline bg-white p-4 shadow-xs">
          <PoseImage
            url={active.imageUrl}
            className="h-28 w-[84px] shrink-0 rounded-md border border-hairline"
          />
          <div className="min-w-0 flex-1">
            <ActiveSeal />
            <p className="mt-2 truncate text-[15px] font-semibold text-foreground">{poseLabel(active)}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">made {poseDate(active.createdAt)}</p>
          </div>
          {active.imageUrl ? <FullViewLink url={active.imageUrl} /> : null}
        </section>
      ) : (
        <section className="flex flex-col items-center rounded-lg border border-dashed border-hairline-3 px-6 py-12 text-center">
          <p className="text-[15px] font-semibold text-foreground">No likeness yet</p>
          <p className="mt-1.5 max-w-[260px] text-sm leading-5 text-muted-foreground">
            Generate one and it becomes your default for every try-on.
          </p>
        </section>
      )}

      {isSolo ? (
        <button
          type="button"
          onClick={onGenerateNew}
          disabled={isBusy || !canGenerate}
          className="mt-4 flex min-h-16 items-center gap-4 rounded-lg border border-dashed border-hairline-3 px-4 text-left transition-colors hover:border-violet disabled:opacity-40"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-tint text-violet">
            <Plus className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-foreground">Generate another pose</span>
            {meter ? <span className="block text-sm text-muted-foreground">{meter}</span> : null}
          </span>
        </button>
      ) : (
        <>
          <p className="mb-3 mt-7 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {others.length > 0 ? "Other poses · tap to set active" : "More poses"}
          </p>

          <div className="grid grid-cols-2 gap-3">
            {others.map((pose) => (
              <div key={pose.id} className="relative">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => onSetActive(pose.id)}
                  title="Set as active"
                  className="flex w-full flex-col overflow-hidden rounded-lg border border-hairline bg-white text-left shadow-xs transition-colors hover:border-violet disabled:opacity-60"
                >
                  <PoseImage url={pose.imageUrl} className="aspect-[3/4] w-full" />
                  <span className="flex items-baseline gap-2 border-t border-hairline px-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {poseLabel(pose)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{poseDate(pose.createdAt)}</span>
                  </span>
                </button>

                {/* Outside the set-active button: a ✕ nested inside it would be
                    invalid HTML and the tap would activate the pose it deletes. */}
                {onDelete ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onDelete(pose.id)}
                    aria-label="Delete this pose"
                    className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-white/90 text-muted-foreground shadow-xs hover:text-foreground disabled:opacity-50"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ))}

            <button
              type="button"
              onClick={onGenerateNew}
              disabled={isBusy || !canGenerate}
              className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-hairline-3 px-4 text-center transition-colors hover:border-violet disabled:opacity-40"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-violet-tint text-violet">
                <Plus className="size-5" aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold text-foreground">Generate new pose</span>
              {meter ? <span className="text-xs text-muted-foreground">{meter}</span> : null}
            </button>
          </div>
        </>
      )}

    </div>
  )
}
