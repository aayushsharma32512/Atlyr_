import type { WardrobePhoto } from "./types"

const STORAGE_KEY = "atlyr.wardrobe-batch"

export type StoredWardrobePhoto = { id: string; importId: string }

/** Only the photo-to-import pairs survive a refresh; picks stay in memory. */
export function writeWardrobeBatch(photos: WardrobePhoto[]): void {
  const stored: StoredWardrobePhoto[] = photos.flatMap((photo) => (
    photo.importId ? [{ id: photo.id, importId: photo.importId }] : []
  ))
  try {
    if (!stored.length) window.sessionStorage.removeItem(STORAGE_KEY)
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Private mode or disabled storage: the batch simply does not survive a refresh.
  }
}

export function readWardrobeBatch(): StoredWardrobePhoto[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      const row = entry as Partial<StoredWardrobePhoto>
      return typeof row?.id === "string" && typeof row?.importId === "string"
        ? [{ id: row.id, importId: row.importId }]
        : []
    })
  } catch {
    return []
  }
}

export function clearWardrobeBatch(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function restoredWardrobePhoto(stored: StoredWardrobePhoto): WardrobePhoto {
  return {
    id: stored.id,
    importId: stored.importId,
    previewUrl: "",
    detectionStatus: "detecting",
    confirmedPieceIds: [],
    piecesDefaulted: false,
    step: "pieces",
    selections: {},
    railByPiece: {},
  }
}
