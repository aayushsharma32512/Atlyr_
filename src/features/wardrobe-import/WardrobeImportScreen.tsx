import { useState } from "react"
import { useNavigate } from "react-router-dom"

import { Icons } from "@/design-system/icons"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { boardPath } from "@/features/collections/boardUrl"
import { InspirationSourceInput } from "@/features/inspiration-import/components/InspirationSourceInput"
import {
  WARDROBE_PRIMARY,
  WardrobeImportHeader,
} from "@/features/wardrobe-import/components/WardrobeImportChrome"
import { WardrobeMatchStep } from "@/features/wardrobe-import/components/WardrobeMatchStep"
import { WardrobePhotoRail } from "@/features/wardrobe-import/components/WardrobePhotoRail"
import { WardrobePhotoSync } from "@/features/wardrobe-import/components/WardrobePhotoSync"
import { WardrobePhotoThumbs } from "@/features/wardrobe-import/components/WardrobePhotoThumbs"
import { WardrobePiecesStep } from "@/features/wardrobe-import/components/WardrobePiecesStep"
import { WardrobeResumeCard } from "@/features/wardrobe-import/components/WardrobeResumeCard"
import { useStartWardrobeBatch } from "@/features/wardrobe-import/hooks/useWardrobeBatchImport"
import { photoProgress } from "@/features/wardrobe-import/photoProgress"
import { useWardrobeBatch } from "@/features/wardrobe-import/providers/WardrobeBatchProvider"
import type { WardrobePieceRef } from "@/features/wardrobe-import/types"
import { withCommittedSelections } from "@/features/wardrobe-import/wardrobeBatchReducer"
import { useToast } from "@/hooks/use-toast"

const WARDROBE_BOARD_PATH = boardPath("wardrobe")
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_BYTES = 10 * 1024 * 1024

export function WardrobeImportScreen() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const {
    batch,
    activePhoto,
    addFiles,
    removePhoto,
    startIdentify,
    setActivePhoto,
    markCommitted,
    retryPhoto,
    reset,
  } = useWardrobeBatch()
  const startBatch = useStartWardrobeBatch()
  // Asked once per visit to the flow, off the batch as it stood on arrival: moving
  // between steps must not bring the card back, re-entering the route must.
  const [showResume, setShowResume] = useState(() => batch.photos.length > 0 && batch.stage !== "add")
  const [addError, setAddError] = useState<string | null>(null)

  const photos = batch.photos
  const activeIndex = photos.findIndex((photo) => photo.id === activePhoto?.id)
  // The back arrow always leaves; the batch is kept, so the flow can be picked up again.
  const exitFlow = () => navigate(WARDROBE_BOARD_PATH)

  const goToPhoto = (index: number) => {
    const next = photos[index]
    if (next) setActivePhoto(next.id)
  }
  const advanceToNextPhoto = () => goToPhoto(activeIndex + 1)

  const handleFiles = (files: File[]) => {
    const accepted = files.filter((file) => ACCEPTED_TYPES.has(file.type) && file.size <= MAX_BYTES)
    setAddError(accepted.length === files.length
      ? null
      : "Skipped some photos — use JPEG, PNG or WebP under 10 MB.")
    if (accepted.length) addFiles(accepted)
  }

  const beginIdentify = () => {
    startIdentify()
    void startBatch()
  }

  const onCommitted = (photoId: string, picks: WardrobePieceRef[]) => {
    markCommitted(photoId, picks)
    const at = Date.now()
    const after = photos.map((photo) => (
      photo.id === photoId ? withCommittedSelections(photo, picks, at) : photo
    ))
    if (!after.length || !after.every((photo) => photoProgress(photo).complete)) return
    toast({ title: "All added to your wardrobe" })
    reset()
    navigate(WARDROBE_BOARD_PATH)
  }

  if (showResume) {
    return (
      <AppShellLayout>
        <div className="flex flex-col bg-background text-foreground" style={{ height: "calc(100dvh - 55px)" }}>
          <WardrobeImportHeader title="Add to wardrobe" onBack={exitFlow} />
          {/* The rebuilt photos have no preview until their import row lands. */}
          {photos.map((photo) => <WardrobePhotoSync key={photo.id} photo={photo} />)}
          <WardrobeResumeCard
            photos={photos}
            onContinue={() => setShowResume(false)}
            onStartNew={() => {
              reset()
              setShowResume(false)
            }}
          />
        </div>
      </AppShellLayout>
    )
  }

  if (batch.stage === "add") {
    return (
      <AppShellLayout>
        <div className="flex flex-col bg-background text-foreground" style={{ height: "calc(100dvh - 55px)" }}>
          <WardrobeImportHeader title="Add to wardrobe" onBack={exitFlow} />
          <InspirationSourceInput
            file={null}
            isPending={false}
            error={addError}
            intent="wardrobe"
            multiple
            onFiles={handleFiles}
          />
          {photos.length ? <WardrobePhotoThumbs photos={photos} onRemove={removePhoto} /> : null}
          {/* Dimmed until a photo is in. */}
          <div className="flex h-[72px] flex-none items-center gap-2 border-t border-hairline bg-background px-4 pb-4 pt-3">
            <button type="button" disabled={!photos.length} onClick={beginIdentify} className={WARDROBE_PRIMARY}>
              <Icons.search className="h-[18px] w-[18px]" aria-hidden="true" />
              identify items · {photos.length}
            </button>
          </div>
        </div>
      </AppShellLayout>
    )
  }

  return (
    <AppShellLayout>
      <div className="flex flex-col overflow-hidden bg-background text-foreground" style={{ height: "calc(100dvh - 55px)" }}>
        <WardrobeImportHeader
          title="Find items"
          meta={photos.length ? `${Math.max(activeIndex, 0) + 1} of ${photos.length}` : undefined}
          onBack={exitFlow}
        />
        {photos.map((photo) => <WardrobePhotoSync key={photo.id} photo={photo} />)}
        <WardrobePhotoRail
          photos={photos}
          activePhotoId={activePhoto?.id ?? null}
          onSelect={setActivePhoto}
          onRetry={(photoId) => {
            retryPhoto(photoId)
            setActivePhoto(photoId)
            void startBatch([photoId])
          }}
        />
        {activePhoto ? (
          activePhoto.step === "matches" ? (
            <WardrobeMatchStep key={activePhoto.id} photo={activePhoto} onCommitted={onCommitted} />
          ) : (
            <WardrobePiecesStep key={activePhoto.id} photo={activePhoto} onAdvance={advanceToNextPhoto} />
          )
        ) : null}
      </div>
    </AppShellLayout>
  )
}
