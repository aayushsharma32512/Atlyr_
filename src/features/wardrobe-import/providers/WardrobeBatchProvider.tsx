import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react"

import {
  clearWardrobeBatch,
  readWardrobeBatch,
  restoredWardrobePhoto,
  writeWardrobeBatch,
} from "@/features/wardrobe-import/batchStorage"
import {
  MAX_WARDROBE_PHOTOS,
  createWardrobePhoto,
  emptyWardrobeBatch,
  wardrobeBatchReducer,
} from "@/features/wardrobe-import/wardrobeBatchReducer"
import type {
  WardrobeBatch,
  WardrobeDetectionStatus,
  WardrobePhoto,
  WardrobePhotoStep,
  WardrobePieceSelection,
  WardrobePieceType,
  WardrobeRailSource,
} from "@/features/wardrobe-import/types"
import { useToast } from "@/hooks/use-toast"

type WardrobeBatchValue = {
  batch: WardrobeBatch
  activePhoto: WardrobePhoto | null
  addFiles: (files: File[]) => void
  removePhoto: (photoId: string) => void
  startIdentify: () => void
  setStage: (stage: WardrobeBatch["stage"]) => void
  setImportId: (photoId: string, importId: string) => void
  setDetectionStatus: (photoId: string, status: WardrobeDetectionStatus, previewUrl?: string | null) => void
  setActivePhoto: (photoId: string) => void
  setConfirmedPieces: (photoId: string, candidateIds: string[]) => void
  applyDefaultPieces: (photoId: string, candidateIds: string[]) => void
  setStep: (photoId: string, step: WardrobePhotoStep) => void
  setSelection: (
    photoId: string,
    pieceType: WardrobePieceType,
    selection: WardrobePieceSelection | null,
  ) => void
  setPieceSource: (photoId: string, candidateId: string, source: WardrobeRailSource) => void
  retryPhoto: (photoId: string) => void
  reset: () => void
}

const WardrobeBatchContext = createContext<WardrobeBatchValue | null>(null)

function revokePreview(photo: WardrobePhoto) {
  if (photo.previewUrl.startsWith("blob:")) URL.revokeObjectURL(photo.previewUrl)
}

export function WardrobeBatchProvider({ children }: { children: ReactNode }) {
  const [batch, dispatch] = useReducer(wardrobeBatchReducer, emptyWardrobeBatch)
  const { toast } = useToast()
  // Cleanup on unmount must see the last photos, not the ones this render closed over.
  const photosRef = useRef(batch.photos)
  photosRef.current = batch.photos

  useEffect(() => {
    const stored = readWardrobeBatch()
    if (stored.length) dispatch({ type: "restore", photos: stored.map(restoredWardrobePhoto) })
  }, [])

  // An empty batch never writes: on mount that would erase the batch the restore is rebuilding.
  // Emptying the batch clears storage from the action that emptied it.
  useEffect(() => {
    if (batch.photos.length) writeWardrobeBatch(batch.photos)
  }, [batch.photos])

  useEffect(() => () => {
    for (const photo of photosRef.current) revokePreview(photo)
  }, [])

  const addFiles = useCallback((files: File[]) => {
    const room = MAX_WARDROBE_PHOTOS - photosRef.current.length
    const accepted = files.slice(0, Math.max(room, 0))
    const ignored = files.length - accepted.length
    if (ignored > 0) {
      toast({
        title: `Up to ${MAX_WARDROBE_PHOTOS} photos at a time`,
        description: ignored === 1 ? "One photo was not added." : `${ignored} photos were not added.`,
      })
    }
    if (!accepted.length) return
    dispatch({
      type: "addPhotos",
      photos: accepted.map((file) => createWardrobePhoto(file, URL.createObjectURL(file))),
    })
  }, [toast])

  const removePhoto = useCallback((photoId: string) => {
    const photo = photosRef.current.find((item) => item.id === photoId)
    if (photo) revokePreview(photo)
    if (photosRef.current.length === 1) clearWardrobeBatch()
    dispatch({ type: "removePhoto", photoId })
  }, [])

  const reset = useCallback(() => {
    for (const photo of photosRef.current) revokePreview(photo)
    clearWardrobeBatch()
    dispatch({ type: "reset" })
  }, [])

  const value = useMemo<WardrobeBatchValue>(() => ({
    batch,
    activePhoto: batch.photos.find((photo) => photo.id === batch.activePhotoId) ?? null,
    addFiles,
    removePhoto,
    startIdentify: () => dispatch({ type: "startIdentify" }),
    setStage: (stage) => dispatch({ type: "setStage", stage }),
    setImportId: (photoId, importId) => dispatch({ type: "setImportId", photoId, importId }),
    setDetectionStatus: (photoId, status, previewUrl) =>
      dispatch({ type: "setDetectionStatus", photoId, status, previewUrl }),
    setActivePhoto: (photoId) => dispatch({ type: "setActivePhoto", photoId }),
    setConfirmedPieces: (photoId, candidateIds) =>
      dispatch({ type: "setConfirmedPieces", photoId, candidateIds }),
    applyDefaultPieces: (photoId, candidateIds) =>
      dispatch({ type: "applyDefaultPieces", photoId, candidateIds }),
    setStep: (photoId, step) => dispatch({ type: "setStep", photoId, step }),
    setSelection: (photoId, pieceType, selection) =>
      dispatch({ type: "setSelection", photoId, pieceType, selection }),
    setPieceSource: (photoId, candidateId, source) =>
      dispatch({ type: "setPieceSource", photoId, candidateId, source }),
    retryPhoto: (photoId) => dispatch({ type: "retryPhoto", photoId }),
    reset,
  }), [addFiles, batch, removePhoto, reset])

  return <WardrobeBatchContext.Provider value={value}>{children}</WardrobeBatchContext.Provider>
}

export function useWardrobeBatch(): WardrobeBatchValue {
  const value = useContext(WardrobeBatchContext)
  if (!value) throw new Error("useWardrobeBatch must be used inside WardrobeBatchProvider")
  return value
}
