import { useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { InspirationCandidate, InspirationCategory } from "@/services/inspirationImport/types"

type Props = {
  sourceUrl: string
  candidates: InspirationCandidate[]
  selectedIds: string[]
  /** Inline error under the slots — "one top at a time". */
  error?: string | null
  /** Optional line above the slots, e.g. a count of what was detected. */
  heading?: string
  onSelect: (candidateId: string) => void
}

const SLOT_LABEL: Record<InspirationCategory, string> = { top: "tops", bottom: "lowers" }
const SLOTS: InspirationCategory[] = ["top", "bottom"]

/** The source photo clipped to a detection box, so the slot shows the real crop, not the background-removed cutout. */
export function SourceCrop({ sourceUrl, bbox, alt }: { sourceUrl: string; bbox: InspirationCandidate["bbox"]; alt: string }) {
  const [imageRatio, setImageRatio] = useState(1)
  const aspect = (bbox.w * imageRatio) / bbox.h
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ containerType: "size" }}>
      <div className="relative overflow-hidden" style={{ aspectRatio: aspect, height: `min(100%, calc(100cqw / ${aspect}))` }}>
        <img
          src={sourceUrl}
          alt={alt}
          onLoad={(event) => setImageRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
          className="absolute max-w-none"
          style={{
            width: `${100 / bbox.w}%`,
            height: `${100 / bbox.h}%`,
            left: `${(-bbox.l / bbox.w) * 100}%`,
            top: `${(-bbox.t / bbox.h) * 100}%`,
          }}
        />
      </div>
    </div>
  )
}

/**
 * V2 Find items · Pieces: the source photo with 1px detection boxes — dashed
 * ink at rest, solid violet once picked — and a 192px row of two slots under
 * it, tops and lowers, each labelled inside its box. A filled slot shows the
 * crop with a hairline; no tick, no fill. No shoes detection.
 */
export function CandidatePicker({ sourceUrl, candidates, selectedIds, error, heading, onSelect }: Props) {
  const selectedSet = new Set(selectedIds)
  const frameRef = useRef<HTMLDivElement>(null)
  const [imageRatio, setImageRatio] = useState<number | null>(null)
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null)

  // The boxes are percentages of the wrapper, so the wrapper must be exactly the photo's
  // fitted size; a percentage max-height on the image alone resolves to nothing here.
  useLayoutEffect(() => {
    const node = frameRef.current
    if (!node || typeof ResizeObserver === "undefined") return
    const measure = () => {
      const { width, height } = node.getBoundingClientRect()
      if (width > 0 && height > 0) setFrame({ width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const fitStyle = imageRatio && frame
    ? frame.width / frame.height > imageRatio
      ? { height: frame.height, width: frame.height * imageRatio }
      : { width: frame.width, height: frame.width / imageRatio }
    : { maxWidth: "100%", maxHeight: "100%" }
  const pickFor = (category: InspirationCategory) =>
    candidates.find((candidate) => selectedSet.has(candidate.id) && candidate.category === category) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Photo on the ground, 8px radius; detections ride on it. */}
      <div className="relative min-h-0 flex-1 px-4 py-3">
        <div ref={frameRef} className="relative flex h-full items-center justify-center overflow-hidden rounded-control">
          <div className="relative" style={fitStyle}>
            <img
              src={sourceUrl}
              alt="Your inspiration"
              className="block h-full w-full"
              onLoad={(event) => setImageRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
            />
            {candidates.map((candidate, index) => {
              const active = selectedSet.has(candidate.id)
              const name = candidate.label ?? SLOT_LABEL[candidate.category]
              return (
                <button
                  key={candidate.id}
                  type="button"
                  aria-label={`${active ? "Deselect" : "Select"} ${name} ${index + 1}`}
                  aria-pressed={active}
                  onClick={() => onSelect(candidate.id)}
                  className={cn(
                    "absolute rounded-chip border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet",
                    active ? "z-10 border-violet" : "border-dashed border-charcoal",
                  )}
                  style={{
                    left: `${candidate.bbox.l * 100}%`,
                    top: `${candidate.bbox.t * 100}%`,
                    width: `${candidate.bbox.w * 100}%`,
                    height: `${candidate.bbox.h * 100}%`,
                  }}
                >
                  <span
                    className={cn(
                      "absolute left-1 top-1 rounded-badge px-1 py-0.5 text-[9px] font-medium leading-none",
                      active ? "bg-violet text-white" : "bg-white/90 text-ink",
                    )}
                  >
                    {SLOT_LABEL[candidate.category]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {heading ? (
        <p className="flex-none border-t border-hairline px-4 pt-3 text-body font-medium text-ink">{heading}</p>
      ) : null}

      {/* The two slots. Tapping a filled slot clears it. */}
      <div
        className={cn(
          "grid h-[192px] flex-none grid-cols-2 gap-3 px-4 py-3",
          heading ? undefined : "border-t border-hairline",
        )}
      >
        {SLOTS.map((category) => {
          const pick = pickFor(category)
          return (
            <button
              key={category}
              type="button"
              disabled={!pick}
              onClick={pick ? () => onSelect(pick.id) : undefined}
              aria-label={pick ? `Clear ${SLOT_LABEL[category]}` : `${SLOT_LABEL[category]} — empty`}
              className="flex min-h-0 flex-col overflow-hidden rounded-chip border border-hairline bg-background disabled:cursor-default"
            >
              <span className="flex-none px-2 pt-1.5 text-left text-chip text-taupe">{SLOT_LABEL[category]}</span>
              <div className="flex min-h-0 flex-1 items-center justify-center">
                {pick ? (
                  <SourceCrop sourceUrl={sourceUrl} bbox={pick.bbox} alt={pick.label ?? SLOT_LABEL[category]} />
                ) : null}
              </div>
            </button>
          )
        })}
      </div>

      {error ? (
        <p className="px-4 pb-2 text-chip text-destructive" role="alert" aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  )
}
