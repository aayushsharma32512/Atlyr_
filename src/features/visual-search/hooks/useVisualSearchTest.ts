import { useMutation } from "@tanstack/react-query"

import { visualSearchKeys } from "@/features/visual-search/queryKeys"
import { runVisualSearchTest } from "@/services/visualSearch/visualSearchTestService"

export function useVisualSearchTest() {
  return useMutation({
    mutationKey: visualSearchKeys.run(),
    mutationFn: runVisualSearchTest,
  })
}
