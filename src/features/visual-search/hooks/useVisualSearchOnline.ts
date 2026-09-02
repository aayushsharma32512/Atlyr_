import { useMutation } from "@tanstack/react-query"

import { visualSearchKeys } from "@/features/visual-search/queryKeys"
import { runVisualSearchOnline } from "@/services/visualSearch/visualSearchTestService"

export function useVisualSearchOnline() {
  return useMutation({
    mutationKey: visualSearchKeys.searchOnline(),
    mutationFn: runVisualSearchOnline,
  })
}
