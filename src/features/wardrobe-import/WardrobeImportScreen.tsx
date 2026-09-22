import { useMemo } from "react"
import { useNavigate } from "react-router-dom"

import { Icons } from "@/design-system/icons"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { boardPath } from "@/features/collections/boardUrl"
import {
  WARDROBE_PRIMARY,
  WardrobeImportHeader,
} from "@/features/wardrobe-import/components/WardrobeImportChrome"
import { WardrobeMatchStep } from "@/features/wardrobe-import/components/WardrobeMatchStep"
import { WardrobePhotoPicker } from "@/features/wardrobe-import/components/WardrobePhotoPicker"
import { WardrobePhotoRail } from "@/features/wardrobe-import/components/WardrobePhotoRail"
import { WardrobePhotoSync } from "@/features/wardrobe-import/components/WardrobePhotoSync"
import { WardrobePiecesStep } from "@/features/wardrobe-import/components/WardrobePiecesStep"
import { WardrobeReviewStep } from "@/features/wardrobe-import/components/WardrobeReviewStep"
import { useStartWardrobeBatch } from "@/features/wardrobe-import/hooks/useWardrobeBatchImport"
import { useWardrobeBatch } from "@/features/wardrobe-import/providers/WardrobeBatchProvider"
import { reviewItems } from "@/features/wardrobe-import/reviewItems"

const WARDROBE_BOARD_PATH = boardPath("wardrobe")

export function WardrobeImportScreen() {
  const navigate = useNavigate()
  const {
    batch,
    activePhoto,
    addFiles,
    removePhoto,
    startIdentify,
    setStage,
    setActivePhoto,
    retryPhoto,
  } = useWardrobeBatch()
  const startBatch = useStartWardrobeBatch()

  const photos = batch.photos
  const review = useMemo(() => reviewItems(photos), [photos])
  const activeIndex = photos.findIndex((photo) => photo.id === activePhoto?.id)
  // The back arrow always leaves; the batch is kept, so the flow can be picked up again.
  const exitFlow = () => navigate(WARDROBE_BOARD_PATH)

  const goToPhoto = (index: number) => {
    const next = photos[index]
    if (next) setActivePhoto(next.id)
  }
  const advanceToNextPhoto = () => goToPhoto(activeIndex + 1)

  const beginIdentify = () => {
    startIdentify()
    void startBatch()
  }

  const openReview = () => setStage("review")

  if (batch.stage === "add") {
    return (
      <AppShellLayout>
        <div className="flex flex-col bg-background text-foreground" style={{ height: "calc(100dvh - 55px)" }}>
          <WardrobeImportHeader title="Add to wardrobe" onBack={exitFlow} />
          <WardrobePhotoPicker photos={photos} onAddFiles={addFiles} onRemove={removePhoto} />
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

  if (batch.stage === "review") {
    return (
      <AppShellLayout>
        <div className="flex flex-col overflow-hidden bg-background text-foreground" style={{ height: "calc(100dvh - 55px)" }}>
          <WardrobeImportHeader
            title="Review wardrobe"
            meta={`${review.total} selected`}
            onBack={exitFlow}
          />
          <WardrobeReviewStep
            review={review}
            photoCount={photos.length}
            onPrevious={() => setStage("identify")}
          />
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
          action={review.total ? (
            <button type="button" onClick={openReview} className="flex-none pl-3 text-chip font-medium text-violet">
              review
            </button>
          ) : undefined}
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
            <WardrobeMatchStep
              key={activePhoto.id}
              photo={activePhoto}
              isLast={activeIndex === photos.length - 1}
              canGoBack={activeIndex > 0}
              onPrevious={() => goToPhoto(activeIndex - 1)}
              onNext={advanceToNextPhoto}
              onReview={openReview}
            />
          ) : (
            <WardrobePiecesStep key={activePhoto.id} photo={activePhoto} onAdvance={advanceToNextPhoto} />
          )
        ) : null}
      </div>
    </AppShellLayout>
  )
}
