import { useCallback, useEffect, useMemo, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { getDefaultCandidateIds } from "@/features/inspiration-import/candidateSelection"
import { useInspirationImport } from "@/features/inspiration-import/hooks/useInspirationImport"
import { inspirationImportKeys } from "@/features/inspiration-import/queryKeys"
import { syncedDetectionStatus } from "@/features/wardrobe-import/importStatus"
import { useWardrobeBatch } from "@/features/wardrobe-import/providers/WardrobeBatchProvider"
import type { WardrobePhoto } from "@/features/wardrobe-import/types"
import { inspirationImportService } from "@/services/inspirationImport/inspirationImportService"

/**
 * Turns photos into import rows — one row each, all of them at once. Called with
 * no ids it takes every photo still waiting; called with ids it retries those.
 */
export function useStartWardrobeBatch() {
  const { batch, setImportId, setDetectionStatus } = useWardrobeBatch()
  const queryClient = useQueryClient()
  const photosRef = useRef(batch.photos)
  photosRef.current = batch.photos

  return useCallback(async (photoIds?: string[]) => {
    const photos = photoIds
      ? photosRef.current.filter((photo) => photoIds.includes(photo.id))
      : photosRef.current.filter((photo) => photo.detectionStatus === "pending")
    if (!photos.length) return

    await Promise.allSettled(photos.map(async (photo) => {
      try {
        // A photo that already has a row only needs detection run again.
        if (photo.importId) {
          setDetectionStatus(photo.id, "detecting")
          await inspirationImportService.detectCandidates(photo.importId)
          await queryClient.invalidateQueries({ queryKey: inspirationImportKeys.detail(photo.importId) })
          return
        }
        if (!photo.file) {
          setDetectionStatus(photo.id, "failed")
          return
        }
        setDetectionStatus(photo.id, "uploading")
        const { importId } = await inspirationImportService.startImageImport(photo.file)
        setImportId(photo.id, importId)
        setDetectionStatus(photo.id, "detecting")
      } catch (error) {
        const failedImportId = (error as { importId?: string }).importId
        if (failedImportId) setImportId(photo.id, failedImportId)
        setDetectionStatus(photo.id, "failed")
      }
    }))
  }, [queryClient, setDetectionStatus, setImportId])
}

/** Reads one photo's import row and keeps the photo's tile state in step with it. */
export function useWardrobePhotoImport(photo: WardrobePhoto) {
  const { applyDefaultPieces, setDetectionStatus } = useWardrobeBatch()
  const query = useInspirationImport(photo.importId)
  const record = query.data
  const rowStatus = record?.import.status ?? null
  const sourceUrl = record?.sourceUrl ?? null
  const candidates = useMemo(() => record?.candidates ?? [], [record])
  const detectionStatus = photo.detectionStatus

  useEffect(() => {
    if (!rowStatus) return
    setDetectionStatus(photo.id, syncedDetectionStatus(detectionStatus, rowStatus), sourceUrl)
  }, [detectionStatus, photo.id, rowStatus, setDetectionStatus, sourceUrl])

  useEffect(() => {
    if (!candidates.length) return
    applyDefaultPieces(photo.id, getDefaultCandidateIds(candidates))
  }, [applyDefaultPieces, candidates, photo.id])

  return {
    candidates,
    sourceUrl,
    errorMessage: query.error?.message ?? record?.import.errorMessage ?? null,
  }
}
