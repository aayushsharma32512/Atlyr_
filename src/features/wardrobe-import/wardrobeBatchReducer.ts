import type {
  WardrobeBatch,
  WardrobeDetectionStatus,
  WardrobePhoto,
  WardrobePhotoStep,
  WardrobePiecePicks,
  WardrobePieceRef,
  WardrobePieceSelection,
  WardrobePieceType,
  WardrobeRailSource,
} from "./types"

export const MAX_WARDROBE_PHOTOS = 10

export const emptyWardrobeBatch: WardrobeBatch = { stage: "add", photos: [], activePhotoId: null }

export type WardrobeBatchAction =
  | { type: "addPhotos"; photos: WardrobePhoto[] }
  | { type: "removePhoto"; photoId: string }
  | { type: "startIdentify" }
  | { type: "setImportId"; photoId: string; importId: string }
  | { type: "setDetectionStatus"; photoId: string; status: WardrobeDetectionStatus; previewUrl?: string | null }
  | { type: "setActivePhoto"; photoId: string }
  | { type: "setConfirmedPieces"; photoId: string; candidateIds: string[] }
  | { type: "applyDefaultPieces"; photoId: string; candidateIds: string[] }
  | { type: "setStep"; photoId: string; step: WardrobePhotoStep }
  | {
      type: "setSelection"
      photoId: string
      pieceType: WardrobePieceType
      source: WardrobeRailSource
      selection: WardrobePieceSelection | null
    }
  | { type: "setPieceSource"; photoId: string; candidateId: string; source: WardrobeRailSource }
  | { type: "markCommitted"; photoId: string; picks: WardrobePieceRef[]; at: number }
  | { type: "retryPhoto"; photoId: string }
  | { type: "restore"; batch: WardrobeBatch }
  | { type: "reset" }

export function createWardrobePhoto(file: File, previewUrl: string): WardrobePhoto {
  return {
    id: crypto.randomUUID(),
    importId: null,
    file,
    previewUrl,
    detectionStatus: "pending",
    confirmedPieceIds: [],
    piecesDefaulted: false,
    step: "pieces",
    selections: {},
    railByPiece: {},
  }
}

/** Drops both picks of any piece the user has since taken off the photo. */
function keptSelections(
  selections: WardrobePhoto["selections"],
  candidateIds: string[],
): WardrobePhoto["selections"] {
  const entries = Object.entries(selections) as [WardrobePieceType, WardrobePiecePicks][]
  const kept = entries.filter(([, picks]) => {
    const candidateId = (picks.inventory ?? picks.web)?.candidateId
    return candidateId !== undefined && candidateIds.includes(candidateId)
  })
  return kept.length === entries.length ? selections : Object.fromEntries(kept)
}

/**
 * Stamps the named picks as sent on. Exported so a caller can ask what the photo
 * will look like after the stamp without waiting for the next render.
 */
export function withCommittedSelections(
  photo: WardrobePhoto,
  picks: WardrobePieceRef[],
  at: number,
): WardrobePhoto {
  const selections = { ...photo.selections }
  let changed = false
  for (const { type, source } of picks) {
    const selection = selections[type]?.[source]
    if (!selection || selection.committedAt) continue
    selections[type] = { ...selections[type], [source]: { ...selection, committedAt: at } }
    changed = true
  }
  return changed ? { ...photo, selections } : photo
}

function withPhoto(
  state: WardrobeBatch,
  photoId: string,
  update: (photo: WardrobePhoto) => WardrobePhoto,
): WardrobeBatch {
  let changed = false
  const photos = state.photos.map((photo) => {
    if (photo.id !== photoId) return photo
    const next = update(photo)
    if (next !== photo) changed = true
    return next
  })
  return changed ? { ...state, photos } : state
}

export function wardrobeBatchReducer(state: WardrobeBatch, action: WardrobeBatchAction): WardrobeBatch {
  switch (action.type) {
    case "addPhotos": {
      const room = MAX_WARDROBE_PHOTOS - state.photos.length
      if (room <= 0 || !action.photos.length) return state
      return { ...state, photos: [...state.photos, ...action.photos.slice(0, room)] }
    }

    case "removePhoto": {
      const index = state.photos.findIndex((photo) => photo.id === action.photoId)
      if (index < 0) return state
      const photos = state.photos.filter((photo) => photo.id !== action.photoId)
      const activePhotoId = state.activePhotoId === action.photoId
        ? photos[index]?.id ?? photos[index - 1]?.id ?? null
        : state.activePhotoId
      return {
        stage: photos.length ? state.stage : "add",
        photos,
        activePhotoId: photos.length ? activePhotoId : null,
      }
    }

    case "startIdentify": {
      if (!state.photos.length) return state
      return { ...state, stage: "identify", activePhotoId: state.activePhotoId ?? state.photos[0].id }
    }

    case "setImportId":
      return withPhoto(state, action.photoId, (photo) => (
        photo.importId === action.importId ? photo : { ...photo, importId: action.importId }
      ))

    case "setDetectionStatus":
      return withPhoto(state, action.photoId, (photo) => {
        // A rebuilt photo has no local preview, so the import row's signed url fills it in once.
        const previewUrl = photo.previewUrl || action.previewUrl || ""
        if (photo.detectionStatus === action.status && photo.previewUrl === previewUrl) return photo
        return { ...photo, detectionStatus: action.status, previewUrl }
      })

    case "setActivePhoto":
      if (!state.photos.some((photo) => photo.id === action.photoId)) return state
      return state.activePhotoId === action.photoId ? state : { ...state, activePhotoId: action.photoId }

    case "setConfirmedPieces":
      return withPhoto(state, action.photoId, (photo) => ({
        ...photo,
        confirmedPieceIds: action.candidateIds,
        piecesDefaulted: true,
        selections: keptSelections(photo.selections, action.candidateIds),
      }))

    case "applyDefaultPieces":
      return withPhoto(state, action.photoId, (photo) => (
        photo.piecesDefaulted
          ? photo
          : { ...photo, confirmedPieceIds: action.candidateIds, piecesDefaulted: true }
      ))

    case "setStep":
      return withPhoto(state, action.photoId, (photo) => (
        photo.step === action.step ? photo : { ...photo, step: action.step }
      ))

    case "setSelection":
      return withPhoto(state, action.photoId, (photo) => {
        const picks = photo.selections[action.pieceType]
        if (!action.selection && !picks?.[action.source]) return photo
        const next: WardrobePiecePicks = { ...picks }
        if (action.selection) next[action.source] = action.selection
        else delete next[action.source]
        const selections = { ...photo.selections }
        // A piece with neither pick left leaves no entry, so a count of picked pieces stays right.
        if (next.inventory || next.web) selections[action.pieceType] = next
        else delete selections[action.pieceType]
        return { ...photo, selections }
      })

    case "setPieceSource":
      return withPhoto(state, action.photoId, (photo) => (
        photo.railByPiece[action.candidateId] === action.source
          ? photo
          : { ...photo, railByPiece: { ...photo.railByPiece, [action.candidateId]: action.source } }
      ))

    case "markCommitted":
      return withPhoto(state, action.photoId, (photo) => (
        withCommittedSelections(photo, action.picks, action.at)
      ))

    case "retryPhoto":
      return withPhoto(state, action.photoId, (photo) => ({ ...photo, detectionStatus: "pending" }))

    case "restore":
      if (!action.batch.photos.length) return state
      return action.batch

    case "reset":
      return emptyWardrobeBatch

    default:
      return state
  }
}
