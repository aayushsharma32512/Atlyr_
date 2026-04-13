import { useMutation } from "@tanstack/react-query"

import { outfitsKeys } from "@/features/outfits/queryKeys"
import { findOutfitByItems, type FindOutfitByItemsInput } from "@/services/outfits/outfitsService"

export function useFindOutfitByItems() {
  return useMutation({
    mutationKey: outfitsKeys.findByItems,
    mutationFn: (input: FindOutfitByItemsInput) => findOutfitByItems(input),
  })
}
