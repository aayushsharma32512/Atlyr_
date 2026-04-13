import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { likenessKeys } from "@/features/likeness/queryKeys"
import { signTempCandidate, type LikenessUploadResponse } from "@/services/likeness/likenessService"

export function useLikenessCandidates(batchId: string | null) {
  const queryClient = useQueryClient()

  const cached = useQuery<LikenessUploadResponse | null>({
    queryKey: likenessKeys.candidatesStatus(batchId),
    enabled: Boolean(batchId),
    queryFn: async () => {
      if (!batchId) {
        return null
      }
      return queryClient.getQueryData<LikenessUploadResponse>(likenessKeys.candidates(batchId)) ?? null
    },
  })

  const refreshCandidate = useCallback(
    async (path: string) => {
      if (!batchId) return null
      const signedUrl = await signTempCandidate(path)
      queryClient.setQueryData<LikenessUploadResponse | undefined>(likenessKeys.candidates(batchId), (prev) => {
        if (!prev) {
          return prev
        }
        return {
          ...prev,
          candidates: prev.candidates.map((candidate) =>
            candidate.path === path ? { ...candidate, signedUrl } : candidate,
          ),
        }
      })
      return signedUrl
    },
    [batchId, queryClient],
  )

  return {
    batchId,
    candidates: cached.data?.candidates ?? [],
    identitySummary: cached.data?.identitySummary ?? null,
    metadata: cached.data?.metadata ?? {},
    refreshCandidate,
  }
}

