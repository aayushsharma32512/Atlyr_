import { useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from "react"
import { UseFormReturn } from "react-hook-form"
import { Check, Maximize2, RotateCcw, Share, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CardHeader, CardFooter } from "@/components/ui/card"
import { Form } from "@/components/ui/form"
import { IconButton } from "@/design-system/primitives"
import type { LikenessFormData } from "../types"

interface CandidateCard {
  index: number
  candidateId: string
  path: string
  signedUrl: string | null
  summary?: string | null
}

type StepTwoViewMode = "grid" | "scroll"

interface StepTwoFormProps {
  type?: 'drawer' | 'screen'
  form: UseFormReturn<LikenessFormData>
  candidates: CandidateCard[]
  onSave: (candidateId: string) => void
  onPrevious?: () => void
  isSaving?: boolean
  viewMode?: StepTwoViewMode
  showBack?: boolean
  /** 6o: "9 left today" — the daily meter sits where the regenerate tempts. */
  remainingToday?: number | null
  /** 6o: ⟲ Regenerate both. Falls back to onPrevious, which is the same journey. */
  onRegenerate?: () => void
  /** 6o: "all poses ›" — through to the 6o2 gallery. */
  onAllPoses?: () => void
}

/** A / B / C … — "Candidate A" reads as a choice; "generation #1" reads as a log line. */
const candidateLetter = (index: number) => String.fromCharCode(65 + Math.max(0, index))

export function StepTwoForm({
  type = 'screen',
  form,
  candidates,
  onSave,
  onPrevious,
  isSaving = false,
  viewMode = "scroll",
  showBack = true,
  remainingToday = null,
  onRegenerate,
  onAllPoses,
}: StepTwoFormProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(() => candidates[0]?.index ?? 0)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const isDrawer = type === 'drawer'

  const canContinue = useMemo(() => candidates.length > 0 && typeof selectedIndex === "number", [candidates, selectedIndex])

  const handleSave = () => {
    if (!canContinue) return
    const selectedCandidate = candidates.find(c => c.index === selectedIndex)
    if (selectedCandidate) {
      onSave(selectedCandidate.candidateId)
    }
  }

  const openPreviewAt = (index: number) => {
    if (!candidates.length) return
    setSelectedIndex(index)
    setIsPreviewOpen(true)
  }

  return (
    <Form {...form}>
      {isPreviewOpen ? (
        <LikenessPreviewOverlay
          items={candidates}
          activeIndex={Math.max(0, Math.min(selectedIndex, candidates.length - 1))}
          onClose={() => setIsPreviewOpen(false)}
          onIndexChange={(nextIndex) => setSelectedIndex(nextIndex)}
          onSave={handleSave}
          isSaving={isSaving}
          canSave={canContinue}
        />
      ) : null}
      {/* Canvas 6o — the darkroom.
          The likeness steps are the one place the app goes dark: you are looking
          at a render of yourself, and cream chrome around it reads as a form to
          fill in rather than a print coming up. The rest of the flow stays on
          the cream register. */}
      <div className={`flex flex-col flex-1 min-h-0 ${isDrawer ? 'bg-ink-deepest -mx-2.5 -mt-2.5 rounded-t-[14px] px-1 pt-1' : ''}`}>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isDrawer ? (
            <div className="shrink-0 px-5 pb-1 pt-4 text-center">
              <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-terracotta">
                Your likeness is ready
              </p>
              <h2 className="mt-2 font-display text-[24px] font-medium leading-tight text-on-ink-1">
                Which one is more you?
              </h2>
              <p className="mt-1.5 text-[9.5px] text-on-ink-3">
                You can refine later. Pick the one that feels right.
              </p>
            </div>
          ) : (
            <CardHeader className="flex flex-col gap-3 items-center justify-center p-6 text-center shrink-0">
              <div className="flex flex-1 flex-col gap-1.5 items-center justify-center">
                <p className="text-base font-medium text-card-foreground leading-none">Select closest likeness</p>
                <p className="text-sm font-normal text-muted-foreground leading-5">
                  Review the generated candidates and keep the closest likeness.
                </p>
              </div>
            </CardHeader>
          )}

          {isDrawer ? (
            <div className="grid grid-cols-2 gap-2.5 px-5 pb-2 pt-3">
              {candidates.map((candidate) => {
                const isPicked = selectedIndex === candidate.index
                return (
                  <div key={candidate.path} className="relative flex flex-col">
                    {/* The PICKED tab sits ON the card's top edge, so the choice
                        reads as a physical tag rather than a checkbox. */}
                    {isPicked ? (
                      <span className="absolute -top-[7px] left-1/2 z-10 -translate-x-1/2 rounded-[2px] bg-on-ink-1 px-2 py-[3px] text-[6.5px] font-bold uppercase tracking-[0.16em] text-ink-deepest">
                        Picked
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSelectedIndex(candidate.index)}
                      onDoubleClick={() => openPreviewAt(candidate.index)}
                      className={`relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-[5px] border bg-ink-deep transition-colors ${
                        isPicked ? 'border-on-ink-1' : 'border-ink-line hover:border-on-ink-3'
                      }`}
                    >
                      {candidate.signedUrl ? (
                        <img
                          src={candidate.signedUrl}
                          alt={`Candidate ${candidateLetter(candidate.index)}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[8px] uppercase tracking-[0.1em] text-on-ink-3">
                          render · placeholder
                        </span>
                      )}
                      <span
                        role="presentation"
                        onClick={(event) => {
                          event.stopPropagation()
                          openPreviewAt(candidate.index)
                        }}
                        className="absolute right-1.5 top-1.5 rounded-[2px] bg-ink-deepest/70 px-1.5 py-1 text-on-ink-2"
                      >
                        <Maximize2 className="size-2.5" aria-hidden="true" />
                      </span>
                    </button>
                    <p className="mt-1.5 text-center text-[9px] font-medium text-on-ink-2">
                      Candidate {candidateLetter(candidate.index)}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-3 justify-items-center items-start px-3 py-[28px] w-full">
              {candidates.map((candidate) => (
                <div key={candidate.path} className="flex flex-col gap-2 items-center relative w-[150px]">
                  <button
                    type="button"
                    onClick={() => openPreviewAt(candidate.index)}
                    className="bg-muted flex flex-col items-end justify-between px-2.5 py-3 relative rounded-[10px] w-full aspect-square transition-all"
                  >
                    <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[10px]">
                      {candidate.signedUrl ? (
                        <img src={candidate.signedUrl} alt={`candidate-${candidate.index}`} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-xs text-muted-foreground">preview unavailable</div>
                      )}
                    </div>
                    {selectedIndex === candidate.index ? (
                      <>
                        <div className="pointer-events-none absolute inset-0 rounded-[10px] bg-primary/10" />
                        <div className="pointer-events-none absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                          <Check className="size-3.5" aria-hidden="true" />
                        </div>
                      </>
                    ) : null}
                  </button>
                  <p className="text-xs text-muted-foreground">generation #{candidate.index + 1}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 px-3 py-[28px] w-full">
              <div
                className="bg-muted relative rounded-[16px] w-full max-w-sm aspect-square"
                role="button"
                tabIndex={0}
                onClick={() => openPreviewAt(selectedIndex)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    openPreviewAt(selectedIndex)
                  }
                }}
              >
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[16px]">
                  {candidates[selectedIndex]?.signedUrl ? (
                    <img
                      src={candidates[selectedIndex]?.signedUrl ?? ""}
                      alt={`candidate-${selectedIndex}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-xs text-muted-foreground">preview unavailable</div>
                  )}
                </div>
              </div>
              <div className="w-full max-w-sm">
                <div className="flex gap-2 overflow-x-auto px-1 pb-2 scrollbar-hide">
                  {candidates.map((candidate) => (
                    <button
                      key={candidate.path}
                      type="button"
                      onClick={() => setSelectedIndex(candidate.index)}
                      className="relative flex-shrink-0 rounded-xl border border-border/40 w-16 aspect-square overflow-hidden"
                    >
                      {candidate.signedUrl ? (
                        <img src={candidate.signedUrl} alt={`candidate-thumb-${candidate.index}`} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">preview</div>
                      )}
                      {selectedIndex === candidate.index ? (
                        <>
                          <div className="pointer-events-none absolute inset-0 bg-primary/10" />
                          <div className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3 w-3" aria-hidden="true" />
                          </div>
                        </>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {isDrawer ? (
          <div className="shrink-0 px-5 pb-5 pt-2">
            <Button
              type="button"
              onClick={handleSave}
              className="flex h-11 w-full items-center justify-center rounded-[3px] bg-primary px-4 shadow-sm hover:bg-primary/90"
              disabled={!canContinue || isSaving}
            >
              <span className="text-[12px] font-bold text-primary-foreground">
                {isSaving
                  ? "Saving…"
                  : `Use Candidate ${candidateLetter(selectedIndex)} →`}
              </span>
            </Button>

            {/* The daily meter sits inline with the regenerate, not in a toast
                after the fact — the limit should be visible where it tempts. */}
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[9px] text-on-ink-3">
              <button
                type="button"
                onClick={onRegenerate ?? onPrevious}
                disabled={isSaving || remainingToday === 0}
                className="inline-flex items-center gap-1 font-medium text-on-ink-2 disabled:opacity-40"
              >
                <RotateCcw className="size-2.5" aria-hidden="true" />
                Regenerate both
              </button>
              {remainingToday !== null ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{remainingToday} left today</span>
                </>
              ) : null}
              {onAllPoses ? (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={onAllPoses}
                    className="font-medium text-terracotta"
                  >
                    all poses ›
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <CardFooter className="flex flex-col gap-2 items-center justify-center pb-6 pt-2.5 px-6 shrink-0">
            <div className="flex w-full gap-2">
              {showBack ? (
                <Button type="button" variant="outline" className="flex-1" onClick={onPrevious}>
                  back
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={handleSave}
                className="bg-primary flex gap-2 h-9 items-center justify-center px-4 py-2 rounded-[10px] shadow-sm flex-1"
                disabled={!canContinue || isSaving}
              >
                <Share className="relative shrink-0 size-4 text-primary-foreground" />
                <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">
                  {isSaving ? "saving..." : "save likeness"}
                </p>
              </Button>
            </div>
          </CardFooter>
        )}
      </div>
    </Form>
  )
}

type LikenessPreviewOverlayProps = {
  items: CandidateCard[]
  activeIndex: number
  onClose: () => void
  onIndexChange: (nextIndex: number) => void
  onSave: () => void
  isSaving?: boolean
  canSave: boolean
}

function LikenessPreviewOverlay({
  items,
  activeIndex,
  onClose,
  onIndexChange,
  onSave,
  isSaving = false,
  canSave,
}: LikenessPreviewOverlayProps) {
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const lockAppliedRef = useRef<boolean>(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mouseStartRef = useRef<number | null>(null)
  const isDraggingRef = useRef<boolean>(false)

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  const maxIndex = Math.max(0, items.length - 1)
  const clampedIndex = Math.min(maxIndex, Math.max(0, activeIndex))

  const stepIndex = (delta: number) => {
    if (items.length <= 1) return
    const nextIndex = Math.min(maxIndex, Math.max(0, clampedIndex + delta))
    if (nextIndex !== clampedIndex) {
      onIndexChange(nextIndex)
    }
  }

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() }
    lockAppliedRef.current = false
    if (containerRef.current) {
      containerRef.current.style.touchAction = "pan-y"
    }
  }

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current
    if (!start) return
    const touch = event.touches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (!lockAppliedRef.current && Math.abs(dx) > Math.abs(dy) * 2.5) {
      if (containerRef.current) {
        containerRef.current.style.touchAction = "none"
      }
      lockAppliedRef.current = true
    }
  }

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (containerRef.current) {
      containerRef.current.style.touchAction = "pan-y"
    }
    lockAppliedRef.current = false
    if (!start) return

    if (start.x <= 16) return

    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    const dt = Date.now() - start.t
    const velocity = Math.abs(dx) / Math.max(1, dt)
    const angle = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI)
    const horizontalEnough = angle <= 20
    const distanceCommit = Math.abs(dx) > 50
    const velocityCommit = velocity >= 0.6

    if (horizontalEnough && (distanceCommit || velocityCommit)) {
      if (dx < 0) {
        stepIndex(1)
      } else {
        stepIndex(-1)
      }
    }
  }

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    isDraggingRef.current = true
    mouseStartRef.current = event.clientX
  }

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || mouseStartRef.current === null) return
    const diff = event.clientX - mouseStartRef.current
    const threshold = 50
    if (Math.abs(diff) > threshold) {
      if (diff < 0) {
        stepIndex(1)
      } else {
        stepIndex(-1)
      }
    }
    isDraggingRef.current = false
    mouseStartRef.current = null
  }

  if (!items.length) return null

  return (
    <div className="fixed inset-0 z-[150] bg-background" role="dialog" aria-modal="true">
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          isDraggingRef.current = false
          mouseStartRef.current = null
        }}
        style={{ touchAction: "pan-y" }}
      >
        <div
          className="flex h-full w-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${clampedIndex * 100}%)` }}
        >
          {items.map((item, index) => (
            <div key={`${item.candidateId}-${index}`} className="relative h-full w-full flex-shrink-0">
              {item.signedUrl ? (
                <img
                  src={item.signedUrl}
                  alt={`likeness-${index}`}
                  className="h-full w-full object-contain select-none"
                  loading={index === clampedIndex ? "eager" : "lazy"}
                  draggable={false}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
                  Preview unavailable
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <div className="relative flex items-center justify-center">
          <IconButton
            tone="ghost"
            size="sm"
            className="pointer-events-auto absolute left-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </IconButton>
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-1 py-1 text-[11px] font-semibold text-foreground">
            <span className="text-sm font-semibold">Likeness</span>
            <span className="rounded-full bg-foreground/90 px-2 py-0.5 text-[10px] text-background">
              {clampedIndex + 1}/{items.length}
            </span>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
        <div className="pointer-events-auto mx-auto w-full max-w-sm">
          <Button
            type="button"
            onClick={onSave}
            className="bg-primary flex w-full gap-2 h-9 items-center justify-center px-4 py-2 rounded-[10px] shadow-sm"
            disabled={!canSave || isSaving}
          >
            <Share className="relative shrink-0 size-4 text-primary-foreground" />
            <p className="font-medium leading-5 relative shrink-0 text-primary-foreground text-sm capitalize">
              {isSaving ? "saving..." : "save likeness"}
            </p>
          </Button>
        </div>
      </div>
    </div>
  )
}
