import { useMutation, useQueryClient } from "@tanstack/react-query"

import { likenessKeys } from "@/features/likeness/queryKeys"
import { selectLikeness, type LikenessSelectResponse } from "@/services/likeness/likenessService"

type SelectVariables = {
  candidateId: string
  setActive?: boolean
}

export function useLikenessSelectMutation() {
  const queryClient = useQueryClient()

  return useMutation<LikenessSelectResponse, Error, SelectVariables>({
    mutationKey: likenessKeys.select(),
    mutationFn: (variables) => selectLikeness(variables),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: likenessKeys.list() })
    },
  })
}

