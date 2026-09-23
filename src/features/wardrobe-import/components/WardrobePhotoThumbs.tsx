import { Icons } from "@/design-system/icons"
import type { WardrobePhoto } from "@/features/wardrobe-import/types"

type Props = {
  photos: WardrobePhoto[]
  onRemove: (photoId: string) => void
}

/** The photos already in the batch, under the drop zone: tap a cross to drop one. */
export function WardrobePhotoThumbs({ photos, onRemove }: Props) {
  return (
    <div className="flex flex-none gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
      {photos.map((photo, index) => (
        <div
          key={photo.id}
          className="relative h-[72px] w-[56px] flex-none overflow-hidden rounded-chip border border-hairline bg-editorial"
        >
          {photo.previewUrl ? (
            <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
          <button
            type="button"
            aria-label={`Remove photo ${index + 1}`}
            onClick={() => onRemove(photo.id)}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-ink shadow-sm"
          >
            <Icons.close className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
