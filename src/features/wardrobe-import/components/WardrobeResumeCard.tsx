import {
  WARDROBE_PRIMARY,
  WARDROBE_SECONDARY,
} from "@/features/wardrobe-import/components/WardrobeImportChrome"
import { photoProgress } from "@/features/wardrobe-import/photoProgress"
import type { WardrobePhoto } from "@/features/wardrobe-import/types"
import { MAX_WARDROBE_PHOTOS } from "@/features/wardrobe-import/wardrobeBatchReducer"

type Props = {
  photos: WardrobePhoto[]
  onContinue: () => void
  onStartNew: () => void
}

/** The gate on re-entering the flow with a batch still open: pick it up, or drop it and start again. */
export function WardrobeResumeCard({ photos, onContinue, onStartNew }: Props) {
  const done = photos.filter((photo) => photoProgress(photo).complete).length

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center px-4">
      <section className="rounded-control border border-hairline bg-white p-4">
        <h2 className="font-display text-title font-medium text-ink">Continue where you left off?</h2>
        <p className="mt-1 text-chip text-taupe">
          {photos.length} {photos.length === 1 ? "photo" : "photos"} · {done} done
        </p>
        <div className="mt-3 flex gap-2 overflow-x-auto scrollbar-hide">
          {photos.slice(0, MAX_WARDROBE_PHOTOS).map((photo) => (
            <div
              key={photo.id}
              className="h-[60px] w-[46px] flex-none overflow-hidden rounded-chip bg-editorial"
            >
              {photo.previewUrl ? (
                <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={onStartNew} className={WARDROBE_SECONDARY}>
            start new
          </button>
          <button type="button" onClick={onContinue} className={WARDROBE_PRIMARY}>
            continue
          </button>
        </div>
      </section>
    </div>
  )
}
