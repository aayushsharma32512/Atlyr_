import { useCallback, useRef } from "react"
import { useMutation } from "@tanstack/react-query"
import {
    captureAndUploadOutfitSnapshot,
    saveOutfitSnapshotUrl,
} from "@/services/outfits/outfitSnapshotService"

interface UseOutfitSnapshotOptions {
    userId: string | null
    onSuccess?: (url: string) => void
    onError?: (error: Error) => void
}

/** Maximum time to wait for avatar readiness (ms) */
const MAX_WAIT_MS = 5000
/** Polling interval while waiting for ready signal (ms) */
const POLL_INTERVAL_MS = 100

/**
 * Hook for capturing outfit mannequin snapshots.
 * 
 * Usage:
 * 1. Attach `snapshotRef` to the container element you want to capture
 * 2. Wire `setAvatarReady(true)` to the OutfitInspirationTile's onAvatarReady callback
 * 3. Call `captureSnapshot(outfitId)` after saving the outfit
 */
export function useOutfitSnapshot({ userId, onSuccess, onError }: UseOutfitSnapshotOptions) {
    const snapshotRef = useRef<HTMLDivElement>(null)
    const isAvatarReadyRef = useRef(false)

    const setAvatarReady = useCallback((ready: boolean) => {
        isAvatarReadyRef.current = ready
    }, [])

    const waitForAvatarReady = useCallback(async () => {
        const startTime = Date.now()
        while (!isAvatarReadyRef.current && Date.now() - startTime < MAX_WAIT_MS) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        }
        if (!isAvatarReadyRef.current) {
            console.warn("[OutfitSnapshot] Timed out waiting for avatar to be ready, capturing anyway")
        }
    }, [])

    const mutation = useMutation({
        mutationFn: async (outfitId: string) => {
            if (!snapshotRef.current) {
                throw new Error("Snapshot ref is not attached to an element")
            }
            if (!userId) {
                throw new Error("User must be authenticated to capture snapshots")
            }

            // Wait for avatar images to finish loading before capture
            // This prevents capturing a bare mannequin when images are still loading
            await waitForAvatarReady()

            // Capture and upload the snapshot
            const result = await captureAndUploadOutfitSnapshot(
                snapshotRef.current,
                outfitId,
                userId
            )

            // Save the URL to the outfit record (pass userId and storagePath for RLS + cleanup)
            await saveOutfitSnapshotUrl(outfitId, result.url, userId, result.storagePath)

            return result.url
        },
        onSuccess: (url) => {
            onSuccess?.(url)
        },
        onError: (error) => {
            console.error("[OutfitSnapshot] Failed to capture:", error)
            onError?.(error instanceof Error ? error : new Error(String(error)))
        },
    })

    const captureSnapshot = useCallback(
        (outfitId: string) => mutation.mutateAsync(outfitId),
        [mutation]
    )

    return {
        snapshotRef,
        setAvatarReady,
        captureSnapshot,
        isCapturing: mutation.isPending,
        captureError: mutation.error,
    }
}
