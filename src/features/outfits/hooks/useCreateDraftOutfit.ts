import { useMutation, useQueryClient } from "@tanstack/react-query"

import { outfitsKeys } from "@/features/outfits/queryKeys"
import { collectionsKeys } from "@/features/collections/queryKeys"
import { createDraftOutfit, type DraftOutfitInput } from "@/services/outfits/outfitsService"

export function useCreateDraftOutfit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: outfitsKeys.createDraft,
    mutationFn: (input: DraftOutfitInput) => createDraftOutfit(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creations() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creationsCounts() })
      queryClient.invalidateQueries({ queryKey: outfitsKeys.all })
    },
  })
}
