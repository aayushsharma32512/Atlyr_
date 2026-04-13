import { domToPng } from "modern-screenshot"
import { supabase } from "@/integrations/supabase/client"

export interface CaptureOutfitSnapshotResult {
    url: string
    storagePath: string
}

/**
 * Captures a DOM element as a PNG image and uploads it to Supabase Storage.
 * Returns the public URL for the uploaded image.
 */
export async function captureAndUploadOutfitSnapshot(
    element: HTMLElement,
    outfitId: string,
    userId: string
): Promise<CaptureOutfitSnapshotResult> {
    console.log("[outfitSnapshotService] Starting capture for outfit:", outfitId)

    const { width, height } = getElementSize(element)

    // Capture the element as a PNG data URL
    // Match previous sizing (client size + borders) to avoid cropping.
    const dataUrl = await domToPng(element, {
        quality: 0.95,
        scale: 2, // Higher quality for retina displays
        backgroundColor: null, // Transparent background
        width,
        height,
        font: false, // Skip font embedding (parity with skipFonts)
        fetch: { bypassingCache: true }, // Similar intent to cacheBust
    })

    console.log("[outfitSnapshotService] Captured PNG, length:", dataUrl.length)

    // Convert data URL to Blob
    const response = await fetch(dataUrl)
    const blob = await response.blob()

    // Generate storage path: {userId}/{outfitId}.png
    const storagePath = `${userId}/${outfitId}.png`

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
        .from("outfit-previews")
        .upload(storagePath, blob, {
            contentType: "image/png",
            upsert: true, // Overwrite if exists
        })

    if (uploadError) {
        console.error("[outfitSnapshotService] Upload failed:", uploadError)
        throw new Error(`Failed to upload outfit snapshot: ${uploadError.message}`)
    }
    console.log("[outfitSnapshotService] Upload successful:", storagePath)

    // Get public URL
    const { data: urlData } = supabase.storage
        .from("outfit-previews")
        .getPublicUrl(storagePath)

    // Sanity check: ensure public URL exists (would fail for private bucket)
    if (!urlData?.publicUrl) {
        // Clean up uploaded file since we can't get a URL
        await supabase.storage.from("outfit-previews").remove([storagePath])
        throw new Error("Failed to get public URL for outfit snapshot. Is the bucket public?")
    }

    return {
        url: urlData.publicUrl,
        storagePath,
    }
}

function getElementSize(element: HTMLElement): { width: number; height: number } {
    if (typeof window === "undefined") {
        return { width: element.clientWidth, height: element.clientHeight }
    }
    const style = window.getComputedStyle(element)
    const borderLeft = parseFloat(style.borderLeftWidth || "0")
    const borderRight = parseFloat(style.borderRightWidth || "0")
    const borderTop = parseFloat(style.borderTopWidth || "0")
    const borderBottom = parseFloat(style.borderBottomWidth || "0")
    const width = element.clientWidth + borderLeft + borderRight
    const height = element.clientHeight + borderTop + borderBottom
    return {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
    }
}

/**
 * Updates an outfit's outfit_images column with the snapshot URL.
 * If DB update fails, deletes the uploaded image to prevent orphaned files.
 */
export async function saveOutfitSnapshotUrl(
    outfitId: string,
    snapshotUrl: string,
    userId: string,
    storagePath?: string
): Promise<void> {
    console.log("[outfitSnapshotService] Saving snapshot URL to DB for outfit:", outfitId, "user:", userId)

    const { data, error } = await supabase
        .from("outfits")
        .update({ outfit_images: snapshotUrl })
        .eq("id", outfitId)
        .eq("user_id", userId)
        .select("id, outfit_images")

    console.log("[outfitSnapshotService] DB update result:", { data, error })

    if (error) {
        console.error("[outfitSnapshotService] DB update error:", error)
        // Clean up uploaded file on DB failure to prevent orphaned storage
        if (storagePath) {
            await supabase.storage.from("outfit-previews").remove([storagePath]).catch(() => {
                // Ignore cleanup errors, log for debugging
                console.warn("[outfitSnapshotService] Failed to clean up orphaned file:", storagePath)
            })
        }
        throw new Error(`Failed to save outfit snapshot URL: ${error.message}`)
    }

    if (!data || data.length === 0) {
        console.warn("[outfitSnapshotService] No rows updated! Check RLS or user_id mismatch.")
    } else {
        console.log("[outfitSnapshotService] Successfully updated outfit:", data[0])
    }
}
