import { useMutation, useQueryClient } from "@tanstack/react-query"

import { studioKeys } from "@/features/studio/queryKeys"
import { studioService, type StudioOutfitPayload } from "@/services/studio/studioService"

type Gender = "male" | "female" | null

interface UseStudioRemixArgs {
  gender: Gender
  excludeOutfitId?: string | null
}

export function useStudioRemix({ gender, excludeOutfitId }: UseStudioRemixArgs) {
  const queryClient = useQueryClient()

  const mutation = useMutation<StudioOutfitPayload, Error, void>({
    mutationFn: () =>
      studioService.getRandomOutfitByGender({
        gender,
        excludeOutfitId,
      }),
    onSuccess: (payload) => {
      const outfitId = payload.outfit?.id ?? null
      if (!outfitId) {
        return
      }
      queryClient.setQueryData(studioKeys.outfit(outfitId), payload)
      queryClient.setQueryData(studioKeys.productTray(outfitId), payload.trayItems)
    },
  })

  return {
    remix: mutation.mutateAsync,
    isRemixing: mutation.isPending,
  }
}
