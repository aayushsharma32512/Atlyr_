import { useNavigate } from "react-router-dom"

import { Icons } from "@/design-system/icons"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { boardPath } from "@/features/collections/boardUrl"
import {
  WARDROBE_PRIMARY,
  WardrobeImportHeader,
} from "@/features/wardrobe-import/components/WardrobeImportChrome"
import { WardrobePhotoPicker } from "@/features/wardrobe-import/components/WardrobePhotoPicker"
import { WardrobePhotoRail } from "@/features/wardrobe-import/components/WardrobePhotoRail"
import { WardrobePhotoSync } from "@/features/wardrobe-import/components/WardrobePhotoSync"
import { WardrobePiecesStep } from "@/features/wardrobe-import/components/WardrobePiecesStep"
import { useStartWardrobeBatch } from "@/features/wardrobe-import/hooks/useWardrobeBatchImport"
import { useWardrobeBatch } from "@/features/wardrobe-import/providers/WardrobeBatchProvider"

const WARDROBE_BOARD_PATH = boardPath("wardrobe")

export function WardrobeImportScreen() {
  const navigate = useNavigate()
  const {
    batch,
    activePhoto,
    addFiles,
    removePhoto,
    startIdentify,
    setActivePhoto,
    retryPhoto,
  } = useWardrobeBatch()
  const startBatch = useStartWardrobeBatch()

  const photos = batch.photos
  const activeIndex = photos.findIndex((photo) => photo.id === activePhoto?.id)
  // The back arrow always leaves; the batch is kept, so the flow can be picked up again.
  const exitFlow = () => navigate(WARDROBE_BOARD_PATH)

  const advanceToNextPhoto = () => {
    const next = photos[activeIndex + 1]
    if (next) setActivePhoto(next.id)
  }

  const beginIdentify = () => {
    startIdentify()
    void startBatch()
  }

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
          <WardrobePiecesStep key={activePhoto.id} photo={activePhoto} onAdvance={advanceToNextPhoto} />
        ) : null}
      </div>
    </AppShellLayout>
  )
}
