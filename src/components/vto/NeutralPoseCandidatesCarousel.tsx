import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface NeutralPoseCandidatesCarouselProps {
  candidateUrls: string[]
  onUseCandidate: (candidateIndex: number) => Promise<void> | void
  onBack?: () => void
  title?: string
  description?: string
  showIntro?: boolean
}

export function NeutralPoseCandidatesCarousel({
  candidateUrls,
  onUseCandidate,
  onBack,
  title = 'Choose a Candidate',
  description = 'Swipe to compare each option and pick the likeness that feels most like you.',
  showIntro = true
}: NeutralPoseCandidatesCarouselProps) {
  const validCandidates = candidateUrls.filter(Boolean)
  const [activeIndex, setActiveIndex] = useState(0)
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const target = containerRef.current.querySelector<HTMLDivElement>(`[data-candidate-index="${activeIndex}"]`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [activeIndex])

  async function handleUseCandidate() {
    if (loadingIndex !== null) return
    const currentIndex = activeIndex
    setLoadingIndex(currentIndex)
    try {
      await onUseCandidate(currentIndex)
    } finally {
      setLoadingIndex(null)
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {showIntro && (
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {onBack && (
            <Button variant="secondary" size="sm" onClick={onBack}>
              Back
            </Button>
          )}
        </div>
      )}

      {validCandidates.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {validCandidates.map((url, index) => (
              <button
                key={`indicator-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={cn(
                  'h-12 w-12 shrink-0 overflow-hidden rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  activeIndex === index ? 'border-primary ring-1 ring-primary' : 'border-border/70 opacity-70 hover:opacity-100'
                )}
              >
                <img src={url} alt={`candidate thumbnail ${index + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
          <Button
            size="sm"
            className="shrink-0"
            onClick={handleUseCandidate}
            disabled={loadingIndex !== null}
          >
            {loadingIndex === activeIndex ? 'Selecting…' : 'Select Likeness'}
          </Button>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory"
      >
        {validCandidates.map((url, index) => (
          <div
            key={`${url}-${index}`}
            data-candidate-index={index}
            className={cn(
              'relative flex-shrink-0 w-full max-w-xs sm:max-w-sm rounded-2xl border transition-shadow bg-muted/40 snap-center',
              activeIndex === index ? 'ring-2 ring-primary shadow-md bg-background' : 'border-border'
            )}
            onClick={() => setActiveIndex(index)}
          >
            <div className="aspect-[3/4] w-full overflow-hidden rounded-2xl bg-muted">
              <img
                src={url}
                alt={`neutral pose candidate ${index + 1}`}
                className="h-full w-full object-contain"
              />
            </div>
            {activeIndex === index && (
              <div className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-primary shadow" />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            disabled={activeIndex === 0 || loadingIndex !== null}
            onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs uppercase tracking-wide">
            Candidate {activeIndex + 1} of {validCandidates.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            disabled={activeIndex === validCandidates.length - 1 || loadingIndex !== null}
            onClick={() => setActiveIndex((index) => Math.min(validCandidates.length - 1, index + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1">
          {validCandidates.map((_, index) => (
            <div
              key={index}
              className={cn(
                'h-1.5 w-6 rounded-full transition-all',
                activeIndex === index ? 'bg-primary' : 'bg-muted'
              )}
            />
          ))}
        </div>
      </div>

      {onBack && (
        <div className="pt-2">
          <Button variant="ghost" className="w-full" onClick={onBack}>
            Back
          </Button>
        </div>
      )}
    </div>
  )
}
