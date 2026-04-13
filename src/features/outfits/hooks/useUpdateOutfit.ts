import { useMutation, useQueryClient } from "@tanstack/react-query"

import { outfitsKeys } from "@/features/outfits/queryKeys"
import { collectionsKeys } from "@/features/collections/queryKeys"
import { updateOutfit, type UpdateOutfitInput } from "@/services/outfits/outfitsService"

export function useUpdateOutfit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: outfitsKeys.update,
    mutationFn: (input: UpdateOutfitInput) => updateOutfit(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creations() })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.creationsCounts() })
      queryClient.invalidateQueries({ queryKey: outfitsKeys.all })
    },
  })
}
