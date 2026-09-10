import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast as sonnerToast } from "sonner"

import { openLikenessDrawer } from "@/features/likeness/openLikenessDrawer"
import { likenessKeys } from "@/features/likeness/queryKeys"
import { tryOnKeys } from "@/features/tryon/queryKeys"
import { generateTryOn, type TryOnGeneratePayload } from "@/services/tryon/tryonService"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { trackTryonGenerationStarted } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"

import { getOutfitContext } from "./openJobResult"
import { useJobs, type Job } from "./providers/JobsContext"

/** Retries a failed job. Try-ons re-submit; likeness reopens the upload step. */
export function useRetryJob() {
  const { addJob, removeJob, updateJob } = useJobs()
  const queryClient = useQueryClient()
  const analytics = useEngagementAnalytics()

  return useCallback(
    async (job: Job) => {
      if (job.status !== "failed") return

      if (job.type === "tryon") {
        const payload = job.metadata?.tryonPayload as TryOnGeneratePayload | undefined
        if (!payload?.neutralPoseId) {
          sonnerToast.error("Retry unavailable", {
            description: "Missing try-on details for retry.",
          })
          return
        }

        const comboKey = typeof job.metadata?.comboKey === "string" ? job.metadata.comboKey : null
        const tempId = `temp-tryon-${Date.now()}`
        const baseMetadata = { generationId: tempId, comboKey, tryonPayload: payload }

        addJob({
          id: tempId,
          type: "tryon",
          status: "processing",
          progress: 0,
          metadata: baseMetadata,
        })
        removeJob(job.id)

        sonnerToast.info("Retrying try-on", {
          description: "We'll notify you when it's ready.",
          duration: 4000,
        })

        try {
          const response = await generateTryOn(payload)
          const startedAt = Date.now()

          if (comboKey) {
            trackTryonGenerationStarted(analytics, {
              tryon_request_id: response.generationId,
              combo_key: comboKey,
            })
          }

          updateJob(tempId, {
            id: response.generationId,
            progress: 30,
            metadata: {
              ...baseMetadata,
              generationId: response.generationId,
              generationStartedAtMs: startedAt,
            },
          })

          queryClient.invalidateQueries({ queryKey: tryOnKeys.list() })
          queryClient.invalidateQueries({ queryKey: tryOnKeys.generation(response.generationId) })
          queryClient.invalidateQueries({ queryKey: likenessKeys.list() })
          queryClient.invalidateQueries({ queryKey: ["daily-limits"] })
        } catch (error) {
          updateJob(tempId, {
            status: "failed",
            progress: 0,
            metadata: { ...baseMetadata, errorType: "retry_failed" },
          })
          sonnerToast.error("Retry failed", {
            description: error instanceof Error ? error.message : "Unable to retry try-on.",
          })
        }
        return
      }

      if (job.type === "likeness") {
        const { outfitItems, outfitSnapshot } = getOutfitContext(job)
        removeJob(job.id)
        openLikenessDrawer({
          initialStep: 1,
          outfitItems,
          outfitSnapshot,
          entrySource: "fromProgressHub",
        })
        sonnerToast.info("Upload again to retry", {
          description: "We'll regenerate your likeness once you submit.",
          duration: 4000,
        })
      }
    },
    [addJob, analytics, queryClient, removeJob, updateJob],
  )
}
