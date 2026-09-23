import {
  WARDROBE_PIECE_TYPES,
  type WardrobeBatch,
  type WardrobeDetectionStatus,
  type WardrobePhoto,
  type WardrobePhotoStep,
  type WardrobePiecePicks,
  type WardrobePieceSelection,
  type WardrobePieceType,
  type WardrobeRailSource,
} from "./types"

const STORAGE_PREFIX = "atlyr:wardrobe-batch:v1:"
// Matches the life of a web selection token, so a resumed batch never holds picks the server expired.
const BATCH_TTL_MS = 24 * 60 * 60 * 1000

const STAGES: readonly WardrobeBatch["stage"][] = ["add", "identify"]
const DETECTION_STATUSES: readonly WardrobeDetectionStatus[] = [
  "pending",
  "uploading",
  "detecting",
  "complete",
  "failed",
]
const STEPS: readonly WardrobePhotoStep[] = ["pieces", "matches"]

type StoredBatch = { savedAt: number; batch: WardrobeBatch }

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

function storedPhoto(photo: WardrobePhoto): WardrobePhoto {
  return {
    id: photo.id,
    importId: photo.importId,
    // The File and its blob url die with the tab; the import row's signed url replaces them.
    previewUrl: photo.previewUrl.startsWith("blob:") ? "" : photo.previewUrl,
    detectionStatus: photo.detectionStatus,
    confirmedPieceIds: photo.confirmedPieceIds,
    piecesDefaulted: photo.piecesDefaulted,
    step: photo.step,
    selections: photo.selections,
    railByPiece: photo.railByPiece,
  }
}

function isSelection(value: unknown): value is WardrobePieceSelection {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return (row.source === "inventory" || row.source === "web")
    && typeof row.title === "string"
    && typeof row.imageUrl === "string"
    && typeof row.candidateId === "string"
    && (row.committedAt === undefined || typeof row.committedAt === "number")
}

/** A batch written before a piece could hold one pick per rail parses to nothing here. */
function parsedPicks(value: unknown): WardrobePiecePicks {
  if (!value || typeof value !== "object") return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([source, pick]) => {
      if (source !== "inventory" && source !== "web") return []
      return isSelection(pick) && pick.source === source ? [[source, pick] as const] : []
    }),
  )
}

function parsedSelections(value: unknown): WardrobePhoto["selections"] {
  if (!value || typeof value !== "object") return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([pieceType, picks]) => {
      if (!WARDROBE_PIECE_TYPES.includes(pieceType as WardrobePieceType)) return []
      const parsed = parsedPicks(picks)
      return parsed.inventory || parsed.web ? [[pieceType as WardrobePieceType, parsed]] : []
    }),
  )
}

function parsedRails(value: unknown): WardrobePhoto["railByPiece"] {
  if (!value || typeof value !== "object") return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, WardrobeRailSource] =>
        entry[1] === "inventory" || entry[1] === "web",
    ),
  )
}

function parsedPhoto(value: unknown): WardrobePhoto | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  // With no import row there is no image to come back to, so the photo cannot be rebuilt.
  if (typeof row.id !== "string" || typeof row.importId !== "string" || !row.importId) return null
  if (!DETECTION_STATUSES.includes(row.detectionStatus as WardrobeDetectionStatus)) return null
  if (!STEPS.includes(row.step as WardrobePhotoStep)) return null
  const confirmedPieceIds = Array.isArray(row.confirmedPieceIds)
    ? row.confirmedPieceIds.filter((id): id is string => typeof id === "string")
    : []
  return {
    id: row.id,
    importId: row.importId,
    previewUrl: typeof row.previewUrl === "string" && !row.previewUrl.startsWith("blob:")
      ? row.previewUrl
      : "",
    detectionStatus: row.detectionStatus as WardrobeDetectionStatus,
    confirmedPieceIds,
    piecesDefaulted: row.piecesDefaulted === true,
    step: row.step as WardrobePhotoStep,
    selections: parsedSelections(row.selections),
    railByPiece: parsedRails(row.railByPiece),
  }
}

/** The whole batch, minus what only lives in the tab, so a return to the flow lands where it left. */
export function writeWardrobeBatch(userId: string, batch: WardrobeBatch, now = Date.now()): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify({
      savedAt: now,
      batch: { ...batch, photos: batch.photos.map(storedPhoto) },
    } satisfies StoredBatch))
  } catch {
    // A full or disabled browser store costs the user the resume, not the flow.
  }
}

export function readWardrobeBatch(userId: string, now = Date.now()): WardrobeBatch | null {
  if (typeof window === "undefined") return null
  const key = storageKey(userId)
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<StoredBatch>
    const batch = stored?.batch
    const stale = typeof stored?.savedAt !== "number" || now - stored.savedAt > BATCH_TTL_MS
    if (stale || !batch || typeof batch !== "object"
      || !STAGES.includes(batch.stage) || !Array.isArray(batch.photos)) {
      window.localStorage.removeItem(key)
      return null
    }
    const photos = batch.photos.flatMap((photo) => {
      const parsed = parsedPhoto(photo)
      return parsed ? [parsed] : []
    })
    if (!photos.length) {
      window.localStorage.removeItem(key)
      return null
    }
    const activePhotoId = photos.some((photo) => photo.id === batch.activePhotoId)
      ? batch.activePhotoId
      : photos[0].id
    return { stage: batch.stage, photos, activePhotoId }
  } catch {
    window.localStorage.removeItem(key)
    return null
  }
}

export function clearWardrobeBatch(userId: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(storageKey(userId))
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
