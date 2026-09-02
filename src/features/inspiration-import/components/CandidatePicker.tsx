import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import type { InspirationCandidate } from "@/services/inspirationImport/types"

type Props = {
  sourceUrl: string
  candidates: InspirationCandidate[]
  selectedIds: string[]
  onSelect: (candidateId: string) => void
}

const CATEGORY_ORDER = { top: 0, bottom: 1 } as const

export function CandidatePicker({ sourceUrl, candidates, selectedIds, onSelect }: Props) {
  const selectedSet = new Set(selectedIds)
  const selectedCandidates = candidates
    .filter((candidate) => selectedSet.has(candidate.id))
    .sort((left, right) => CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category])

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-[8px] border border-hairline bg-card sm:w-full">
        <img
          src={sourceUrl}
          alt="Uploaded inspiration"
          className="block max-h-[calc(100dvh-21rem)] w-auto max-w-full sm:max-h-none sm:w-full"
        />
        {candidates.map((candidate, index) => {
          const active = selectedSet.has(candidate.id)
          const candidateName = candidate.label ?? candidate.category
          return (
            <button
              key={candidate.id}
              type="button"
              aria-label={`${active ? "Deselect" : "Select"} ${candidateName} ${index + 1}`}
              aria-pressed={active}
              onClick={() => onSelect(candidate.id)}
              className={cn(
                "absolute rounded-[6px] border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2",
                active
                  ? "border-terracotta bg-terracotta/10"
                  : "border-dashed border-[#aaa18e] bg-foreground/10 hover:border-terracotta",
              )}
              style={{
                left: `${candidate.bbox.l * 100}%`,
                top: `${candidate.bbox.t * 100}%`,
                width: `${candidate.bbox.w * 100}%`,
                height: `${candidate.bbox.h * 100}%`,
              }}
            >
              {active ? (
                <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-terracotta text-white shadow-sm">
                  <Check className="size-4" strokeWidth={2.5} />
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {selectedCandidates.length ? (
        <div className="grid grid-cols-2 gap-3" aria-label="Selected pieces">
          {selectedCandidates.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              aria-label={`Deselect ${candidate.label ?? candidate.category}`}
              onClick={() => onSelect(candidate.id)}
              className={cn(
                "relative min-w-0 bg-white p-1.5 pb-5 text-left shadow-[0_5px_14px_rgba(46,42,36,0.13)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta",
                index === 0 ? "-rotate-[0.6deg]" : "rotate-[0.6deg]",
              )}
            >
              <img
                src={candidate.retrievalCropUrl}
                alt={candidate.label ?? `Selected ${candidate.category}`}
                className="aspect-[16/9] w-full bg-[#ede5d4] object-contain sm:aspect-[4/3]"
              />
              <span className="absolute inset-x-2 bottom-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-foreground">
                  {candidate.label ?? candidate.category}
                </span>
                <span className="shrink-0 text-[8px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {candidate.category}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="py-3 text-center text-xs text-muted-foreground">
          Tap a box to select a top or bottom.
        </p>
      )}
    </div>
  )
}
