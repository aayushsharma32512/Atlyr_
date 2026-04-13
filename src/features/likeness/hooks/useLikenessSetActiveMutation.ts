import { useMutation, useQueryClient } from "@tanstack/react-query"

import { likenessKeys } from "@/features/likeness/queryKeys"
import { setActiveLikeness } from "@/services/likeness/likenessService"

export function useLikenessSetActiveMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: likenessKeys.setActive(),
    onMutate: async (poseId: string) => {
      await queryClient.cancelQueries({ queryKey: likenessKeys.list() })
      const previous = queryClient.getQueryData(likenessKeys.list())
      queryClient.setQueryData(likenessKeys.list(), (current: any) => {
        if (!Array.isArray(current)) return current
        return current.map((pose) => ({
          ...pose,
          isActive: pose?.id === poseId,
        }))
      })
      return { previous }
    },
    mutationFn: (poseId: string) => setActiveLikeness(poseId),
    onError: (_error, _poseId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(likenessKeys.list(), context.previous)
      }
    },
  })
}

