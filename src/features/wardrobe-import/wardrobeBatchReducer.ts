import type {
  WardrobeBatch,
  WardrobeDetectionStatus,
  WardrobePhoto,
  WardrobePhotoStep,
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
  | { type: "setStage"; stage: WardrobeBatch["stage"] }
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
      selection: WardrobePieceSelection | null
    }
  | { type: "setPieceSource"; photoId: string; candidateId: string; source: WardrobeRailSource }
  | { type: "retryPhoto"; photoId: string }
  | { type: "restore"; photos: WardrobePhoto[] }
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

/** Drops the matches of pieces the user has since taken off the photo. */
function keptSelections(
  selections: WardrobePhoto["selections"],
  candidateIds: string[],
): WardrobePhoto["selections"] {
  const entries = Object.entries(selections) as [WardrobePieceType, WardrobePieceSelection][]
  const kept = entries.filter(([, selection]) => candidateIds.includes(selection.candidateId))
  return kept.length === entries.length ? selections : Object.fromEntries(kept)
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

    case "setStage": {
      if (state.stage === action.stage) return state
      // Every stage past the first needs photos; the active one is kept so a
      // return from review lands back on the photo the user left.
      if (action.stage !== "add" && !state.photos.length) return state
      return { ...state, stage: action.stage }
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
        if (!action.selection && !photo.selections[action.pieceType]) return photo
        const selections = { ...photo.selections }
        if (action.selection) selections[action.pieceType] = action.selection
        else delete selections[action.pieceType]
        return { ...photo, selections }
      })

    case "setPieceSource":
      return withPhoto(state, action.photoId, (photo) => (
        photo.railByPiece[action.candidateId] === action.source
          ? photo
          : { ...photo, railByPiece: { ...photo.railByPiece, [action.candidateId]: action.source } }
      ))

    case "retryPhoto":
      return withPhoto(state, action.photoId, (photo) => ({ ...photo, detectionStatus: "pending" }))

    case "restore":
      if (!action.photos.length) return state
      return { stage: "identify", photos: action.photos, activePhotoId: action.photos[0].id }

    case "reset":
      return emptyWardrobeBatch

    default:
      return state
  }
}
