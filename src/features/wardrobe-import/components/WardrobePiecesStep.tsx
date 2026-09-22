import { useState } from "react"
import { Loader2, RotateCcw } from "lucide-react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"
import { CandidatePicker } from "@/features/inspiration-import/components/CandidatePicker"
import { useSelectImportCandidates } from "@/features/inspiration-import/hooks/useInspirationImport"
import {
  useStartWardrobeBatch,
  useWardrobePhotoImport,
} from "@/features/wardrobe-import/hooks/useWardrobeBatchImport"
import { useWardrobeBatch } from "@/features/wardrobe-import/providers/WardrobeBatchProvider"
import {
  WARDROBE_PRIMARY,
  WARDROBE_TOGGLE,
} from "@/features/wardrobe-import/components/WardrobeImportChrome"
import type { WardrobePhoto } from "@/features/wardrobe-import/types"

type Props = {
  photo: WardrobePhoto
  /** Moves the batch on to the next photo once this one is settled. */
  onAdvance: () => void
}

/** One photo's pieces: what the detector found, which of it the user keeps, and the hand-off. */
export function WardrobePiecesStep({ photo, onAdvance }: Props) {
  const { setConfirmedPieces, setStep } = useWardrobeBatch()
  const { candidates, sourceUrl, errorMessage } = useWardrobePhotoImport(photo)
  const startBatch = useStartWardrobeBatch()
  // The web search only runs on candidates the row marks selected, so confirm them there first.
  const selectMutation = useSelectImportCandidates(photo.importId ?? "")
  const [pickError, setPickError] = useState<string | null>(null)

  const imageUrl = photo.previewUrl || sourceUrl
  const confirmedCount = photo.confirmedPieceIds.length

  const togglePiece = (candidateId: string) => {
    const candidate = candidates.find((item) => item.id === candidateId)
    if (!candidate) return
    setPickError(null)
    if (photo.confirmedPieceIds.includes(candidateId)) {
      setConfirmedPieces(photo.id, photo.confirmedPieceIds.filter((id) => id !== candidateId))
      return
    }
    // One per slot, as on the slot row itself: a second pick is refused, not swapped in.
    const taken = photo.confirmedPieceIds.some(
      (id) => candidates.find((item) => item.id === id)?.category === candidate.category,
    )
    if (taken) {
      setPickError(candidate.category === "top"
        ? "one top at a time — clear the slot first"
        : "one lower at a time — clear the slot first")
      return
    }
    setConfirmedPieces(photo.id, [...photo.confirmedPieceIds, candidateId])
  }

  if (photo.detectionStatus === "failed") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center" role="alert">
        <p className="text-body text-ink">We couldn’t read this photo.</p>
        {errorMessage ? <p className="text-chip text-destructive">{errorMessage}</p> : null}
        <button
          type="button"
          onClick={() => void startBatch([photo.id])}
          className={cn(WARDROBE_TOGGLE, "h-9")}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> retry
        </button>
      </div>
    )
  }

  if (photo.detectionStatus !== "complete") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 px-4 py-3">
          <div className="relative flex h-full items-center justify-center overflow-hidden rounded-control" aria-busy="true">
            {imageUrl ? (
              <img src={imageUrl} alt="Your photo" className="block max-h-full w-auto max-w-full" />
            ) : (
              <p className="text-chip text-taupe">Preparing your image…</p>
            )}
            <span
              aria-hidden="true"
              className="inspiration-scan-line absolute inset-x-0 z-10 h-0.5 bg-gradient-to-r from-transparent via-violet to-transparent"
            />
          </div>
        </div>
        <p className="flex-none border-t border-hairline px-4 pb-4 pt-3 font-voice text-body italic text-charcoal" aria-live="polite">
          Finding the pieces in your photo…
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {imageUrl ? (
        <CandidatePicker
          sourceUrl={imageUrl}
          candidates={candidates}
          selectedIds={photo.confirmedPieceIds}
          error={pickError ?? selectMutation.error?.message ?? null}
          heading={`Detected pieces (${confirmedCount})`}
          onSelect={togglePiece}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-ink" aria-hidden="true" />
        </div>
      )}

      <div className="flex h-[76px] flex-none items-center gap-3 border-t border-hairline bg-background px-4 pb-2">
        {confirmedCount ? (
          <button
            type="button"
            className={WARDROBE_PRIMARY}
            disabled={selectMutation.isPending}
            onClick={() => selectMutation.mutate(photo.confirmedPieceIds, { onSuccess: () => setStep(photo.id, "matches") })}
          >
            {selectMutation.isPending
              ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
              : <Icons.search className="h-[18px] w-[18px]" aria-hidden="true" />}
            find matches · {confirmedCount}
          </button>
        ) : (
          <button
            type="button"
            className={WARDROBE_PRIMARY}
            onClick={() => {
              setStep(photo.id, "matches")
              onAdvance()
            }}
          >
            skip photo
          </button>
        )}
      </div>
    </div>
  )
}
