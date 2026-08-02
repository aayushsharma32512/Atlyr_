import { Maximize2, Plus, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { LikenessPose } from "@/services/likeness/likenessService"
import { cn } from "@/lib/utils"
import { poseDate, poseLabel } from "./StepThreeForm"

/**
 * Canvas 6o2 — the gallery behind "all poses". Every generated likeness in one
 * place, exactly one of them gold-sealed ACTIVE.
 *
 * Not a variant of StepThreeForm. That component answers "which one for this
 * try-on" — a picker, transient, always ending in a Try on. This answers "what
 * do I have, and what is my default" — a manager, with delete and a daily
 * generation meter. Folding both into one component meant every future change
 * to either had to be reasoned about twice.
 *
 * Runs entirely on existing edge functions: likeness-list / -select /
 * -set-active / -delete, plus checkLikenessLimit for the meter.
 */

export interface LikenessGalleryProps {
  poses: LikenessPose[]
  onSetActive: (poseId: string) => void
  onDelete?: (poseId: string) => void
  onGenerateNew: () => void
  onTryOn?: (poseId: string) => void
  /** From checkLikenessLimit — rendered inline under "Generate new pose". */
  remainingToday?: number | null
  dailyLimit?: number | null
  isBusy?: boolean
  className?: string
}

export function LikenessGallery({
  poses,
  onSetActive,
  onDelete,
  onGenerateNew,
  onTryOn,
  remainingToday = null,
  dailyLimit = null,
  isBusy = false,
  className,
}: LikenessGalleryProps) {
  const active = poses.find((pose) => pose.isActive) ?? null
  const others = poses.filter((pose) => pose.id !== active?.id)
  const canGenerate = remainingToday === null || remainingToday > 0

  return (
    // The likeness screens are the app's one dark register — see StepTwoForm.
    <div className={cn("flex min-h-0 flex-1 flex-col bg-ink-deepest", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {active ? (
          <section className="rounded-[6px] border border-gold bg-ink-deep p-2.5">
            <div className="flex gap-3">
              <div className="relative h-[74px] w-[74px] shrink-0 overflow-hidden rounded-[4px] bg-ink">
                {active.imageUrl ? (
                  <img src={active.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[7px] uppercase tracking-[0.1em] text-on-ink-3">
                    render
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-1 text-[7.5px] font-bold uppercase tracking-[0.16em] text-gold">
                  <Sparkles className="size-2.5" aria-hidden="true" />
                  Active
                </span>
                <p className="mt-1.5 truncate text-[12px] font-semibold text-on-ink-1">
                  {poseLabel(active)}
                </p>
                <p className="mt-0.5 text-[8.5px] text-on-ink-3">
                  made {poseDate(active.createdAt)}
                </p>
              </div>

              {active.imageUrl ? (
                <a
                  href={active.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open full view"
                  className="h-fit shrink-0 rounded-[3px] p-1 text-on-ink-2 hover:text-on-ink-1"
                >
                  <Maximize2 className="size-3" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="rounded-[6px] border border-dashed border-ink-line bg-ink-deep/60 px-4 py-6 text-center">
            <p className="text-[10px] font-semibold text-on-ink-1">No likeness yet</p>
            <p className="mt-1 text-[8.5px] text-on-ink-3">
              Generate one and it becomes your default for every try-on.
            </p>
          </section>
        )}

        <p className="mb-2 mt-4 text-[7.5px] font-bold uppercase tracking-[0.16em] text-on-ink-3">
          {others.length > 0 ? "Other poses · tap to set active" : "More poses"}
        </p>

        <div className="grid grid-cols-2 gap-2">
          {others.map((pose) => (
            <div key={pose.id} className="relative">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onSetActive(pose.id)}
                title="Set as active"
                className="flex w-full flex-col overflow-hidden rounded-[5px] border border-ink-line bg-ink-deep text-left transition-colors hover:border-on-ink-3 disabled:opacity-60"
              >
                <span className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden bg-ink">
                  {pose.imageUrl ? (
                    <img src={pose.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[7px] uppercase tracking-[0.1em] text-on-ink-3">render</span>
                  )}
                </span>
                <span className="flex items-baseline gap-1.5 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[8.5px] font-medium text-on-ink-2">
                    {poseLabel(pose)}
                  </span>
                  <span className="shrink-0 text-[7.5px] text-on-ink-3">{poseDate(pose.createdAt)}</span>
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
                  className="absolute right-1 top-1 rounded-[2px] bg-ink-deepest/75 p-1 text-on-ink-2 hover:text-on-ink-1 disabled:opacity-50"
                >
                  <X className="size-2.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}

          <button
            type="button"
            onClick={onGenerateNew}
            disabled={isBusy || !canGenerate}
            className={cn(
              "flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-[5px] border border-dashed",
              "border-ink-line text-on-ink-3 transition-colors hover:border-on-ink-3 disabled:opacity-40",
            )}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span className="text-[9px] font-medium text-on-ink-2">Generate new pose</span>
            {remainingToday !== null ? (
              <span className="text-[7.5px]">
                {remainingToday} of {dailyLimit ?? remainingToday} left today
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {onTryOn ? (
        <div className="shrink-0 px-4 pb-5 pt-2">
          <Button
            type="button"
            onClick={() => active && onTryOn(active.id)}
            disabled={!active || isBusy}
            className="flex h-11 w-full items-center justify-center rounded-[3px] bg-primary px-4 shadow-sm hover:bg-primary/90"
          >
            <span className="text-[12px] font-bold text-primary-foreground">
              Try on with active pose →
            </span>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
