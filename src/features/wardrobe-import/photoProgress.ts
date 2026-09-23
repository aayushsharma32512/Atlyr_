import type { WardrobePhoto } from "./types"

export type WardrobePhotoProgress = {
  selected: number
  committed: number
  total: number
  complete: boolean
}

/**
 * How far one photo has got, counted in pieces rather than picks: a piece is done
 * once either of its picks has been sent on, and a photo with no pieces kept is done
 * the moment it is skipped, so the count reads 0 of 0 rather than staying unfinished.
 */
export function photoProgress(photo: WardrobePhoto): WardrobePhotoProgress {
  const total = photo.confirmedPieceIds.length
  const pieces = Object.values(photo.selections).flatMap((picks) => {
    const found = [picks?.inventory, picks?.web].filter((pick) => pick !== undefined)
    return found.length ? [found] : []
  })
  const committed = pieces.filter((found) => found.some((pick) => pick.committedAt)).length
  return {
    selected: pieces.length,
    committed,
    total,
    complete: total ? committed === total : photo.step === "matches",
  }
}
