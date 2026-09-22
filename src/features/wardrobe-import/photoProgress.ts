import type { WardrobePhoto } from "./types"

export type WardrobePhotoProgress = {
  selected: number
  total: number
  complete: boolean
}

/**
 * How far one photo has got. A photo with no pieces kept is complete the moment
 * it is skipped, so the count reads 0 of 0 rather than staying unfinished.
 */
export function photoProgress(photo: WardrobePhoto): WardrobePhotoProgress {
  const total = photo.confirmedPieceIds.length
  const selected = Object.keys(photo.selections).length
  return { selected, total, complete: photo.step === "matches" && selected === total }
}
