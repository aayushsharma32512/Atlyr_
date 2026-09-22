import { AlertTriangle, Check, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import type { WardrobePhoto } from "@/features/wardrobe-import/types"

type Props = {
  photos: WardrobePhoto[]
  activePhotoId: string | null
  onSelect: (photoId: string) => void
  onRetry: (photoId: string) => void
}

function StatusBadge({ photo }: { photo: WardrobePhoto }) {
  if (photo.detectionStatus === "complete") {
    return (
      <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-violet text-white">
        <Check className="h-2.5 w-2.5" aria-hidden="true" />
      </span>
    )
  }
  if (photo.detectionStatus === "failed") {
    return (
      <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-destructive">
        <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
      </span>
    )
  }
  return (
    <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-ink">
      <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
    </span>
  )
}

/** The batch across the top: numbered thumbnails, the live one outlined, each one's state on it. */
export function WardrobePhotoRail({ photos, activePhotoId, onSelect, onRetry }: Props) {
  return (
    <div className="flex flex-none gap-2 overflow-x-auto border-b border-hairline px-4 py-2 scrollbar-hide">
      {photos.map((photo, index) => {
        const active = photo.id === activePhotoId
        const failed = photo.detectionStatus === "failed"
        return (
          <button
            key={photo.id}
            type="button"
            aria-label={failed ? `Retry photo ${index + 1}` : `Photo ${index + 1}`}
            aria-current={active}
            onClick={() => (failed ? onRetry(photo.id) : onSelect(photo.id))}
            className={cn(
              "relative h-[72px] w-[56px] flex-none overflow-hidden rounded-chip border bg-editorial",
              active ? "border-violet" : "border-hairline",
            )}
          >
            {photo.previewUrl ? (
              <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
            <span
              className={cn(
                "absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-chip font-medium leading-none",
                active ? "bg-violet text-white" : "bg-white text-ink",
              )}
            >
              {index + 1}
            </span>
            <StatusBadge photo={photo} />
          </button>
        )
      })}
    </div>
  )
}
