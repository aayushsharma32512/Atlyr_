import { useMutation, useQueryClient } from "@tanstack/react-query"

import { outfitsKeys } from "@/features/outfits/queryKeys"
import { collectionsKeys } from "@/features/collections/queryKeys"
import { studioKeys } from "@/features/studio/queryKeys"
import { createDraftOutfit, type DraftOutfitInput } from "@/services/outfits/outfitsService"

export function useCreateDraftOutfit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: outfitsKeys.createDraft,
    mutationFn: (input: DraftOutfitInput) => createDraftOutfit(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creationsAll() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creationsCounts() })
      queryClient.invalidateQueries({ queryKey: outfitsKeys.all })
      // A draft-create can create the row that a swapped combo's look-id lookup was waiting on.
      queryClient.invalidateQueries({ queryKey: [...studioKeys.all, "look-by-items"] })
    },
  })
}
