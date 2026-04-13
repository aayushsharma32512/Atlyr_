import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { likenessKeys } from "@/features/likeness/queryKeys"
import { tryOnKeys } from "@/features/tryon/queryKeys"
import { generateTryOn, TryOnGeneratePayload, TryOnGenerateResponse } from "@/services/tryon/tryonService"
import { useJobs } from "@/features/progress/providers/JobsContext"
import { useEngagementAnalytics } from "@/integrations/posthog/engagementTracking/EngagementAnalyticsContext"
import { trackTryonGenerationStarted } from "@/integrations/posthog/engagementTracking/tryon/tryonTracking"

export function useGenerateTryOn(tempJobId?: string) {
  const queryClient = useQueryClient()
  const { updateJob, getJobById } = useJobs()
  const analytics = useEngagementAnalytics()

  return useMutation({
    mutationKey: tryOnKeys.generate(),
    mutationFn: (payload: TryOnGeneratePayload) => generateTryOn(payload),
    onSuccess: (data: TryOnGenerateResponse) => {
      queryClient.invalidateQueries({ queryKey: tryOnKeys.list() })
      queryClient.invalidateQueries({ queryKey: tryOnKeys.generation(data.generationId) })
      queryClient.invalidateQueries({ queryKey: likenessKeys.list() })
      queryClient.invalidateQueries({ queryKey: ["daily-limits"] })

      // Update temp job with real generation ID
      if (tempJobId) {
        const existing = getJobById(tempJobId)
        const existingMetadata = (existing?.metadata ?? {}) as Record<string, unknown>
        const comboKey = typeof existingMetadata.comboKey === "string" ? existingMetadata.comboKey : null
        const startedAt = Date.now()

        if (comboKey) {
          trackTryonGenerationStarted(analytics, {
            tryon_request_id: data.generationId,
            combo_key: comboKey,
          })
        }

        updateJob(tempJobId, {
          id: data.generationId,
          metadata: {
            ...existingMetadata,
            generationId: data.generationId,
            generationStartedAtMs: startedAt,
          },
          progress: 30, // Initial progress
        })
      }
    },
  })
}
