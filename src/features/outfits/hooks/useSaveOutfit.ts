import { useMutation, useQueryClient } from "@tanstack/react-query"

import { homeKeys } from "@/features/home/queryKeys"
import { searchKeys } from "@/features/search/queryKeys"
import { outfitsKeys } from "@/features/outfits/queryKeys"
import { saveOutfit, type SaveOutfitInput } from "@/services/outfits/outfitsService"

export function useSaveOutfit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: outfitsKeys.save,
    mutationFn: (input: SaveOutfitInput) => saveOutfit(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: homeKeys.all })
      queryClient.invalidateQueries({ queryKey: searchKeys.all })
      queryClient.invalidateQueries({ queryKey: outfitsKeys.all })
    },
  })
}
