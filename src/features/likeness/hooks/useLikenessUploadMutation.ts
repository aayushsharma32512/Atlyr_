import { useMutation, useQueryClient } from "@tanstack/react-query"

import { likenessKeys } from "@/features/likeness/queryKeys"
import {
  uploadLikeness,
  type LikenessUploadPayload,
  type LikenessUploadResponse,
} from "@/services/likeness/likenessService"

export function useLikenessUploadMutation() {
  const queryClient = useQueryClient()

  return useMutation<LikenessUploadResponse, Error, LikenessUploadPayload>({
    mutationKey: likenessKeys.upload(),
    mutationFn: (payload) => uploadLikeness(payload),
    onSuccess: (data) => {
      if (data.uploadBatchId) {
        queryClient.setQueryData(likenessKeys.candidates(data.uploadBatchId), data)
      }
      queryClient.invalidateQueries({ queryKey: ["daily-limits"] })
    },
  })
}

