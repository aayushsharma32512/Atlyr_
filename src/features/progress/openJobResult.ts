import { useCallback } from "react"
import { useNavigate } from "react-router-dom"

import { openLikenessDrawer } from "@/features/likeness/openLikenessDrawer"
import type { Job } from "./providers/JobsContext"

/** Pulls the outfit the job was started from out of its metadata. */
export function getOutfitContext(job: Job) {
  const outfitParams = job.metadata?.outfitParams as Record<string, string | null> | undefined

  const outfitItems = outfitParams
    ? {
        topId: outfitParams.topId ?? null,
        bottomId: outfitParams.bottomId ?? null,
        footwearId: outfitParams.footwearId ?? null,
      }
    : undefined

  const resolvedGender =
    outfitParams?.outfitGender === "male" ||
    outfitParams?.outfitGender === "female" ||
    outfitParams?.outfitGender === "unisex"
      ? (outfitParams.outfitGender as "male" | "female" | "unisex")
      : null

  const outfitSnapshot = outfitParams
    ? {
        id: outfitParams.outfitId ?? undefined,
        name: outfitParams.outfitName ?? null,
        category: outfitParams.outfitCategory ?? null,
        occasionId: outfitParams.outfitOccasion ?? null,
        backgroundId: outfitParams.outfitBackgroundId ?? null,
        gender: resolvedGender,
      }
    : undefined

  return { outfitItems, outfitSnapshot }
}

type EntrySource = "direct" | "fromProgressHub" | "fromStep3"

/**
 * Opens a finished job's result. Shared by the progress hub and the
 * notifications screen so both land in the same place.
 */
export function useOpenJobResult(entrySource: EntrySource = "fromProgressHub") {
  const navigate = useNavigate()

  return useCallback(
    (job: Job) => {
      if (job.type === "likeness" && job.metadata?.batchId) {
        const { outfitItems, outfitSnapshot } = getOutfitContext(job)
        const saved = Boolean(job.metadata?.saved)
        const savedPoseId =
          typeof job.metadata?.savedPoseId === "string" ? job.metadata.savedPoseId : null

        openLikenessDrawer({
          initialStep: saved ? 3 : 2,
          batchId: job.metadata.batchId,
          outfitItems,
          outfitSnapshot,
          entrySource,
          ...(saved ? { savedMode: true, savedPoseId } : {}),
        })
        return
      }

      if (job.type === "tryon") {
        // Try-ons still live on the Home board view. Re-point at the Collections
        // Try-ons board once Collections owns board detail.
        navigate("/home?moodboard=try-ons")
      }
    },
    [entrySource, navigate],
  )
}
