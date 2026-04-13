import { useMutation, useQueryClient } from "@tanstack/react-query"

import { likenessKeys } from "@/features/likeness/queryKeys"
import { deleteLikeness } from "@/services/likeness/likenessService"

export function useLikenessDeleteMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: likenessKeys.delete(),
    mutationFn: (poseId: string) => deleteLikeness(poseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: likenessKeys.list() })
    },
  })
}

